/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { BrowserView, BrowserWindow, type WebContents } from 'electron';

import { logger } from '@main/logger';
import type { ComputerRuntimeState } from '@main/store/types';

export type ComputerSurfaceBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const SURFACE_ID = 'embedded-browser';
export const BROWSER_INPUT_BLOCKER_ID = 'neura-browser-input-blocker';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = async <T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
) =>
  Promise.race([
    operation,
    delay(timeoutMs).then(() => {
      throw new Error(message);
    }),
  ]);

const normalizeBounds = (bounds: ComputerSurfaceBounds): ComputerSurfaceBounds => ({
  x: Math.max(0, Math.round(bounds.x)),
  y: Math.max(0, Math.round(bounds.y)),
  width: Math.max(0, Math.round(bounds.width)),
  height: Math.max(0, Math.round(bounds.height)),
});

const toLoadableUrl = (raw: string) => {
  const value = raw.trim();
  if (!value) {
    return 'about:blank';
  }
  if (/^(https?:|file:|data:|about:)/i.test(value)) {
    return value;
  }
  return `https://${value}`;
};

const waitForNavigationSettled = (
  contents: WebContents,
  timeoutMs = 12_000,
) =>
  new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      contents.off('did-finish-load', finish);
      contents.off('did-stop-loading', finish);
      contents.off('did-fail-load', finish);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    contents.once('did-finish-load', finish);
    contents.once('did-stop-loading', finish);
    contents.once('did-fail-load', finish);
  });

class EmbeddedBrowserRuntime {
  private view: BrowserView | null = null;
  private owner: BrowserWindow | null = null;
  private bounds: ComputerSurfaceBounds = { x: 0, y: 0, width: 0, height: 0 };
  private visible = false;
  private interactionBlocked = true;
  private browserStateHandler:
    | ((browser: NonNullable<ComputerRuntimeState['browser']>) => void)
    | null = null;
  private failureHandler: ((message: string) => void) | null = null;

  get surfaceId() {
    return SURFACE_ID;
  }

  get webContents(): WebContents | null {
    return this.view?.webContents || null;
  }

  ensure() {
    if (this.view && !this.view.webContents.isDestroyed()) {
      return this.view;
    }

    const owner = this.resolveOwnerWindow();
    if (!owner) {
      throw new Error('Neura window is not available for embedded browser.');
    }

    const view = new BrowserView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        javascript: true,
        webSecurity: true,
      },
    });

    owner.addBrowserView(view);
    view.setBounds(this.visible ? this.bounds : { x: 0, y: 0, width: 0, height: 0 });
    view.webContents.setWindowOpenHandler(({ url }) => {
      void view.webContents.loadURL(url);
      return { action: 'deny' };
    });
    view.webContents.on('did-navigate', () => this.publishBrowserState());
    view.webContents.on('did-navigate-in-page', () => this.publishBrowserState());
    view.webContents.on('page-title-updated', () => this.publishBrowserState());
    view.webContents.on('did-finish-load', () => this.publishBrowserState());
    view.webContents.on('dom-ready', () => {
      void this.applyInteractionBlocker();
    });
    view.webContents.on('render-process-gone', (_event, details) => {
      logger.warn('[EmbeddedBrowserRuntime] render process gone', details);
      this.failureHandler?.('Embedded browser stopped unexpectedly.');
    });

    this.owner = owner;
    this.view = view;
    view.setAutoResize({ width: false, height: false });
    return view;
  }

  async navigate(url: string) {
    const view = this.ensure();
    const target = toLoadableUrl(url);
    this.publishBrowserState();
    const navigation = view.webContents.loadURL(target).catch((error) => {
      logger.warn('[EmbeddedBrowserRuntime] navigation failed', {
        target,
        error,
      });
    });
    await Promise.race([navigation, waitForNavigationSettled(view.webContents)]);
    await this.applyInteractionBlockerSafely('navigation');
    this.publishBrowserState();
  }

  goBack() {
    const contents = this.webContents;
    if (contents?.canGoBack()) {
      contents.goBack();
      this.publishBrowserState();
    }
  }

  focus() {
    this.ensure().webContents.focus();
  }

  setBounds(bounds: ComputerSurfaceBounds) {
    this.bounds = normalizeBounds(bounds);
    if (this.view && !this.view.webContents.isDestroyed()) {
      this.view.setBounds(this.visible ? this.bounds : { x: 0, y: 0, width: 0, height: 0 });
      this.view.setAutoResize({ width: false, height: false });
    }
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    if (this.view && !this.view.webContents.isDestroyed()) {
      this.view.setBounds(visible ? this.bounds : { x: 0, y: 0, width: 0, height: 0 });
    }
  }

  async setInteractionBlocked(blocked: boolean) {
    this.interactionBlocked = blocked;
    await this.applyInteractionBlockerSafely('setInteractionBlocked');
  }

  async withInteractionUnblocked<T>(operation: () => Promise<T> | T) {
    const wasBlocked = this.interactionBlocked;
    if (wasBlocked) {
      await this.setInteractionBlocked(false);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    try {
      return await operation();
    } finally {
      if (wasBlocked) {
        void this.setInteractionBlocked(true);
      }
    }
  }

  async executeJavaScript<T>(script: string): Promise<T> {
    const contents = this.ensure().webContents;
    return contents.executeJavaScript(script, true) as Promise<T>;
  }

  async capturePage() {
    const view = this.ensure();
    await this.waitForVisibleBounds();
    if (view.webContents.isLoading()) {
      await waitForNavigationSettled(view.webContents, 4_000);
    }
    await delay(50);
    const image = await withTimeout(
      view.webContents.capturePage(),
      5_000,
      'Embedded browser screenshot timed out.',
    );
    const size = image.getSize();
    return {
      base64: image.toJPEG(75).toString('base64'),
      width: size.width,
      height: size.height,
      mime: 'image/jpeg',
    };
  }

  sendInputEvent(event: Parameters<WebContents['sendInputEvent']>[0]) {
    this.ensure().webContents.sendInputEvent(event);
  }

  publishBrowserState() {
    const contents = this.webContents;
    if (!contents || contents.isDestroyed()) {
      return;
    }
    this.browserStateHandler?.({
      surfaceId: SURFACE_ID,
      url: contents.getURL(),
      title: contents.getTitle(),
      canGoBack: contents.canGoBack(),
      canGoForward: contents.canGoForward(),
      updatedAt: Date.now(),
    });
  }

  setHandlers(handlers: {
    onBrowserState?: (
      browser: NonNullable<ComputerRuntimeState['browser']>,
    ) => void;
    onFailure?: (message: string) => void;
  }) {
    this.browserStateHandler = handlers.onBrowserState || null;
    this.failureHandler = handlers.onFailure || null;
  }

  destroy() {
    if (!this.view) {
      return;
    }

    const view = this.view;
    this.view = null;
    this.visible = false;
    try {
      this.owner?.removeBrowserView(view);
    } catch (error) {
      logger.warn('[EmbeddedBrowserRuntime] failed to detach view', error);
    }
    if (!view.webContents.isDestroyed()) {
      view.webContents.close();
    }
    this.owner = null;
  }

  private async applyInteractionBlocker() {
    const contents = this.webContents;
    if (!contents || contents.isDestroyed()) {
      return;
    }

    try {
      await contents.executeJavaScript(
        `
        (() => {
          const id = ${JSON.stringify(BROWSER_INPUT_BLOCKER_ID)};
          const existing = document.getElementById(id);
          if (${JSON.stringify(this.interactionBlocked)}) {
            const blocker = existing || document.createElement('div');
            blocker.id = id;
            blocker.setAttribute('aria-hidden', 'true');
            blocker.setAttribute('data-neura-internal', 'true');
            blocker.style.cssText = [
              'position:fixed',
              'inset:0',
              'z-index:2147483647',
              'background:transparent',
              'cursor:not-allowed',
              'pointer-events:auto'
            ].join(';');
            if (!existing) {
              const stop = (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (event.stopImmediatePropagation) event.stopImmediatePropagation();
              };
              ['click','dblclick','contextmenu','mousedown','mouseup','mousemove','wheel','keydown','keyup','keypress','input','beforeinput','touchstart','touchmove','touchend'].forEach((type) => {
                blocker.addEventListener(type, stop, true);
              });
              document.documentElement.appendChild(blocker);
            }
          } else if (existing) {
            existing.remove();
          }
        })();
      `,
        true,
      );
    } catch (error) {
      logger.warn('[EmbeddedBrowserRuntime] failed to apply interaction blocker', error);
    }
  }

  private async applyInteractionBlockerSafely(reason: string) {
    try {
      await withTimeout(
        this.applyInteractionBlocker(),
        1_000,
        `Embedded browser input blocker timed out during ${reason}.`,
      );
    } catch (error) {
      logger.warn('[EmbeddedBrowserRuntime] interaction blocker skipped', {
        reason,
        error,
      });
    }
  }

  private resolveOwnerWindow() {
    if (this.owner && !this.owner.isDestroyed()) {
      return this.owner;
    }
    return BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) || null;
  }

  private async waitForVisibleBounds(timeoutMs = 2_000) {
    const startedAt = Date.now();
    while (
      this.visible &&
      (this.bounds.width <= 0 || this.bounds.height <= 0) &&
      Date.now() - startedAt < timeoutMs
    ) {
      await delay(50);
    }
  }
}

export const embeddedBrowserRuntime = new EmbeddedBrowserRuntime();
