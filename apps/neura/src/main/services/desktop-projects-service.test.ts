import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DesktopProjectRecord } from '@main/store/types';

const mocks = vi.hoisted(() => ({
  desktopProjects: [] as DesktopProjectRecord[],
  settingGet: vi.fn((key: string) =>
    key === 'desktopProjects' ? mocks.desktopProjects : undefined,
  ),
  settingSet: vi.fn((key: string, value: DesktopProjectRecord[]) => {
    if (key === 'desktopProjects') {
      mocks.desktopProjects = value;
    }
  }),
}));

vi.mock('@main/store/setting', () => ({
  SettingStore: {
    get: mocks.settingGet,
    set: mocks.settingSet,
  },
}));

import { DesktopProjectsService } from './desktop-projects-service';

describe('DesktopProjectsService', () => {
  let tempDir = '';

  beforeEach(() => {
    mocks.desktopProjects = [];
    mocks.settingGet.mockClear();
    mocks.settingSet.mockClear();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neura-project-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('persists projects, pin state, memory, and run history', () => {
    const service = new DesktopProjectsService();
    const project = service.create({
      name: 'Launch',
      masterInstruction: 'Use the launch plan.',
    });

    const pinned = service.togglePin(project.id, true);
    expect(pinned.pinned).toBe(true);

    const updated = service.update(project.id, {
      memory: ['Prefer official sources', ''],
    });
    expect(updated.memory).toEqual(['Prefer official sources']);

    const recorded = service.recordRun(project.id, 'run-1', 'Finished report');
    expect(recorded.runIds).toEqual(['run-1']);
    expect(recorded.memory[0]).toBe('Finished report');
  });

  it('stores real knowledge-file metadata and rejects missing files', async () => {
    const service = new DesktopProjectsService();
    const project = service.create({ name: 'Knowledge' });
    const filePath = path.join(tempDir, 'brief.md');
    fs.writeFileSync(filePath, 'real project context');

    const updated = await service.addKnowledgeFile(project.id, filePath);

    expect(updated.knowledgeFiles[0]).toEqual(
      expect.objectContaining({
        path: filePath,
        name: 'brief.md',
        sizeBytes: 20,
      }),
    );
    await expect(
      service.addKnowledgeFile(project.id, path.join(tempDir, 'missing.md')),
    ).rejects.toThrow('ENOENT');
  });

  it('builds project context from persisted instructions and files', async () => {
    const service = new DesktopProjectsService();
    const project = service.create({
      name: 'Research',
      masterInstruction: 'Always cite.',
    });
    const filePath = path.join(tempDir, 'source.txt');
    fs.writeFileSync(filePath, 'citation source');
    await service.addKnowledgeFile(project.id, filePath);
    service.recordRun(project.id, 'run-1', 'Use recent filings');

    const context = service.buildProjectContext(project.id);

    expect(context).toContain('Project: Research');
    expect(context).toContain('Always cite.');
    expect(context).toContain(filePath);
    expect(context).toContain('Use recent filings');
  });
});
