/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

import { SettingStore } from '@main/store/setting';
import type {
  DesktopProjectKnowledgeFile,
  DesktopProjectRecord,
} from '@main/store/types';

const MAX_PROJECTS = 100;
const MAX_PROJECT_RUNS = 80;
const MAX_PROJECT_MEMORY_ITEMS = 80;

type CreateProjectInput = {
  name: string;
  masterInstruction?: string;
  pinned?: boolean;
};

type UpdateProjectInput = Partial<CreateProjectInput> & {
  memory?: string[];
};

const requireText = (label: string, value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }
  return trimmed;
};

export class DesktopProjectsService {
  private static instance: DesktopProjectsService | null = null;

  static getInstance() {
    if (!DesktopProjectsService.instance) {
      DesktopProjectsService.instance = new DesktopProjectsService();
    }
    return DesktopProjectsService.instance;
  }

  list() {
    return [...((SettingStore.get('desktopProjects') || []) as DesktopProjectRecord[])]
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  }

  get(id: string) {
    return this.requireProject(id);
  }

  create(input: CreateProjectInput) {
    const now = Date.now();
    const project: DesktopProjectRecord = {
      id: `project_${now}_${randomUUID().slice(0, 8)}`,
      name: requireText('Project name', input.name),
      masterInstruction: input.masterInstruction?.trim() || '',
      pinned: Boolean(input.pinned),
      knowledgeFiles: [],
      runIds: [],
      memory: [],
      createdAt: now,
      updatedAt: now,
    };
    this.persist([project, ...this.list()].slice(0, MAX_PROJECTS));
    return project;
  }

  update(id: string, input: UpdateProjectInput) {
    const existing = this.requireProject(id);
    const updated: DesktopProjectRecord = {
      ...existing,
      name:
        input.name === undefined
          ? existing.name
          : requireText('Project name', input.name),
      masterInstruction:
        input.masterInstruction === undefined
          ? existing.masterInstruction
          : input.masterInstruction.trim(),
      pinned: input.pinned ?? existing.pinned,
      memory:
        input.memory === undefined
          ? existing.memory
          : input.memory
              .map((item) => item.trim())
              .filter(Boolean)
              .slice(0, MAX_PROJECT_MEMORY_ITEMS),
      updatedAt: Date.now(),
    };
    this.persist(
      this.list().map((project) => (project.id === id ? updated : project)),
    );
    return updated;
  }

  togglePin(id: string, pinned: boolean) {
    return this.update(id, { pinned });
  }

  delete(id: string) {
    this.requireProject(id);
    this.persist(this.list().filter((project) => project.id !== id));
    return { id, deleted: true };
  }

  async addKnowledgeFile(id: string, filePath: string) {
    const project = this.requireProject(id);
    const resolvedPath = path.resolve(requireText('Knowledge file path', filePath));
    const stats = await fs.promises.stat(resolvedPath);
    if (!stats.isFile()) {
      throw new Error(`Knowledge file is not a readable file: ${resolvedPath}`);
    }
    await fs.promises.access(resolvedPath, fs.constants.R_OK);

    const existing = project.knowledgeFiles.find(
      (file) => file.path.toLowerCase() === resolvedPath.toLowerCase(),
    );
    const fileRecord: DesktopProjectKnowledgeFile = {
      id: existing?.id || `knowledge_${Date.now()}_${randomUUID().slice(0, 8)}`,
      path: resolvedPath,
      name: path.basename(resolvedPath),
      sizeBytes: stats.size,
      updatedAt: stats.mtimeMs || Date.now(),
      addedAt: existing?.addedAt || Date.now(),
    };
    const knowledgeFiles = existing
      ? project.knowledgeFiles.map((file) =>
          file.id === existing.id ? fileRecord : file,
        )
      : [fileRecord, ...project.knowledgeFiles];
    return this.replaceProject({
      ...project,
      knowledgeFiles,
      updatedAt: Date.now(),
    });
  }

  removeKnowledgeFile(id: string, fileId: string) {
    const project = this.requireProject(id);
    return this.replaceProject({
      ...project,
      knowledgeFiles: project.knowledgeFiles.filter((file) => file.id !== fileId),
      updatedAt: Date.now(),
    });
  }

  recordRun(id: string, runId: string, memoryItem?: string) {
    const project = this.requireProject(id);
    const memory = memoryItem?.trim()
      ? [memoryItem.trim(), ...project.memory].slice(0, MAX_PROJECT_MEMORY_ITEMS)
      : project.memory;
    return this.replaceProject({
      ...project,
      runIds: [runId, ...project.runIds.filter((item) => item !== runId)].slice(
        0,
        MAX_PROJECT_RUNS,
      ),
      memory,
      updatedAt: Date.now(),
    });
  }

  buildProjectContext(id?: string) {
    if (!id) {
      return '';
    }
    const project = this.list().find((item) => item.id === id);
    if (!project) {
      throw new Error(`Project not found: ${id}`);
    }
    const knowledge = project.knowledgeFiles
      .map((file) => `- ${file.name}: ${file.path}`)
      .join('\n');
    const memory = project.memory.map((item) => `- ${item}`).join('\n');
    return [
      `Project: ${project.name}`,
      project.masterInstruction
        ? `Project master instruction:\n${project.masterInstruction}`
        : '',
      knowledge ? `Project knowledge files:\n${knowledge}` : '',
      memory ? `Project memory:\n${memory}` : '',
      'Use project files only as context; verify current file contents before relying on them.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private requireProject(id: string) {
    const project = this.list().find((item) => item.id === id);
    if (!project) {
      throw new Error(`Project not found: ${id}`);
    }
    return project;
  }

  private replaceProject(project: DesktopProjectRecord) {
    this.persist(
      this.list().map((item) => (item.id === project.id ? project : item)),
    );
    return project;
  }

  private persist(projects: DesktopProjectRecord[]) {
    SettingStore.set('desktopProjects', projects.slice(0, MAX_PROJECTS));
  }
}
