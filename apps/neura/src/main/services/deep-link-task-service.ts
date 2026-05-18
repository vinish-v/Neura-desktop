/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { logger } from '@main/logger';

import { BackgroundTaskService } from './background-task-service';

export type DeepLinkTaskRequest = {
  goal: string;
  kind: 'multi_agent' | 'mcp_autonomous';
  sourceUrl: string;
};

const SUPPORTED_HOSTS = new Set(['task', 'run']);

export const parseTaskDeepLink = (value: string): DeepLinkTaskRequest | null => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'neura:' || !SUPPORTED_HOSTS.has(url.hostname)) {
    return null;
  }
  const goal = (url.searchParams.get('goal') || url.searchParams.get('q') || '')
    .trim()
    .slice(0, 8000);
  if (!goal) {
    throw new Error('Neura task deep link requires a non-empty goal parameter.');
  }
  const mode = (url.searchParams.get('mode') || '').trim();
  return {
    goal,
    kind: mode === 'mcp' ? 'mcp_autonomous' : 'multi_agent',
    sourceUrl: value,
  };
};

const extractDeepLinkUrls = (argv: string[]) =>
  argv.filter((value) => /^neura:\/\//i.test(value));

export class DeepLinkTaskService {
  private static instance: DeepLinkTaskService | null = null;
  private ready = false;
  private pendingUrls: string[] = [];

  static getInstance() {
    if (!DeepLinkTaskService.instance) {
      DeepLinkTaskService.instance = new DeepLinkTaskService();
    }
    return DeepLinkTaskService.instance;
  }

  async start(argv: string[] = []) {
    this.ready = true;
    await this.handleArgv(argv);
    await this.flushPending();
  }

  async handleArgv(argv: string[]) {
    for (const url of extractDeepLinkUrls(argv)) {
      await this.handleUrl(url);
    }
  }

  async handleUrl(value: string) {
    if (!this.ready) {
      this.pendingUrls.push(value);
      return null;
    }
    const request = parseTaskDeepLink(value);
    if (!request) {
      return null;
    }
    const task = await BackgroundTaskService.getInstance().enqueue({
      kind: request.kind,
      goal: request.goal,
      arguments: {
        intake: 'deep_link',
        sourceUrl: request.sourceUrl,
      },
    });
    logger.info(`[DeepLinkTaskService] queued task from ${request.sourceUrl}`);
    return task;
  }

  private async flushPending() {
    const pending = [...this.pendingUrls];
    this.pendingUrls = [];
    for (const url of pending) {
      await this.handleUrl(url);
    }
  }
}
