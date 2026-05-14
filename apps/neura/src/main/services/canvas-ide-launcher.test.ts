/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { EventEmitter } from 'events';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const project = {
  id: 'canvas_launch',
  title: 'Launch Canvas',
  rootPath: 'C:/Neura-Projects/launch',
  entryFile: 'index.html',
  files: [],
  versions: [],
  composerPlans: [],
  terminalRuns: [],
  createdAt: 1,
  updatedAt: 1,
};

const service = {
  getProject: vi.fn(async () => project),
};

const spawned: Array<{
  executablePath: string;
  args: string[];
  options: { env?: NodeJS.ProcessEnv };
}> = [];

vi.mock('./canvas-service', () => ({
  CanvasService: {
    getInstance: () => service,
  },
}));

vi.mock('child_process', () => ({
  spawn: vi.fn((executablePath, args, options) => {
    spawned.push({ executablePath, args, options });
    const child = new EventEmitter() as EventEmitter & {
      pid: number;
      unref: () => void;
    };
    child.pid = 4242;
    child.unref = vi.fn();
    return child;
  }),
}));

describe('CanvasIdeLauncher', () => {
  let tempDir: string;
  let executablePath: string;
  let originalLocalAppData: string | undefined;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    spawned.length = 0;
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neura-ide-test-'));
    executablePath = path.join(tempDir, 'Neura IDE.exe');
    await fs.writeFile(executablePath, '');
    process.env.NEURA_IDE_EXECUTABLE = executablePath;
    originalLocalAppData = process.env.LOCALAPPDATA;
  });

  afterEach(async () => {
    delete process.env.NEURA_IDE_EXECUTABLE;
    if (originalLocalAppData) {
      process.env.LOCALAPPDATA = originalLocalAppData;
    } else {
      delete process.env.LOCALAPPDATA;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
    const { CanvasIdeBridge } = await import('./canvas-ide-bridge');
    await CanvasIdeBridge.getInstance().stop();
  });

  it('reports configured Neura IDE availability', async () => {
    const { CanvasIdeLauncher } = await import('./canvas-ide-launcher');

    const status = await CanvasIdeLauncher.getInstance().getStatus();

    expect(status.available).toBe(true);
    expect(status.executablePath).toBe(executablePath);
    expect(status.configuredBy).toBe('env');
  });

  it('discovers a separately installed Neura IDE app', async () => {
    delete process.env.NEURA_IDE_EXECUTABLE;
    process.env.LOCALAPPDATA = tempDir;
    const installedPath = path.join(
      tempDir,
      'Programs',
      'Neura IDE',
      'Neura IDE.exe',
    );
    await fs.mkdir(path.dirname(installedPath), { recursive: true });
    await fs.writeFile(installedPath, '');
    const { CanvasIdeLauncher } = await import('./canvas-ide-launcher');

    const status = await CanvasIdeLauncher.getInstance().getStatus();

    expect(status.available).toBe(true);
    expect(status.executablePath).toBe(installedPath);
    expect(status.configuredBy).toBe('installed');
  });

  it('launches the workbench with project, bridge, and isolated directories', async () => {
    const { CanvasIdeLauncher } = await import('./canvas-ide-launcher');

    const result = await CanvasIdeLauncher.getInstance().openProject(project.id);

    expect(result.pid).toBe(4242);
    expect(spawned[0].executablePath).toBe(executablePath);
    expect(spawned[0].args).toContain('--user-data-dir');
    expect(spawned[0].args).toContain('--extensions-dir');
    expect(spawned[0].args).toContain(project.rootPath);
    expect(spawned[0].options.env?.NEURA_BRIDGE_URL).toMatch(/^http:\/\/127\.0\.0\.1:/);
    expect(spawned[0].options.env?.NEURA_BRIDGE_TOKEN).toBeTruthy();
    expect(spawned[0].options.env?.NEURA_PROJECT_ID).toBe(project.id);
  });
});
