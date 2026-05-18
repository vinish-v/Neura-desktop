/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash, randomBytes } from 'crypto';
import http, { IncomingMessage, ServerResponse } from 'http';
import type { AddressInfo } from 'net';

import { logger } from '@main/logger';
import { SettingStore } from '@main/store/setting';
import type { BackgroundTaskKind, LocalTaskApiSettings } from '@main/store/types';

import { BackgroundTaskService } from './background-task-service';
import { TaskRunRegistry } from './taskRunRegistry';

const DEFAULT_PORT = 47837;
const MAX_BODY_BYTES = 64 * 1024;

type CreateTaskBody = {
  goal?: string;
  kind?: BackgroundTaskKind;
};

const hashToken = (token: string) =>
  createHash('sha256').update(token, 'utf8').digest('hex');

const generateToken = () => `neura_${randomBytes(24).toString('base64url')}`;

const writeJson = (
  response: ServerResponse,
  statusCode: number,
  body: unknown,
) => {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
};

const readJsonBody = async (request: IncomingMessage) =>
  new Promise<Record<string, unknown>>((resolve, reject) => {
    let bytes = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error('Request body is too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text) as Record<string, unknown>);
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });
    request.on('error', reject);
  });

export class LocalTaskApiService {
  private static instance: LocalTaskApiService | null = null;
  private server: http.Server | null = null;
  private listeningPort: number | null = null;

  static getInstance() {
    if (!LocalTaskApiService.instance) {
      LocalTaskApiService.instance = new LocalTaskApiService();
    }
    return LocalTaskApiService.instance;
  }

  async start() {
    const settings = this.getSettings();
    if (!settings.enabled) {
      await this.stop();
      return this.status();
    }
    if (this.server && this.listeningPort === settings.port) {
      return this.status();
    }
    await this.stop();
    if (!settings.tokenHash) {
      logger.warn(
        '[LocalTaskApiService] enabled without a token hash; refusing to listen until the user regenerates a token.',
      );
      return this.status(
        'Local task API is enabled but has no usable bearer token. Regenerate the token from Neura Desktop before using the API.',
      );
    }
    this.server = http.createServer((request, response) => {
      void this.handleRequest(request, response);
    });
    const listenError = await new Promise<Error | null>((resolve) => {
      const onError = (error: Error) => resolve(error);
      this.server?.once('error', onError);
      this.server?.listen(settings.port, '127.0.0.1', () => {
        this.server?.off('error', onError);
        const address = this.server?.address() as AddressInfo | null;
        this.listeningPort = address?.port || settings.port;
        resolve(null);
      });
    });
    if (listenError) {
      logger.warn('[LocalTaskApiService] failed to listen', listenError);
      await this.stop();
      return this.status(
        `Local task API could not listen on 127.0.0.1:${settings.port}: ${listenError.message}`,
      );
    }
    logger.info(
      `[LocalTaskApiService] listening on 127.0.0.1:${this.listeningPort}`,
    );
    return this.status();
  }

  async stop() {
    if (!this.server) {
      this.listeningPort = null;
      return;
    }
    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
    });
    this.server = null;
    this.listeningPort = null;
  }

  async enable(port = DEFAULT_PORT) {
    const token = generateToken();
    this.persistSettings({
      enabled: true,
      port,
      tokenHash: hashToken(token),
      tokenCreatedAt: Date.now(),
    });
    await this.start();
    return {
      ...(await this.status()),
      token,
    };
  }

  async disable() {
    this.persistSettings({
      ...this.getSettings(),
      enabled: false,
    });
    await this.stop();
    return this.status();
  }

  async regenerateToken() {
    const current = this.getSettings();
    const token = generateToken();
    this.persistSettings({
      ...current,
      tokenHash: hashToken(token),
      tokenCreatedAt: Date.now(),
    });
    return {
      ...(await this.status()),
      token,
    };
  }

  async status(setupGap?: string) {
    const settings = this.getSettings();
    const missingTokenGap =
      settings.enabled && !settings.tokenHash
        ? 'Local task API is enabled but has no usable bearer token. Regenerate the token from Neura Desktop before using the API.'
        : undefined;
    return {
      enabled: settings.enabled,
      listening: Boolean(this.server),
      port: this.listeningPort || settings.port,
      baseUrl: `http://127.0.0.1:${this.listeningPort || settings.port}`,
      tokenPresent: Boolean(settings.tokenHash),
      tokenCreatedAt: settings.tokenCreatedAt,
      setupGap: setupGap || missingTokenGap,
    };
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ) {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      if (url.pathname === '/health' && request.method === 'GET') {
        writeJson(response, 200, await this.status());
        return;
      }
      if (!this.isAuthorized(request)) {
        writeJson(response, 401, {
          error: 'Missing or invalid bearer token.',
        });
        return;
      }
      if (url.pathname === '/tasks' && request.method === 'POST') {
        const body = (await readJsonBody(request)) as CreateTaskBody;
        const goal = String(body.goal || '').trim();
        if (!goal) {
          writeJson(response, 400, { error: 'goal is required.' });
          return;
        }
        const kind =
          body.kind === 'mcp_autonomous' || body.kind === 'multi_agent'
            ? body.kind
            : 'multi_agent';
        const task = await BackgroundTaskService.getInstance().enqueue({
          kind,
          goal,
          arguments: {
            intake: 'local_task_api',
          },
        });
        writeJson(response, 202, { task });
        return;
      }
      if (url.pathname === '/tasks' && request.method === 'GET') {
        writeJson(response, 200, {
          tasks: BackgroundTaskService.getInstance().list(),
        });
        return;
      }
      const taskMatch = url.pathname.match(/^\/tasks\/([^/]+)$/u);
      if (taskMatch && request.method === 'GET') {
        const task = BackgroundTaskService.getInstance()
          .list()
          .find((item) => item.id === decodeURIComponent(taskMatch[1]));
        if (!task) {
          writeJson(response, 404, { error: 'Task not found.' });
          return;
        }
        writeJson(response, 200, { task });
        return;
      }
      const runMatch = url.pathname.match(/^\/runs\/([^/]+)$/u);
      if (runMatch && request.method === 'GET') {
        const run = TaskRunRegistry.list().find(
          (item) => item.runId === decodeURIComponent(runMatch[1]),
        );
        if (!run) {
          writeJson(response, 404, { error: 'Run not found.' });
          return;
        }
        writeJson(response, 200, { run });
        return;
      }
      writeJson(response, 404, { error: 'Endpoint not found.' });
    } catch (error) {
      writeJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private isAuthorized(request: IncomingMessage) {
    const tokenHash = this.getSettings().tokenHash;
    if (!tokenHash) {
      return false;
    }
    const authorization = request.headers.authorization || '';
    const match = /^Bearer\s+(.+)$/iu.exec(String(authorization));
    return Boolean(match?.[1] && hashToken(match[1]) === tokenHash);
  }

  private getSettings(): LocalTaskApiSettings {
    const settings = SettingStore.get('localTaskApi');
    return {
      enabled: Boolean(settings?.enabled),
      port:
        typeof settings?.port === 'number' &&
        settings.port >= 0 &&
        settings.port <= 65535
          ? settings.port
          : DEFAULT_PORT,
      tokenHash: settings?.tokenHash,
      tokenCreatedAt: settings?.tokenCreatedAt,
    };
  }

  private persistSettings(settings: LocalTaskApiSettings) {
    SettingStore.set('localTaskApi', settings);
  }
}
