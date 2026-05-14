/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { CanvasIdeBridge, CanvasIdeBridgeSession } from './canvas-ide-bridge';
import { CanvasService } from './canvas-service';

const NEURA_AGENT_EXTENSION_IDENTIFIER = 'neura.neura-ai';
const NEURA_AGENT_EXTENSION_ID = `${NEURA_AGENT_EXTENSION_IDENTIFIER}-0.1.0`;

export type CanvasIdeStatus = {
  available: boolean;
  executablePath: string | null;
  configuredBy: 'env' | 'installed' | 'repo' | null;
  bridge: ReturnType<CanvasIdeBridge['getStatus']>;
};

export type CanvasIdeLaunchResult = {
  projectId: string;
  rootPath: string;
  executablePath: string;
  pid: number | null;
  bridgeUrl: string;
  bridgeExpiresAt: number;
  userDataDir: string;
  extensionsDir: string;
};

type IdeCandidate = {
  executablePath: string;
  configuredBy: CanvasIdeStatus['configuredBy'];
};

const cwd = process.cwd();
const repoRoot = cwd.endsWith(path.join('apps', 'neura'))
  ? path.resolve(cwd, '..', '..')
  : cwd;
const appDataRoot = () =>
  path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'Neura',
  );

const localAppDataRoot = () =>
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');

const windowsExecutableNames = [
  'Neura IDE.exe',
  'NeuraIDE.exe',
  'VSCodium.exe',
  'codium.exe',
];

const candidateExecutables = (): IdeCandidate[] => {
  const envPath = process.env.NEURA_IDE_EXECUTABLE;
  const candidates: IdeCandidate[] = [];
  if (envPath) {
    candidates.push({ executablePath: envPath, configuredBy: 'env' });
  }

  for (const name of windowsExecutableNames) {
    for (const root of [
      path.join(localAppDataRoot(), 'Programs', 'Neura IDE'),
      path.join(localAppDataRoot(), 'Neura IDE'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Neura IDE'),
      path.join(
        process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
        'Neura IDE',
      ),
    ]) {
      candidates.push({
        executablePath: path.join(root, name),
        configuredBy: 'installed',
      });
    }
    candidates.push({
      executablePath: path.join(
        repoRoot,
        'apps',
        'neura-ide',
        'dist',
        'win32-x64',
        name,
      ),
      configuredBy: 'repo',
    });
    candidates.push({
      executablePath: path.join(repoRoot, 'apps', 'neura-ide', 'bin', name),
      configuredBy: 'repo',
    });
  }
  return candidates;
};

const findExecutable = async (): Promise<IdeCandidate | null> => {
  for (const candidate of candidateExecutables()) {
    try {
      const stat = await fs.stat(candidate.executablePath);
      if (stat.isFile()) {
        return candidate;
      }
    } catch {
      // Try the next concrete candidate.
    }
  }
  return null;
};

const bundledExtensionSource = () => {
  const packaged =
    typeof process.resourcesPath === 'string'
      ? path.join(process.resourcesPath, 'neura-agent')
      : '';
  const unpackedPackaged =
    typeof process.resourcesPath === 'string'
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'neura-agent')
      : '';
  const repo = path.join(repoRoot, 'extensions', 'neura-agent');
  return { packaged, unpackedPackaged, repo };
};

const copyDirectory = async (source: string, target: string) => {
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.cp(source, target, { recursive: true });
};

const extensionManifestLocation = (extensionPath: string) =>
  `/${extensionPath.replace(/\\/g, '/')}`;

const writeExtensionsManifest = async (extensionsDir: string) => {
  const target = path.join(extensionsDir, NEURA_AGENT_EXTENSION_ID);
  await fs.writeFile(
    path.join(extensionsDir, 'extensions.json'),
    JSON.stringify(
      [
        {
          identifier: { id: NEURA_AGENT_EXTENSION_IDENTIFIER },
          version: '0.1.0',
          location: {
            $mid: 1,
            path: extensionManifestLocation(target),
            scheme: 'file',
          },
          relativeLocation: NEURA_AGENT_EXTENSION_ID,
        },
      ],
      null,
      2,
    ),
    'utf8',
  );
};

const clearExtensionScannerCaches = async (userDataDir: string) => {
  await fs.rm(
    path.join(userDataDir, 'CachedProfilesData', '__default__profile__'),
    { recursive: true, force: true },
  );
};

const clearDisabledNeuraExtensionState = async (userDataDir: string) => {
  const storageDir = path.join(userDataDir, 'User', 'globalStorage');
  const statePaths = [
    path.join(storageDir, 'state.vscdb'),
    path.join(storageDir, 'state.vscdb.backup'),
  ];
  for (const statePath of statePaths) {
    try {
      const data = await fs.readFile(statePath);
      if (
        data.includes('neura.neura-agent') ||
        data.includes(NEURA_AGENT_EXTENSION_IDENTIFIER) ||
        data.includes('neura.neura-native-chat')
      ) {
        await fs.rm(statePath, { force: true });
      }
    } catch {
      // The isolated IDE profile may not have persisted storage yet.
    }
  }
};

const installBundledExtension = async (
  extensionsDir: string,
  userDataDir: string,
) => {
  const { packaged, unpackedPackaged, repo } = bundledExtensionSource();
  const target = path.join(extensionsDir, NEURA_AGENT_EXTENSION_ID);
  const obsoletePath = path.join(extensionsDir, '.obsolete');
  for (const source of [packaged, unpackedPackaged, repo].filter(Boolean)) {
    try {
      await fs.stat(path.join(source, 'package.json'));
      await fs.rm(obsoletePath, { force: true });
      await copyDirectory(source, target);
      await writeExtensionsManifest(extensionsDir);
      await clearExtensionScannerCaches(userDataDir);
      await clearDisabledNeuraExtensionState(userDataDir);
      return target;
    } catch {
      // A separately installed Neura IDE bundles this extension as a built-in.
    }
  }
  return null;
};

export class CanvasIdeLauncher {
  private static instance: CanvasIdeLauncher | null = null;
  private childProcesses = new Map<string, ChildProcess>();

  static getInstance() {
    if (!CanvasIdeLauncher.instance) {
      CanvasIdeLauncher.instance = new CanvasIdeLauncher();
    }
    return CanvasIdeLauncher.instance;
  }

  async getStatus(): Promise<CanvasIdeStatus> {
    const executable = await findExecutable();
    return {
      available: Boolean(executable),
      executablePath: executable?.executablePath || null,
      configuredBy: executable?.configuredBy || null,
      bridge: CanvasIdeBridge.getInstance().getStatus(),
    };
  }

  async openProject(projectId: string): Promise<CanvasIdeLaunchResult> {
    const project = await CanvasService.getInstance().getProject(projectId);
    const executable = await findExecutable();
    if (!executable) {
      throw new Error(
        'Neura IDE app was not found. Install Neura IDE, build apps/neura-ide, or set NEURA_IDE_EXECUTABLE to a Neura IDE/VSCodium-compatible binary.',
      );
    }

    const session = await CanvasIdeBridge.getInstance().createSession(projectId);
    const userDataDir = path.join(appDataRoot(), 'ide-data', projectId);
    const extensionsDir = path.join(appDataRoot(), 'ide-extensions', projectId);
    await fs.mkdir(userDataDir, { recursive: true });
    await fs.mkdir(extensionsDir, { recursive: true });
    await installBundledExtension(extensionsDir, userDataDir);

    const child = this.spawnWorkbench(
      executable.executablePath,
      project.rootPath,
      userDataDir,
      extensionsDir,
      session,
    );
    this.childProcesses.set(projectId, child);
    child.once('exit', () => this.childProcesses.delete(projectId));

    return {
      projectId,
      rootPath: project.rootPath,
      executablePath: executable.executablePath,
      pid: child.pid ?? null,
      bridgeUrl: session.url,
      bridgeExpiresAt: session.expiresAt,
      userDataDir,
      extensionsDir,
    };
  }

  private spawnWorkbench(
    executablePath: string,
    rootPath: string,
    userDataDir: string,
    extensionsDir: string,
    session: CanvasIdeBridgeSession,
  ) {
    const child = spawn(
      executablePath,
      [
        '--new-window',
        '--user-data-dir',
        userDataDir,
        '--extensions-dir',
        extensionsDir,
        rootPath,
      ],
      {
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          NEURA_BRIDGE_URL: session.url,
          NEURA_BRIDGE_TOKEN: session.token,
          NEURA_PROJECT_ID: session.projectId,
        },
      },
    );
    child.unref();
    return child;
  }
}
