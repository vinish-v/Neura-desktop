/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs';
import path from 'path';

import { app, ipcMain } from 'electron';
import {
  SkillsRegistry,
  type SkillDefinition,
  type SkillMetadata,
  skillSlug,
} from '@agent-infra/shared';

import { logger } from '@main/logger';
import { SettingStore } from '@main/store/setting';

const findWorkspaceRoot = (start: string) => {
  let current = start;
  while (current && current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
      return current;
    }
    current = path.dirname(current);
  }
  return start;
};

const workspaceRoot = findWorkspaceRoot(process.cwd());

export class SkillsService {
  private static instance: SkillsService | null = null;
  private readonly userSkillsDir = path.join(app.getPath('userData'), 'skills');
  private readonly builtInSkillsDir = path.join(workspaceRoot, 'skills');
  private readonly appSkillsDir = path.join(app.getAppPath(), 'skills');
  private readonly registry = new SkillsRegistry({
    directories: [this.userSkillsDir, this.builtInSkillsDir, this.appSkillsDir],
  });

  static getInstance() {
    if (!SkillsService.instance) {
      SkillsService.instance = new SkillsService();
    }
    return SkillsService.instance;
  }

  isEnabled() {
    return SettingStore.getStore().skillsEnabled !== false;
  }

  async list(): Promise<SkillMetadata[]> {
    if (!this.isEnabled()) {
      return [];
    }
    return this.registry.list();
  }

  async get(name: string): Promise<SkillDefinition | null> {
    if (!this.isEnabled()) {
      return null;
    }
    return this.registry.get(name);
  }

  async save(skill: SkillDefinition) {
    if (!this.isEnabled()) {
      throw new Error('Skills are disabled in settings.');
    }
    const saved = await this.registry.save(skill, this.userSkillsDir);
    logger.info('[SkillsService] saved skill', saved.name);
    return saved;
  }

  async delete(name: string) {
    if (!this.isEnabled()) {
      throw new Error('Skills are disabled in settings.');
    }
    return this.registry.delete(name);
  }

  async refresh() {
    return this.registry.refresh();
  }

  async execute(input: {
    name: string;
    arguments?: Record<string, unknown>;
    goal?: string;
  }) {
    const skill = await this.get(input.name);
    if (!skill) {
      throw new Error(`Skill not found: ${input.name}`);
    }
    const { TaskManager } = await import('./task-manager');
    return TaskManager.getInstance().startSkillTask({
      skillName: skill.name,
      arguments: input.arguments || {},
      goal: input.goal,
    });
  }

  async generateFromRun(runId: string) {
    const { TaskRunRegistry } = await import('./taskRunRegistry');
    const run = TaskRunRegistry.list().find((item) => item.runId === runId);
    if (!run || run.status !== 'completed') {
      throw new Error('Only completed runs can be saved as skills.');
    }

    const name =
      skillSlug(run.originalGoal).slice(0, 48) || `skill-${Date.now()}`;
    const instructions = [
      `Repeat this successful Neura workflow with fresh inputs.`,
      '',
      `Original goal: ${run.originalGoal}`,
      '',
      'Observed steps:',
      ...run.progressItems
        .slice(0, 12)
        .map(
          (item) => `- ${item.title}${item.detail ? `: ${item.detail}` : ''}`,
        ),
      '',
      'When executing, adapt the workflow to the new user arguments, use MCP tools when useful, and finish with a concise verified answer.',
    ].join('\n');

    return this.save({
      name,
      description: `Reusable workflow generated from run ${run.runId}.`,
      instructions,
      tools: [],
      examples: [
        {
          input: run.originalGoal,
          output: run.finalAnswer,
        },
      ],
      tags: ['generated', run.runMode],
      version: '1.0.0',
      author: 'Neura',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
}

let rawSkillsIpcRegistered = false;

export const registerSkillsIpcHandlers = () => {
  if (rawSkillsIpcRegistered) {
    return;
  }
  rawSkillsIpcRegistered = true;
  const service = SkillsService.getInstance();

  ipcMain.handle('skills:list', async () => service.list());
  ipcMain.handle('skills:get', async (_event, params: { name: string }) =>
    service.get(params.name),
  );
  ipcMain.handle('skills:save', async (_event, params: SkillDefinition) =>
    service.save(params),
  );
  ipcMain.handle('skills:delete', async (_event, params: { name: string }) =>
    service.delete(params.name),
  );
  ipcMain.handle(
    'skills:execute',
    async (
      _event,
      params: {
        name: string;
        arguments?: Record<string, unknown>;
        goal?: string;
      },
    ) => service.execute(params),
  );
};
