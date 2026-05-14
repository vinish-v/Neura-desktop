/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'crypto';
import http, { IncomingMessage, ServerResponse } from 'http';
import { AddressInfo } from 'net';

import {
  CanvasAiMode,
  CanvasProject,
  CanvasService,
  UpdateCanvasProjectInput,
} from './canvas-service';
import { CanvasAiCoder } from './canvas-ai-coder';

const BRIDGE_HOST = '127.0.0.1';
const TOKEN_BYTES = 32;
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export type CanvasIdeBridgeSession = {
  projectId: string;
  token: string;
  url: string;
  expiresAt: number;
};

type BridgeSessionState = CanvasIdeBridgeSession & {
  createdAt: number;
};

type JsonResponse =
  | CanvasProject
  | CanvasIdeBridgeSession
  | Record<string, unknown>
  | Array<Record<string, unknown>>;

const makeToken = () =>
  Buffer.from(`${randomUUID()}${randomUUID()}`).toString('base64url').slice(
    0,
    TOKEN_BYTES,
  );

const parseJsonBody = async <T>(request: IncomingMessage): Promise<T> => {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      throw new Error('Request body is too large.');
    }
    chunks.push(buffer);
  }
  if (!chunks.length) {
    return {} as T;
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
};

const sendJson = (
  response: ServerResponse,
  statusCode: number,
  payload: JsonResponse,
) => {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
};

const readBearerToken = (request: IncomingMessage) => {
  const header = request.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(Array.isArray(header) ? header[0] : header);
  return match?.[1] || '';
};

const normalizeMode = (value: unknown): CanvasAiMode => {
  if (
    value === 'ask' ||
    value === 'plan' ||
    value === 'agent' ||
    value === 'builder'
  ) {
    return value;
  }
  return 'ask';
};

export class CanvasIdeBridge {
  private static instance: CanvasIdeBridge | null = null;

  private server: http.Server | null = null;
  private baseUrl: string | null = null;
  private sessions = new Map<string, BridgeSessionState>();

  static getInstance() {
    if (!CanvasIdeBridge.instance) {
      CanvasIdeBridge.instance = new CanvasIdeBridge();
    }
    return CanvasIdeBridge.instance;
  }

  async createSession(projectId: string): Promise<CanvasIdeBridgeSession> {
    await CanvasService.getInstance().getProject(projectId);
    await this.ensureServer();
    this.pruneExpiredSessions();

    const token = makeToken();
    const now = Date.now();
    const session: BridgeSessionState = {
      projectId,
      token,
      url: this.baseUrl!,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    };
    this.sessions.set(token, session);
    return {
      projectId: session.projectId,
      token: session.token,
      url: session.url,
      expiresAt: session.expiresAt,
    };
  }

  getStatus() {
    this.pruneExpiredSessions();
    return {
      running: Boolean(this.server && this.baseUrl),
      url: this.baseUrl,
      activeSessions: this.sessions.size,
    };
  }

  async stop() {
    if (!this.server) {
      return;
    }
    const server = this.server;
    this.server = null;
    this.baseUrl = null;
    this.sessions.clear();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private async ensureServer() {
    if (this.server && this.baseUrl) {
      return;
    }
    this.server = http.createServer((request, response) => {
      void this.handleRequest(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, BRIDGE_HOST, () => resolve());
    });
    const address = this.server.address() as AddressInfo;
    this.baseUrl = `http://${BRIDGE_HOST}:${address.port}`;
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ) {
    try {
      const url = new URL(request.url || '/', `http://${BRIDGE_HOST}`);
      const session = this.authenticate(request);
      if (!session) {
        sendJson(response, 401, { error: 'Unauthorized Neura IDE bridge request.' });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, {
          ok: true,
          projectId: session.projectId,
          expiresAt: session.expiresAt,
        });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/project') {
        sendJson(
          response,
          200,
          await CanvasService.getInstance().getProject(session.projectId),
        );
        return;
      }

      if (request.method === 'POST' && url.pathname === '/project/refresh') {
        sendJson(
          response,
          200,
          await CanvasService.getInstance().refreshProjectFiles(session.projectId),
        );
        return;
      }

      if (request.method === 'GET' && url.pathname === '/ai/session') {
        sendJson(response, 200, {
          session: await CanvasService.getInstance().getAiSession(
            session.projectId,
          ),
          nim: CanvasAiCoder.getConfigStatus(),
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/ai/session/mode') {
        const body = await parseJsonBody<{ mode?: CanvasAiMode }>(request);
        sendJson(response, 200, {
          session: await CanvasService.getInstance().setAiMode(
            session.projectId,
            normalizeMode(body.mode),
          ),
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/ai/session/context') {
        const body = await parseJsonBody<{ files?: string[] }>(request);
        sendJson(response, 200, {
          session: await CanvasService.getInstance().setAiContext(
            session.projectId,
            Array.isArray(body.files) ? body.files : [],
          ),
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/ai/session/messages') {
        const body = await parseJsonBody<{
          content?: string;
          mode?: CanvasAiMode;
        }>(request);
        const mode = normalizeMode(body.mode);
        const content = body.content || '';
        await CanvasService.getInstance().setAiMode(session.projectId, mode);
        await CanvasService.getInstance().addAiMessage({
          projectId: session.projectId,
          role: 'user',
          mode,
          content,
        });

        const project = await CanvasService.getInstance().getProject(
          session.projectId,
        );
        if (mode === 'ask') {
          const answer = await CanvasAiCoder.answer(project, content);
          const result = await CanvasService.getInstance().addAiMessage({
            projectId: session.projectId,
            role: 'assistant',
            mode,
            content: answer.summary,
            referencedFiles: answer.referencedFiles,
          });
          sendJson(response, 200, {
            project: result.project,
            message: result.message,
            session: result.project.aiSession,
          });
          return;
        }

        if (mode === 'plan') {
          const aiPlan = await CanvasAiCoder.generatePlan(project, content);
          const planResult = await CanvasService.getInstance().createComposerPlan({
            projectId: session.projectId,
            prompt: content || aiPlan.summary,
            aiSteps: aiPlan.steps,
          });
          const result = await CanvasService.getInstance().addAiMessage({
            projectId: session.projectId,
            role: 'assistant',
            mode,
            content: aiPlan.summary,
            planId: planResult.plan.id,
          });
          sendJson(response, 200, {
            project: result.project,
            plan: planResult.plan,
            message: result.message,
            session: result.project.aiSession,
          });
          return;
        }

        const edits = await CanvasAiCoder.generateEdits(project, content);
        const proposalResult =
          await CanvasService.getInstance().saveAiEditProposal({
            projectId: session.projectId,
            prompt: content,
            mode,
            summary: edits.summary,
            edits: edits.edits,
            verificationCommand: edits.verificationCommand,
          });
        const result = await CanvasService.getInstance().addAiMessage({
          projectId: session.projectId,
          role: 'assistant',
          mode,
          content: edits.summary,
          proposalId: proposalResult.proposal.id,
        });
        sendJson(response, 200, {
          project: result.project,
          proposal: proposalResult.proposal,
          message: result.message,
          session: result.project.aiSession,
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/ai/session/plan') {
        const body = await parseJsonBody<{ prompt?: string }>(request);
        const project = await CanvasService.getInstance().getProject(
          session.projectId,
        );
        const aiPlan = await CanvasAiCoder.generatePlan(project, body.prompt || '');
        const result = await CanvasService.getInstance().createComposerPlan({
          projectId: session.projectId,
          prompt: body.prompt || aiPlan.summary,
          aiSteps: aiPlan.steps,
        });
        await CanvasService.getInstance().addAiMessage({
          projectId: session.projectId,
          role: 'assistant',
          mode: 'plan',
          content: aiPlan.summary,
          planId: result.plan.id,
        });
        sendJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/ai/session/agent-step') {
        const body = await parseJsonBody<{
          prompt?: string;
          terminalRunId?: string;
        }>(request);
        const project = await CanvasService.getInstance().getProject(
          session.projectId,
        );
        const terminalRun = project.terminalRuns.find(
          (run) => run.id === body.terminalRunId,
        );
        const terminalOutput = terminalRun
          ? [
              `command: ${terminalRun.command}`,
              `exitCode: ${terminalRun.exitCode}`,
              terminalRun.stdout,
              terminalRun.stderr,
            ].join('\n')
          : '';
        const edits = terminalOutput
          ? await CanvasAiCoder.continueAfterTerminal(
              project,
              body.prompt || '',
              terminalOutput,
            )
          : await CanvasAiCoder.generateEdits(project, body.prompt || '');
        const proposalResult =
          await CanvasService.getInstance().saveAiEditProposal({
            projectId: session.projectId,
            prompt: body.prompt || '',
            mode: 'agent',
            summary: edits.summary,
            edits: edits.edits,
            verificationCommand: edits.verificationCommand,
          });
        await CanvasService.getInstance().addAiMessage({
          projectId: session.projectId,
          role: 'assistant',
          mode: 'agent',
          content: edits.summary,
          proposalId: proposalResult.proposal.id,
        });
        sendJson(response, 200, proposalResult);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/ai/edits/propose') {
        const body = await parseJsonBody<{
          prompt?: string;
          mode?: CanvasAiMode;
        }>(request);
        const project = await CanvasService.getInstance().getProject(
          session.projectId,
        );
        const mode = normalizeMode(body.mode);
        if (mode === 'ask') {
          throw new Error('Ask mode cannot propose file edits.');
        }
        const edits = await CanvasAiCoder.generateEdits(project, body.prompt || '');
        sendJson(
          response,
          200,
          await CanvasService.getInstance().saveAiEditProposal({
            projectId: session.projectId,
            prompt: body.prompt || '',
            mode,
            summary: edits.summary,
            edits: edits.edits,
            verificationCommand: edits.verificationCommand,
          }),
        );
        return;
      }

      if (request.method === 'POST' && url.pathname === '/ai/edits/apply') {
        const body = await parseJsonBody<{
          proposalId?: string;
          filePaths?: string[];
        }>(request);
        sendJson(
          response,
          200,
          await CanvasService.getInstance().applyAiEditProposal(
            session.projectId,
            body.proposalId || '',
            body.filePaths,
          ),
        );
        return;
      }

      if (request.method === 'POST' && url.pathname === '/ai/edits/reject') {
        const body = await parseJsonBody<{
          proposalId?: string;
          filePaths?: string[];
        }>(request);
        sendJson(
          response,
          200,
          await CanvasService.getInstance().rejectAiEditProposal(
            session.projectId,
            body.proposalId || '',
            body.filePaths,
          ),
        );
        return;
      }

      const checkpointRestoreMatch = /^\/ai\/checkpoints\/([^/]+)\/restore$/.exec(
        url.pathname,
      );
      if (request.method === 'POST' && checkpointRestoreMatch) {
        sendJson(
          response,
          200,
          await CanvasService.getInstance().restoreAiCheckpoint(
            session.projectId,
            decodeURIComponent(checkpointRestoreMatch[1]),
          ),
        );
        return;
      }

      if (request.method === 'GET' && url.pathname === '/preview/status') {
        const project = await CanvasService.getInstance().getProject(
          session.projectId,
        );
        sendJson(response, 200, {
          available: true,
          projectId: project.id,
          rootPath: project.rootPath,
          entryFile: project.entryFile,
          lastTerminalRun: project.terminalRuns[0] || null,
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/composer/plans') {
        const body = await parseJsonBody<{ prompt?: string }>(request);
        sendJson(
          response,
          200,
          await CanvasService.getInstance().createComposerPlan({
            projectId: session.projectId,
            prompt: body.prompt || '',
          }),
        );
        return;
      }

      if (request.method === 'POST' && url.pathname === '/ai/plan') {
        const body = await parseJsonBody<{ prompt?: string }>(request);
        const project = await CanvasService.getInstance().getProject(
          session.projectId,
        );
        const aiPlan = await CanvasAiCoder.generatePlan(
          project,
          body.prompt || '',
        );
        sendJson(
          response,
          200,
          await CanvasService.getInstance().createComposerPlan({
            projectId: session.projectId,
            prompt: body.prompt || aiPlan.summary,
            aiSteps: aiPlan.steps,
          }),
        );
        return;
      }

      if (request.method === 'POST' && url.pathname === '/ai/edits') {
        const body = await parseJsonBody<{ prompt?: string }>(request);
        const project = await CanvasService.getInstance().getProject(
          session.projectId,
        );
        sendJson(
          response,
          200,
          await CanvasAiCoder.generateEdits(project, body.prompt || ''),
        );
        return;
      }

      const approveMatch = /^\/composer\/plans\/([^/]+)\/approve$/.exec(
        url.pathname,
      );
      if (request.method === 'POST' && approveMatch) {
        sendJson(
          response,
          200,
          await CanvasService.getInstance().approveComposerPlan(
            session.projectId,
            decodeURIComponent(approveMatch[1]),
          ),
        );
        return;
      }

      const rejectMatch = /^\/composer\/plans\/([^/]+)\/reject$/.exec(
        url.pathname,
      );
      if (request.method === 'POST' && rejectMatch) {
        sendJson(
          response,
          200,
          await CanvasService.getInstance().rejectComposerPlan(
            session.projectId,
            decodeURIComponent(rejectMatch[1]),
          ),
        );
        return;
      }

      if (request.method === 'POST' && url.pathname === '/files/apply') {
        const body = await parseJsonBody<{
          edits?: Array<Pick<UpdateCanvasProjectInput, 'filePath' | 'content'>>;
          versionLabel?: string;
        }>(request);
        if (!Array.isArray(body.edits) || body.edits.length === 0) {
          throw new Error('At least one file edit is required.');
        }
        let project = await CanvasService.getInstance().getProject(
          session.projectId,
        );
        for (const edit of body.edits) {
          project = await CanvasService.getInstance().updateProject({
            projectId: session.projectId,
            filePath: edit.filePath,
            content: edit.content,
            versionLabel: body.versionLabel || `Neura IDE edit: ${edit.filePath}`,
          });
        }
        sendJson(response, 200, project);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/terminal/request') {
        const body = await parseJsonBody<{
          command?: string;
          approved?: boolean;
        }>(request);
        if (!body.approved) {
          await CanvasService.getInstance().recordAiTerminalCard(
            session.projectId,
            body.command || '',
            'requires_approval',
          );
          sendJson(response, 202, {
            requiresApproval: true,
            command: body.command || '',
          });
          return;
        }
        const result = await CanvasService.getInstance().runCommand({
          projectId: session.projectId,
          command: body.command || '',
          approved: true,
        });
        const card = await CanvasService.getInstance().recordAiTerminalCard(
          session.projectId,
          body.command || '',
          result.result.exitCode === 0 ? 'completed' : 'failed',
          result.result.id,
        );
        sendJson(response, 200, {
          ...result,
          card: card.card,
          project: card.project,
        });
        return;
      }

      sendJson(response, 404, { error: 'Unknown Neura IDE bridge route.' });
    } catch (error) {
      sendJson(response, 400, {
        error: error instanceof Error ? error.message : 'Bridge request failed.',
      });
    }
  }

  private authenticate(request: IncomingMessage) {
    this.pruneExpiredSessions();
    const token = readBearerToken(request);
    return token ? this.sessions.get(token) || null : null;
  }

  private pruneExpiredSessions() {
    const now = Date.now();
    for (const [token, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(token);
      }
    }
  }
}
