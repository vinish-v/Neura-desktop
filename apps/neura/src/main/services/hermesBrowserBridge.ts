/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import http from 'http';
import net from 'net';
import os from 'os';
import path from 'path';

import { app } from 'electron';
import type { KeyInput } from 'puppeteer-core';

import { logger } from '@main/logger';
import { store } from '@main/store/create';
import type {
  BrowserBridgeHealth,
  BrowserRestoreSnapshot,
  HermesBrowserBackend,
} from '@main/store/types';
import {
  buildAutomationRecoveryReport,
  classifyAutomationFailure,
} from '@shared/browserAutomationRecovery';
import { ComputerRuntimeController } from './computerRuntimeController';
import { TaskRunRegistry } from './taskRunRegistry';

type ChromeTarget = {
  id?: string;
  type?: string;
  url?: string;
  title?: string;
  webSocketDebuggerUrl?: string;
};

type HermesBrowserBridgeInput = {
  signal?: AbortSignal;
  backend?: HermesBrowserBackend;
  dedicated?: boolean;
  onProgress?: (event: {
    title: string;
    detail?: string;
    status?: 'pending' | 'in_progress' | 'done' | 'failed';
  }) => void;
};

export type BrowserHealthProbeInput = {
  executablePath?: string | null;
  executableExists?: boolean;
  profilePath?: string;
  profileExists?: boolean;
  profileWritable?: boolean;
  profileLockPresent?: boolean;
  port?: number;
  portReachable?: boolean;
  bridgeStatus?: BrowserBridgeHealth['bridgeStatus'];
  checkedAt?: number;
};

const POLL_INTERVAL_MS = 600;
const IDLE_SHUTDOWN_MS = 180_000;
let activeSession: HermesBrowserBridgeSession | null = null;
let idleShutdownTimer: NodeJS.Timeout | null = null;

const getFreePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === 'object' && address?.port) {
          resolve(address.port);
          return;
        }
        reject(new Error('Could not allocate a local browser CDP port.'));
      });
    });
  });

const httpJson = <T>(url: string, timeoutMs = 2500) =>
  new Promise<T>((resolve, reject) => {
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        raw += chunk;
      });
      response.on('end', () => {
        if ((response.statusCode || 500) >= 400) {
          reject(new Error(`HTTP ${response.statusCode} from ${url}`));
          return;
        }
        try {
          resolve(JSON.parse(raw) as T);
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('timeout', () => {
      request.destroy(new Error(`Timed out reading ${url}`));
    });
    request.on('error', reject);
  });

const waitForCdp = async (baseUrl: string, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      await httpJson(`${baseUrl}/json/version`, 1500);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(
    `Hermes browser CDP did not become ready: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
};

const addIfFile = (items: string[], candidate?: string | null) => {
  if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    items.push(candidate);
  }
};

const cleanupStaleBrowserProfiles = async () => {
  const tempRoot = app.getPath('temp');
  try {
    const entries = await fs.promises.readdir(tempRoot, { withFileTypes: true });
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isDirectory() && entry.name.startsWith('neura-browser-'),
        )
        .map((entry) =>
          fs.promises.rm(path.join(tempRoot, entry.name), {
            recursive: true,
            force: true,
          }),
        ),
    );
  } catch (error) {
    logger.debug('[HermesBrowserBridge] stale profile cleanup failed', error);
  }
};

const ensurePersistentBrowserProfile = async () => {
  const profileDir = path.join(
    app.getPath('userData'),
    'browser-sessions',
    'local-automation-profile',
  );
  await fs.promises.mkdir(profileDir, { recursive: true });
  return profileDir;
};

const createDedicatedBrowserProfile = async () => {
  const tempRoot = app.getPath('temp');
  return fs.promises.mkdtemp(path.join(tempRoot, 'neura-browser-worker-'));
};

const resolveChromeExecutable = () => {
  const candidates: string[] = [];
  if (process.platform === 'win32') {
    const installParts = [
      ['Google', 'Chrome', 'Application', 'chrome.exe'],
      ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
      ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'],
      ['Chromium', 'Application', 'chrome.exe'],
      ['Chromium', 'Application', 'chromium.exe'],
    ];
    for (const base of [
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      process.env.LOCALAPPDATA,
    ]) {
      for (const parts of installParts) {
        addIfFile(candidates, base ? path.join(base, ...parts) : null);
      }
    }
    return candidates[0] || null;
  }

  if (process.platform === 'darwin') {
    for (const candidate of [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]) {
      addIfFile(candidates, candidate);
    }
    return candidates[0] || null;
  }

  for (const name of [
    'google-chrome',
    'google-chrome-stable',
    'chromium-browser',
    'chromium',
    'microsoft-edge',
    'brave-browser',
  ]) {
    const found = process.env.PATH?.split(path.delimiter)
      .map((entry) => path.join(entry, name))
      .find((candidate) => fs.existsSync(candidate));
    if (found) {
      return found;
    }
  }
  return null;
};

const isDisplayableTarget = (target: ChromeTarget) => {
  const url = (target.url || '').trim();
  return (
    target.type === 'page' &&
    Boolean(url) &&
    !url.startsWith('devtools://') &&
    url !== 'about:blank'
  );
};

const recordBrowserRecovery = ({
  message,
  action,
  url,
  status,
}: {
  message: string;
  action: string;
  url?: string;
  status?: 'pending' | 'in_progress' | 'done' | 'failed';
}) => {
  const runId = TaskRunRegistry.getActiveRunId();
  if (!runId) {
    return;
  }
  const report = buildAutomationRecoveryReport({
    surface: 'browser',
    toolName: action,
    action,
    message,
    url,
  });
  TaskRunRegistry.addEvidence(runId, report.evidence);
  TaskRunRegistry.addProgress(runId, {
    title: report.label,
    detail: [
      report.userFacingMessage,
      `Next action: ${report.nextAction.replace(/_/g, ' ')}`,
      `Evidence: ${report.evidence.summary}`,
    ].join('\n'),
    status:
      status ||
      (report.status === 'retryable' || report.status === 'relaunch_required'
        ? 'in_progress'
        : 'failed'),
    eventType: 'automation.recovery',
  });
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const cdpPortFromUrl = (cdpUrl?: string) => {
  if (!cdpUrl) {
    return undefined;
  }
  try {
    return new URL(cdpUrl).port
      ? Number(new URL(cdpUrl).port)
      : undefined;
  } catch {
    return undefined;
  }
};

export const buildBrowserHealthReport = ({
  executablePath,
  executableExists = Boolean(executablePath),
  profilePath,
  profileExists = Boolean(profilePath),
  profileWritable = false,
  profileLockPresent = false,
  port,
  portReachable = false,
  bridgeStatus = 'not_started',
  checkedAt = Date.now(),
}: BrowserHealthProbeInput): BrowserBridgeHealth => {
  const issues: string[] = [];
  const profileIssues: string[] = [];

  if (!executableExists) {
    issues.push('No supported local browser executable was found.');
  }
  if (!profileExists) {
    profileIssues.push('The local browser automation profile does not exist.');
  }
  if (!profileWritable) {
    profileIssues.push('The local browser automation profile is not writable.');
  }
  if (profileLockPresent) {
    profileIssues.push('The browser profile lock is present.');
  }
  if (
    bridgeStatus === 'connected' &&
    typeof port === 'number' &&
    !portReachable
  ) {
    issues.push('The configured CDP port is not reachable.');
  }
  if (bridgeStatus === 'failed') {
    issues.push('The local browser bridge is in a failed state.');
  }

  return {
    executablePath: executablePath || undefined,
    executableExists,
    port,
    portReachable,
    bridgeStatus,
    profile: {
      profilePath,
      exists: profileExists,
      writable: profileWritable,
      lockState: profileLockPresent
        ? 'locked'
        : profileExists
          ? 'unlocked'
          : 'unknown',
      issues: profileIssues,
    },
    checkedAt,
    issues: [...issues, ...profileIssues],
  };
};

const isProfileWritable = async (profilePath?: string) => {
  if (!profilePath) {
    return false;
  }
  const probePath = path.join(profilePath, `.neura-health-${process.pid}.tmp`);
  try {
    await fs.promises.mkdir(profilePath, { recursive: true });
    await fs.promises.writeFile(probePath, 'ok', 'utf8');
    await fs.promises.unlink(probePath);
    return true;
  } catch {
    return false;
  }
};

const hasProfileLock = (profilePath?: string) =>
  Boolean(
    profilePath &&
      ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'LOCK'].some(
        (name) => fs.existsSync(path.join(profilePath, name)),
      ),
  );

export const checkLocalBrowserHealth = async ({
  executablePath = resolveChromeExecutable(),
  profilePath,
  cdpUrl,
  bridgeStatus = 'not_started',
}: {
  executablePath?: string | null;
  profilePath?: string;
  cdpUrl?: string;
  bridgeStatus?: BrowserBridgeHealth['bridgeStatus'];
} = {}) => {
  const port = cdpPortFromUrl(cdpUrl);
  const profileExists = Boolean(profilePath && fs.existsSync(profilePath));
  const profileWritable = await isProfileWritable(profilePath);
  let portReachable = false;

  if (cdpUrl) {
    try {
      await httpJson(`${cdpUrl}/json/version`, 1000);
      portReachable = true;
    } catch {
      portReachable = false;
    }
  }

  return buildBrowserHealthReport({
    executablePath,
    executableExists: Boolean(executablePath && fs.existsSync(executablePath)),
    profilePath,
    profileExists,
    profileWritable,
    profileLockPresent: hasProfileLock(profilePath),
    port,
    portReachable,
    bridgeStatus,
  });
};

export class HermesBrowserBridgeSession {
  private pollTimer: NodeJS.Timeout | null = null;
  private lastUrl = '';
  private lastTitle = '';
  private stopped = false;
  private restarting = false;
  private browser: Awaited<
    ReturnType<typeof import('puppeteer-core')['connect']>
  > | null = null;
  private page: Awaited<
    ReturnType<
      Awaited<ReturnType<typeof import('puppeteer-core')['connect']>>['newPage']
    >
  > | null = null;
  private lastRecoverySignature = '';
  private lastSnapshotAt = 0;
  private lastSnapshotSignature = '';

  constructor(
    readonly cdpUrl: string,
    private child: ChildProcessWithoutNullStreams,
    private readonly userDataDir: string,
    private readonly executable: string,
    private readonly launchArgs: string[],
    private readonly backend: HermesBrowserBackend = 'local',
    private readonly preserveProfile = false,
  ) {}

  get isStopped() {
    return this.stopped || this.child.killed;
  }

  getLastStableState() {
    return {
      url: this.lastUrl || undefined,
      title: this.lastTitle || undefined,
    };
  }

  async connect() {
    const puppeteer = await import('puppeteer-core');
    this.browser = await puppeteer.connect({
      browserURL: this.cdpUrl,
      defaultViewport: { width: 1365, height: 768 },
    });
  }

  startPolling() {
    const poll = async () => {
      if (this.stopped) {
        return;
      }
      try {
        await this.refreshPuppeteerPage();
        const targets = await httpJson<ChromeTarget[]>(`${this.cdpUrl}/json/list`);
        const target =
          targets.find(isDisplayableTarget) ||
          targets.find((item) => item.type === 'page');
        if (!target) {
          return;
        }
        const url = target.url || 'about:blank';
        ComputerRuntimeController.updateBrowserState({
          surfaceId: 'neura-browser',
          url,
          title: target.title,
          canGoBack: false,
          canGoForward: false,
          updatedAt: Date.now(),
        });
        ComputerRuntimeController.update({
          mode: 'browser',
          surface: 'frame_stream',
          status: 'running',
          display: url,
          activity: target.title ? `Browsing ${target.title}` : 'Browsing',
        });
        await this.publishScreenshot(target.title);
        await this.publishRestoreSnapshot({
          url,
          title: target.title,
          bridgeStatus: 'connected',
        });
        if (url && url !== 'about:blank' && url !== this.lastUrl) {
          this.lastUrl = url;
        }
        if (target.title && target.title !== this.lastTitle) {
          this.lastTitle = target.title;
        }
      } catch (error) {
        const message = errorMessage(error);
        const signature = `poll:${message}`;
        if (signature !== this.lastRecoverySignature) {
          this.lastRecoverySignature = signature;
          recordBrowserRecovery({
            action: 'browser_poll',
            message,
            url: this.lastUrl,
          });
        }
        logger.debug('[HermesBrowserBridge] poll failed', error);
        if (
          classifyAutomationFailure({ message, toolName: 'browser_poll' }) ===
            'browser_crashed' &&
          !this.restarting &&
          !store.getState().computerRuntime?.takeoverEnabled
        ) {
          await this.restartAfterDisconnect(message);
        }
      }
    };

    void poll();
    this.pollTimer = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);
  }

  stop() {
    this.stopped = true;
    if (activeSession === this) {
      activeSession = null;
    }
    if (idleShutdownTimer) {
      clearTimeout(idleShutdownTimer);
      idleShutdownTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    void this.browser?.disconnect();
    if (!this.child.killed) {
      this.child.kill();
    }
    if (!this.preserveProfile) {
      void fs.promises.rm(this.userDataDir, { recursive: true, force: true });
    }
  }

  async handleTakeoverInput(input: BrowserTakeoverInput) {
    await this.refreshPuppeteerPage();
    const page = this.page;
    if (!page) {
      throw new Error('Hermes browser page is not available for takeover.');
    }

    if (input.type === 'click') {
      await page.mouse.click(input.x, input.y);
      return;
    }
    if (input.type === 'double_click') {
      await page.mouse.click(input.x, input.y, { clickCount: 2 });
      return;
    }
    if (input.type === 'right_click') {
      await page.mouse.click(input.x, input.y, { button: 'right' });
      return;
    }
    if (input.type === 'scroll') {
      await page.mouse.move(input.x, input.y);
      await page.mouse.wheel({ deltaY: input.direction === 'up' ? -500 : 500 });
      return;
    }
    if (input.type === 'text') {
      await page.keyboard.type(input.text);
      return;
    }
    if (input.type === 'key') {
      await page.keyboard.press(toPuppeteerKey(input.key));
      return;
    }
    if (input.type === 'hotkey') {
      const keys = input.key
        .split('+')
        .map((part) => toPuppeteerKey(part))
        .filter(Boolean);
      for (const key of keys) {
        await page.keyboard.down(key);
      }
      for (const key of [...keys].reverse()) {
        await page.keyboard.up(key);
      }
    }
  }

  private async refreshPuppeteerPage() {
    if (!this.browser) {
      return;
    }
    const pages = await this.browser.pages();
    this.page =
      [...pages].reverse().find((page) => {
        const url = page.url();
        return url && url !== 'about:blank' && !url.startsWith('devtools://');
      }) ||
      pages[0] ||
      this.page;
  }

  private async publishScreenshot(title?: string) {
    const page = this.page;
    if (!page || page.isClosed()) {
      return;
    }
    const viewport = page.viewport() || { width: 1365, height: 768 };
    const screenshot = await page.screenshot({
      encoding: 'base64',
      type: 'jpeg',
      quality: 70,
    });
    ComputerRuntimeController.frame({
      dataUrl: `data:image/jpeg;base64,${screenshot}`,
      mime: 'image/jpeg',
      width: viewport.width,
      height: viewport.height,
      sourceId: 'neura-browser',
      sourceName: title || page.url(),
    });
  }

  private async publishRestoreSnapshot({
    url,
    title,
    bridgeStatus,
  }: {
    url?: string;
    title?: string;
    bridgeStatus: BrowserBridgeHealth['bridgeStatus'];
  }) {
    const runId = TaskRunRegistry.getActiveRunId();
    if (!runId) {
      return;
    }
    const signature = `${url || ''}|${title || ''}|${bridgeStatus}`;
    const now = Date.now();
    if (
      signature === this.lastSnapshotSignature &&
      now - this.lastSnapshotAt < 5000
    ) {
      return;
    }
    this.lastSnapshotSignature = signature;
    this.lastSnapshotAt = now;

    const health = await checkLocalBrowserHealth({
      executablePath: this.executable,
      profilePath: this.userDataDir,
      cdpUrl: this.cdpUrl,
      bridgeStatus,
    });
    const snapshot: BrowserRestoreSnapshot = {
      url: url || this.lastUrl || undefined,
      title: title || this.lastTitle || undefined,
      profilePath: this.userDataDir,
      backend: this.backend,
      cdpUrl: this.cdpUrl,
      takeoverActive: Boolean(store.getState().computerRuntime?.takeoverEnabled),
      bridgeStatus,
      health,
      capturedAt: now,
    };
    TaskRunRegistry.setBrowserRestoreSnapshot(runId, snapshot);
  }

  private async restartAfterDisconnect(reason: string) {
    const recoveryStartedAt = Date.now();
    const runId = TaskRunRegistry.getActiveRunId();
    this.restarting = true;
    await this.publishRestoreSnapshot({
      url: this.lastUrl,
      title: this.lastTitle,
      bridgeStatus: 'restarting',
    });
    ComputerRuntimeController.update({
      status: 'running',
      activity: 'Restarting browser automation',
      display: this.lastUrl || 'Reconnecting browser',
    });

    try {
      void this.browser?.disconnect();
      if (!this.child.killed) {
        this.child.kill();
      }
      this.child = spawn(this.executable, this.launchArgs, {
        detached: process.platform !== 'win32',
        windowsHide: true,
        stdio: 'ignore',
      }) as ChildProcessWithoutNullStreams;
      await waitForCdp(this.cdpUrl);
      await this.connect();
      if (this.lastUrl && this.page && this.lastUrl !== 'about:blank') {
        await this.page.goto(this.lastUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 20_000,
        });
      }
      recordBrowserRecovery({
        action: 'browser_restart',
        message: `Restarted local browser bridge after disconnect: ${reason}`,
        url: this.lastUrl,
        status: 'done',
      });
      if (runId) {
        TaskRunRegistry.addBrowserActionAudit(runId, {
          action: 'browser_restart',
          status: 'completed',
          urlBefore: this.lastUrl || undefined,
          urlAfter: this.lastUrl || undefined,
          titleAfter: this.lastTitle || undefined,
          durationMs: Date.now() - recoveryStartedAt,
          completedAt: Date.now(),
        });
        TaskRunRegistry.recordBrowserTiming(
          runId,
          'browser_restart',
          Date.now() - recoveryStartedAt,
          'recovery',
        );
      }
      await this.publishRestoreSnapshot({
        url: this.lastUrl,
        title: this.lastTitle,
        bridgeStatus: 'connected',
      });
    } catch (error) {
      const message = errorMessage(error);
      recordBrowserRecovery({
        action: 'browser_restart',
        message,
        url: this.lastUrl,
        status: 'failed',
      });
      if (runId) {
        TaskRunRegistry.addBrowserActionAudit(runId, {
          action: 'browser_restart',
          status: 'failed',
          urlBefore: this.lastUrl || undefined,
          failureClass: classifyAutomationFailure({
            message,
            toolName: 'browser_restart',
          }),
          durationMs: Date.now() - recoveryStartedAt,
          completedAt: Date.now(),
        });
        TaskRunRegistry.recordBrowserTiming(
          runId,
          'browser_restart',
          Date.now() - recoveryStartedAt,
          'recovery',
        );
      }
      await this.publishRestoreSnapshot({
        url: this.lastUrl,
        title: this.lastTitle,
        bridgeStatus: 'failed',
      });
      logger.warn('[HermesBrowserBridge] automatic browser restart failed', error);
    } finally {
      this.restarting = false;
    }
  }
}

type BrowserTakeoverInput =
  | { type: 'click' | 'double_click' | 'right_click'; x: number; y: number }
  | { type: 'scroll'; x: number; y: number; direction: 'up' | 'down' }
  | { type: 'text'; text: string }
  | { type: 'key' | 'hotkey'; key: string };

const toPuppeteerKey = (key: string): KeyInput => {
  const normalized = key.toLowerCase();
  const map: Record<string, KeyInput> = {
    ctrl: 'Control',
    control: 'Control',
    shift: 'Shift',
    alt: 'Alt',
    meta: 'Meta',
    cmd: 'Meta',
    command: 'Meta',
    win: 'Meta',
    enter: 'Enter',
    return: 'Enter',
    backspace: 'Backspace',
    delete: 'Delete',
    tab: 'Tab',
    escape: 'Escape',
    esc: 'Escape',
    space: 'Space',
    arrowup: 'ArrowUp',
    arrowdown: 'ArrowDown',
    arrowleft: 'ArrowLeft',
    arrowright: 'ArrowRight',
    pageup: 'PageUp',
    pagedown: 'PageDown',
    home: 'Home',
    end: 'End',
  };
  return map[normalized] || (key as KeyInput);
};

export const hasHermesBrowserTakeover = () => Boolean(activeSession);

export const sendHermesBrowserTakeoverInput = async (
  input: BrowserTakeoverInput,
) => {
  if (!activeSession) {
    throw new Error('Hermes browser is not active.');
  }
  await activeSession.handleTakeoverInput(input);
};

export const startHermesBrowserBridge = async ({
  signal,
  backend = 'local',
  dedicated = false,
  onProgress,
}: HermesBrowserBridgeInput = {}) => {
  const launchStartedAt = Date.now();
  const runId = TaskRunRegistry.getActiveRunId();
  onProgress?.({
    title: 'Starting browser automation',
    detail: dedicated
      ? 'Preparing an isolated browser worker session.'
      : 'Preparing the local persistent browser session.',
    status: 'in_progress',
  });
  if (!dedicated && activeSession && !activeSession.isStopped) {
    if (idleShutdownTimer) {
      clearTimeout(idleShutdownTimer);
      idleShutdownTimer = null;
    }
    if (runId) {
      TaskRunRegistry.addBrowserActionAudit(runId, {
        action: 'browser_reuse',
        status: 'completed',
        urlAfter: activeSession.getLastStableState().url,
        titleAfter: activeSession.getLastStableState().title,
        durationMs: Date.now() - launchStartedAt,
        completedAt: Date.now(),
      });
      TaskRunRegistry.recordBrowserTiming(
        runId,
        'browser_reuse',
        Date.now() - launchStartedAt,
        'launch',
      );
    }
    onProgress?.({
      title: 'Browser automation ready',
      detail: 'Reusing warm browser session.',
      status: 'done',
    });
    return activeSession;
  }

  const executable = resolveChromeExecutable();
  if (!executable) {
    recordBrowserRecovery({
      action: 'browser_launch',
      message: 'Chrome, Edge, Brave, or Chromium was not found on this machine.',
      status: 'failed',
    });
    onProgress?.({
      title: 'Browser automation unavailable',
      detail: 'Chrome, Edge, Brave, or Chromium was not found on this machine.',
      status: 'failed',
    });
    return null;
  }

  await cleanupStaleBrowserProfiles();

  const port = await getFreePort();
  const cdpUrl = `http://127.0.0.1:${port}`;
  const userDataDir = dedicated
    ? await createDedicatedBrowserProfile()
    : await ensurePersistentBrowserProfile();

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--headless=new',
    '--window-size=1365,768',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-session-crashed-bubble',
    '--hide-crash-restore-bubble',
    '--disable-features=SessionRestore',
    'about:blank',
  ];

  const child = spawn(executable, args, {
    detached: process.platform !== 'win32',
    windowsHide: true,
    stdio: 'ignore',
  }) as ChildProcessWithoutNullStreams;

  signal?.addEventListener(
    'abort',
    () => {
      if (!child.killed) {
        child.kill();
      }
    },
    { once: true },
  );

  let session: HermesBrowserBridgeSession;
  try {
    await waitForCdp(cdpUrl);
    session = new HermesBrowserBridgeSession(
      cdpUrl,
      child,
      userDataDir,
      executable,
      args,
      backend,
      !dedicated,
    );
    await session.connect();
  } catch (error) {
    const message = errorMessage(error);
    recordBrowserRecovery({
      action: 'browser_launch',
      message,
      status: 'failed',
    });
    onProgress?.({
      title: 'Browser recovery needed',
      detail: message,
      status: 'failed',
    });
    if (!child.killed) {
      child.kill();
    }
    throw error;
  }
  if (runId) {
    TaskRunRegistry.addBrowserActionAudit(runId, {
      action: 'browser_launch',
      status: 'completed',
      urlAfter: 'about:blank',
      titleAfter: 'Browser',
      durationMs: Date.now() - launchStartedAt,
      completedAt: Date.now(),
    });
    TaskRunRegistry.recordBrowserTiming(
      runId,
      'browser_launch',
      Date.now() - launchStartedAt,
      'launch',
    );
  }
  if (!dedicated) {
    activeSession = session;
    session.startPolling();
    ComputerRuntimeController.updateBrowserState({
      surfaceId: 'neura-browser',
      url: 'about:blank',
      title: 'Browser',
      canGoBack: false,
      canGoForward: false,
      updatedAt: Date.now(),
    });
  }
  onProgress?.({
    title: 'Browser automation ready',
    detail: dedicated
      ? `${path.basename(executable)} with dedicated worker session`
      : `${path.basename(executable)} with persistent local session`,
    status: 'done',
  });
  logger.info('[HermesBrowserBridge] started', {
    executable,
    cdpUrl,
    profile: userDataDir,
    platform: os.platform(),
  });
  return session;
};

export const releaseHermesBrowserBridge = (
  session: HermesBrowserBridgeSession | null | undefined,
) => {
  if (!session || session.isStopped) {
    return;
  }
  if (session !== activeSession) {
    session.stop();
    return;
  }
  if (idleShutdownTimer) {
    clearTimeout(idleShutdownTimer);
  }
  idleShutdownTimer = setTimeout(() => {
    if (activeSession === session && !session.isStopped) {
      session.stop();
    }
  }, IDLE_SHUTDOWN_MS);
  idleShutdownTimer.unref?.();
};
