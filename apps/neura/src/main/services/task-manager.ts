/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

import { StatusEnum } from '@neura-desktop/shared/types';

import { logger } from '@main/logger';
import { store } from '@main/store/create';
import { SettingStore } from '@main/store/setting';
import {
  AgentRunMode,
  ArtifactKind,
  CompletionProof,
  TaskArtifact,
  TaskRunRecord,
} from '@main/store/types';
import { ComputerRuntimeController } from './computerRuntimeController';
import {
  HermesBridgeEvent,
  HermesRuntimeService,
} from './hermesRuntime';
import {
  getTaskContextHint,
  prepareTaskRunContext,
} from './taskContextMemory';
import {
  buildTaskRunEvidenceRequirements,
  collectTaskEvidenceForRun,
  createTaskRun,
  TaskRunRegistry,
} from './taskRunRegistry';
import { classifyHermesTask, HermesTaskRoute } from './hermesTaskRouter';
import { summarizeSourceQuality } from './sourceQuality';
import { buildAutomationRecoveryReport } from '@shared/browserAutomationRecovery';
import { TaskEvidenceRequirements, validateTaskEvidence } from '@shared/taskEvidence';

type TaskStartOptions = {
  signal?: AbortSignal;
  backgroundTaskId?: string;
  runMode?: AgentRunMode;
  publicGoal?: string;
  toolsets?: string[];
  sessionId?: string;
  retryOfRunId?: string;
  retryCount?: number;
};

const compact = (value: string, limit = 1200) =>
  value.length > limit ? `${value.slice(0, limit)}...` : value;

const compactJson = (value: unknown, limit = 1200) => {
  try {
    return compact(JSON.stringify(value || {}, null, 2), limit);
  } catch {
    return compact(String(value || ''), limit);
  }
};

const ARTIFACT_EXTENSIONS: Record<
  string,
  { kind: ArtifactKind; mimeType?: string }
> = {
  '.csv': { kind: 'data', mimeType: 'text/csv' },
  '.doc': { kind: 'document' },
  '.docx': {
    kind: 'document',
    mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  '.gif': { kind: 'image', mimeType: 'image/gif' },
  '.htm': { kind: 'website', mimeType: 'text/html' },
  '.html': { kind: 'website', mimeType: 'text/html' },
  '.jpeg': { kind: 'image', mimeType: 'image/jpeg' },
  '.jpg': { kind: 'image', mimeType: 'image/jpeg' },
  '.json': { kind: 'data', mimeType: 'application/json' },
  '.md': { kind: 'report', mimeType: 'text/markdown' },
  '.mov': { kind: 'video', mimeType: 'video/quicktime' },
  '.mp3': { kind: 'audio', mimeType: 'audio/mpeg' },
  '.mp4': { kind: 'video', mimeType: 'video/mp4' },
  '.pdf': { kind: 'document', mimeType: 'application/pdf' },
  '.png': { kind: 'image', mimeType: 'image/png' },
  '.ppt': { kind: 'presentation' },
  '.pptx': {
    kind: 'presentation',
    mimeType:
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  '.tsv': { kind: 'data', mimeType: 'text/tab-separated-values' },
  '.txt': { kind: 'document', mimeType: 'text/plain' },
  '.wav': { kind: 'audio', mimeType: 'audio/wav' },
  '.webm': { kind: 'video', mimeType: 'video/webm' },
  '.xls': { kind: 'spreadsheet' },
  '.xlsx': {
    kind: 'spreadsheet',
    mimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  '.zip': { kind: 'archive', mimeType: 'application/zip' },
};

const IGNORED_ARTIFACT_NAMES = new Set(['context.md']);
const ARTIFACT_MANIFEST_NAME = 'neura-artifacts.json';
const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>)]{4,}/gi;

const getArtifactMetadata = (filePath: string) =>
  ARTIFACT_EXTENSIONS[path.extname(filePath).toLowerCase()] || {
    kind: 'other' as ArtifactKind,
  };

const buildHermesTaskPrompt = (
  goal: string,
  run: TaskRunRecord,
  route: HermesTaskRoute,
) =>
  [
    'You are running inside Neura Desktop through the Hermes backend.',
    'Use the full Hermes toolset when useful: browser, terminal, files, skills, memory, session search, todo, delegation, code execution, cron, vision, image/audio/video tools, and MCP tools if configured.',
    'Neura is the UI cockpit. Keep progress observable through tool use and save user-facing deliverables into the workspace below.',
    'Optimize for speed: act immediately, avoid ceremony, use the fewest tools needed, and do not delegate or create a long plan unless the task is genuinely complex.',
    'For simple research or browsing tasks, open the strongest source quickly, extract the answer, cite the source, and finish without repeated searching.',
    route.validationHint,
    ...route.promptDirectives,
    `Workspace: ${run.workspacePath || 'default Hermes working directory'}`,
    'Use Hermes persistent memory for durable preferences, corrections, and stable environment facts. Do not save secrets or transient task logs to memory.',
    getTaskContextHint(run).trim(),
    '',
    'User task:',
    goal,
  ]
    .filter(Boolean)
    .join('\n');

const discoverRunArtifacts = async (
  run: TaskRunRecord,
): Promise<Array<Omit<TaskArtifact, 'sourceRunId'>>> => {
  if (!run.workspacePath) {
    return [];
  }

  const root = path.resolve(run.workspacePath);
  const artifacts: Array<Omit<TaskArtifact, 'sourceRunId'>> = [];
  const stack = [root];
  const maxArtifacts = 80;

  while (stack.length && artifacts.length < maxArtifacts) {
    const directory = stack.pop();
    if (!directory) {
      continue;
    }

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', '.git', '.venv', 'venv'].includes(entry.name)) {
          stack.push(entryPath);
        }
        continue;
      }
      if (
        !entry.isFile() ||
        IGNORED_ARTIFACT_NAMES.has(entry.name) ||
        entry.name === ARTIFACT_MANIFEST_NAME
      ) {
        continue;
      }

      let stats: fs.Stats;
      try {
        stats = await fs.promises.stat(entryPath);
      } catch {
        continue;
      }
      if (stats.size <= 0) {
        continue;
      }

      const metadata = getArtifactMetadata(entryPath);
      artifacts.push({
        id: `artifact-${Date.now()}-${artifacts.length}`,
        title: entry.name,
        kind: metadata.kind,
        mimeType: metadata.mimeType,
        path: entryPath,
        createdAt: stats.birthtimeMs || stats.mtimeMs || Date.now(),
      });
    }
  }

  return artifacts.sort((a, b) => a.path.localeCompare(b.path));
};

const writeArtifactManifest = async (
  run: TaskRunRecord,
  artifacts: Array<Omit<TaskArtifact, 'sourceRunId'>>,
) => {
  if (!run.workspacePath) {
    return undefined;
  }
  const manifestPath = path.join(run.workspacePath, ARTIFACT_MANIFEST_NAME);
  const manifest = {
    runId: run.runId,
    sessionId: run.sessionId,
    taskMode: run.taskMode,
    originalGoal: run.originalGoal,
    artifacts: artifacts.map((artifact) => ({
      id: artifact.id,
      title: artifact.title,
      kind: artifact.kind,
      mimeType: artifact.mimeType,
      path: artifact.path,
      createdAt: artifact.createdAt,
    })),
    writtenAt: Date.now(),
  };
  await fs.promises.writeFile(
    manifestPath,
    JSON.stringify(manifest, null, 2),
    'utf8',
  );
  return manifestPath;
};

const extractUrls = (...values: Array<unknown>) => {
  const urls = new Set<string>();
  for (const value of values) {
    const text =
      typeof value === 'string'
        ? value
        : value
          ? compactJson(value, 4000)
          : '';
    for (const match of text.matchAll(URL_PATTERN)) {
      urls.add(match[0].replace(/[.,;]+$/u, ''));
    }
  }
  return [...urls];
};

const getStringField = (value: unknown, key: string) =>
  value && typeof value === 'object' && typeof (value as Record<string, unknown>)[key] === 'string'
    ? ((value as Record<string, unknown>)[key] as string)
    : undefined;

const isAutomationToolEvent = (event: HermesBridgeEvent) => {
  const toolName = event.toolName || '';
  return /browser|page|dom|click|type|navigate|screenshot|computer|desktop|mouse|keyboard/i.test(
    toolName,
  );
};

const recordAutomationRecovery = (
  runId: string,
  event: HermesBridgeEvent,
) => {
  if (!event.isError || !isAutomationToolEvent(event)) {
    return;
  }

  const message = [event.resultPreview, event.preview, event.error, event.traceback]
    .filter(Boolean)
    .join('\n');
  const report = buildAutomationRecoveryReport({
    surface: /browser|page|dom|navigate|screenshot/i.test(event.toolName || '')
      ? 'browser'
      : 'computer',
    toolName: event.toolName,
    action: event.toolName,
    message,
    url: getStringField(event.arguments, 'url'),
    selector:
      getStringField(event.arguments, 'selector') ||
      getStringField(event.arguments, 'locator'),
  });

  TaskRunRegistry.addEvidence(runId, report.evidence);
  TaskRunRegistry.addProgress(runId, {
    title: `${report.label}`,
    detail: [
      report.userFacingMessage,
      `Next action: ${report.nextAction.replace(/_/g, ' ')}`,
      `Evidence: ${report.evidence.summary}`,
    ].join('\n'),
    status: report.status === 'retryable' ? 'in_progress' : 'failed',
    eventType: 'automation.recovery',
  });
};

const validateRunCompletion = (
  run: TaskRunRecord,
  route: HermesTaskRoute,
  result: { finalAnswer: string },
  artifacts: Array<Omit<TaskArtifact, 'sourceRunId'>>,
): { valid: true; proof: CompletionProof } | { valid: false; failures: string[] } => {
  const finalAnswer = (result.finalAnswer || '').trim();
  const currentRun =
    TaskRunRegistry.list().find((item) => item.runId === run.runId) || run;
  const sourceQuality = summarizeSourceQuality(currentRun.sourceRecords);
  const evidence = collectTaskEvidenceForRun(currentRun);
  const requirements: TaskEvidenceRequirements = {
    ...buildTaskRunEvidenceRequirements(currentRun),
    requireEvidence: true,
    requireCitationSource: route.requiresSource,
    minimumCitationSources: route.requiresSource ? 1 : undefined,
    minimumMediumConfidenceSources: route.taskMode === 'research' ? 1 : undefined,
    requireFileArtifact: route.requiredArtifactKinds.length > 0,
    acceptedArtifactKinds: route.requiredArtifactKinds,
  };
  const evidenceValidation = validateTaskEvidence({
    claim: /^Neura completed without a final answer/i.test(finalAnswer)
      ? ''
      : finalAnswer,
    evidence,
    requirements,
    knownFailures: currentRun.validationFailures,
  });

  TaskRunRegistry.patch(currentRun.runId, {
    evidence: evidenceValidation.safeEvidence,
    evidenceValidation,
  });

  if (evidenceValidation.completionStatus !== 'verified') {
    return { valid: false, failures: evidenceValidation.missingEvidence };
  }

  return {
    valid: true,
    proof: {
      kind:
        artifacts.length > 0
          ? 'artifact'
          : route.requiresSource
            ? 'source'
            : 'connector_action',
      summary: 'Neura validated the final answer against recorded task evidence.',
      evidence: [
        compact(finalAnswer),
        sourceQuality.sourceCount
          ? `Source quality: ${sourceQuality.mediumOrBetterCount}/${sourceQuality.sourceCount} medium-or-better; average ${sourceQuality.averageScore}/100`
          : '',
        `Evidence confidence: ${Math.round(
          evidenceValidation.confidence * 100,
        )}%`,
        ...evidenceValidation.safeEvidence
          .slice(0, 8)
          .map((item) => item.url || item.path || item.summary),
        ...artifacts.slice(0, 8).map((artifact) => artifact.path),
      ].filter(Boolean),
      completionStatus: evidenceValidation.completionStatus,
      confidence: evidenceValidation.confidence,
      missingEvidence: evidenceValidation.missingEvidence,
      sourceQuality,
      verifiedAt: Date.now(),
    },
  };
};

const maybeRecordHermesEvent = (
  runId: string,
  event: HermesBridgeEvent,
) => {
  if (event.type === 'tool.call.started') {
    const toolName = (event.toolName || 'tool')
      .replace(/^hermes[._:-]?/i, '')
      .replace(/_/g, '.');
    TaskRunRegistry.addToolCall(runId, {
      externalCallId: event.callId,
      serverName: 'neura',
      toolName,
      arguments: event.arguments,
      status: 'pending',
      resultPreview: event.preview,
    });
  }

  if (event.type === 'tool.call.completed') {
    const toolName = (event.toolName || 'tool')
      .replace(/^hermes[._:-]?/i, '')
      .replace(/_/g, '.');
    const updated = event.callId
      ? TaskRunRegistry.updateToolCall(runId, event.callId, {
          toolName,
          arguments: event.arguments,
          status: event.isError ? 'failed' : 'completed',
          resultPreview: event.resultPreview || event.preview,
        })
      : null;
    if (!updated) {
      TaskRunRegistry.addToolCall(runId, {
        externalCallId: event.callId,
        serverName: 'neura',
        toolName,
        arguments: event.arguments,
        status: event.isError ? 'failed' : 'completed',
        resultPreview: event.resultPreview,
      });
    }
    recordAutomationRecovery(runId, event);
  }

  for (const url of extractUrls(event.arguments, event.resultPreview, event.preview)) {
    TaskRunRegistry.addSource(runId, { url });
  }

  if (event.toolName === 'todo' || /todo/i.test(event.toolName || '')) {
    const todos = [event.arguments, event.resultPreview, event.preview]
      .map((value) => (typeof value === 'string' ? value : compactJson(value, 1500)))
      .filter(Boolean)
      .join('\n');
    if (todos.trim()) {
      TaskRunRegistry.upsertTodo(runId, {
        id: `todo-${event.callId || Date.now()}`,
        text: compact(todos, 500),
        status: event.type === 'tool.call.completed' ? 'done' : 'in_progress',
      });
    }
  }

  if (event.type === 'run.started') {
    TaskRunRegistry.addCheckpoint(runId, {
      label: 'Runtime accepted task',
      status: 'created',
      summary: `Session ${event.model || 'runtime'} started.`,
    });
  }

  if (
    event.toolName === 'browser_navigate' &&
    event.arguments &&
    typeof event.arguments.url === 'string'
  ) {
    TaskRunRegistry.addSource(runId, { url: event.arguments.url });
  }

  if (event.type === 'clarify.requested') {
    TaskRunRegistry.addProgress(runId, {
      title: 'Assumption recorded',
      detail: event.message || compactJson(event),
      status: 'done',
      eventType: 'hermes.clarify',
    });
  }
};

export class TaskManager {
  private static instance: TaskManager | null = null;

  static getInstance() {
    if (!TaskManager.instance) {
      TaskManager.instance = new TaskManager();
    }
    return TaskManager.instance;
  }

  listRuns() {
    return TaskRunRegistry.list();
  }

  getRun(runId: string) {
    return TaskRunRegistry.list().find((run) => run.runId === runId) || null;
  }

  private syncRun(run: TaskRunRecord | null) {
    if (!run) {
      return;
    }
    store.setState({
      taskState: run,
    });
  }

  private upsert(run: TaskRunRecord) {
    const saved = TaskRunRegistry.upsert(run);
    this.syncRun(saved);
    return saved;
  }

  private patch(runId: string, patch: Partial<TaskRunRecord>) {
    const saved = TaskRunRegistry.patch(runId, patch);
    this.syncRun(saved);
    return saved;
  }

  private addProgress(
    runId: string,
    item: Parameters<typeof TaskRunRegistry.addProgress>[1],
  ) {
    const saved = TaskRunRegistry.addProgress(runId, item);
    this.syncRun(saved);
    return saved;
  }

  async runDirect(prompt: string, options: Pick<TaskStartOptions, 'signal'> = {}) {
    const result = await HermesRuntimeService.getInstance().run({
      prompt,
      signal: options.signal,
    });
    return result.finalAnswer;
  }

  async startHermesTask(goal: string, options: TaskStartOptions = {}) {
    const trimmedGoal = goal.trim();
    if (!trimmedGoal) {
      throw new Error('Task goal is required.');
    }

    const route = classifyHermesTask(
      trimmedGoal,
      SettingStore.getStore(),
      options.runMode,
      options.toolsets,
    );
    const runMode = route.runMode;
    const publicGoal = options.publicGoal || trimmedGoal;
    const previousRuns = TaskRunRegistry.list();
    const baseRun = createTaskRun(publicGoal, runMode);
    const run = prepareTaskRunContext(
      {
        ...baseRun,
        phase: 'planning' as const,
        activeAgent: 'planner' as const,
        taskMode: route.taskMode,
        browserBackend: route.browserBackend,
        backgroundTaskId: options.backgroundTaskId,
        retryOfRunId: options.retryOfRunId,
        retryCount: options.retryCount || 0,
        sessionId: options.sessionId || baseRun.sessionId,
      },
      previousRuns,
    );
    this.upsert(run);
    TaskRunRegistry.addCheckpoint(run.runId, {
      label: 'Task session created',
      status: options.backgroundTaskId ? 'resumed' : 'created',
      summary: `${route.taskMode} task using ${route.browserBackend} browser backend.`,
    });
    TaskRunRegistry.setActiveRunId(run.runId);

    ComputerRuntimeController.start({
      mode: 'terminal',
      title: 'Neura Computer',
      subtitle: 'Local runtime',
      display: 'Starting',
      activity: 'Starting',
    });
    store.setState({
      status: StatusEnum.RUNNING,
      thinking: true,
      errorMsg: null,
    });

    try {
      const result = await HermesRuntimeService.getInstance().run({
        prompt: buildHermesTaskPrompt(trimmedGoal, run, route),
        sessionId: run.sessionId,
        cwd: run.workspacePath,
        signal: options.signal,
        toolsets: route.toolsets,
        browserBackend: route.browserBackend,
        keepBrowserAlive: false,
        onProcessStart: (event) => {
          ComputerRuntimeController.update({
            mode: 'terminal',
            status: 'running',
            activeProcessId: event.processId,
            display: event.command,
            cwd: event.cwd,
            activity: 'Terminal active',
          });
        },
        onOutput: (event) => {
          ComputerRuntimeController.output({
            command: event.command,
            cwd: event.cwd,
            stdout: event.stdout,
            stderr: event.stderr,
            raw: event.raw,
            failed: event.failed,
          });
        },
        onEvent: (event) => {
          maybeRecordHermesEvent(run.runId, event);
        },
        onProgress: (event) => {
          this.addProgress(run.runId, {
            title: event.title,
            detail: event.detail,
            status: event.status === 'failed' ? 'failed' : event.status || 'done',
            eventType: 'hermes.progress',
          });
          ComputerRuntimeController.update({
            status: event.status === 'failed' ? 'failed' : 'running',
            activity: event.title,
            display: event.detail || 'Neura Computer',
          });
          this.patch(run.runId, {
            phase:
              event.status === 'failed'
                ? 'failed'
                : event.status === 'done'
                  ? 'acting'
                  : 'planning',
            activeAgent: event.status === 'done' ? 'executor' : 'planner',
            currentStep: event.title,
          });
        },
      });
      const artifacts = await discoverRunArtifacts(run);
      for (const artifact of artifacts) {
        TaskRunRegistry.addArtifact(run.runId, artifact);
      }
      const manifestPath = await writeArtifactManifest(run, artifacts);
      if (manifestPath) {
        TaskRunRegistry.patch(run.runId, { artifactManifestPath: manifestPath });
        TaskRunRegistry.addArtifact(run.runId, {
          id: `artifact-manifest-${Date.now()}`,
          title: ARTIFACT_MANIFEST_NAME,
          kind: 'data',
          mimeType: 'application/json',
          path: manifestPath,
          createdAt: Date.now(),
        });
      }
      if (artifacts.length > 0) {
        this.addProgress(run.runId, {
          title: 'Captured workspace artifacts',
          detail: artifacts.map((artifact) => artifact.path).join('\n'),
          status: 'done',
          eventType: 'hermes.artifacts',
        });
      }
      TaskRunRegistry.addCheckpoint(run.runId, {
        label: 'Artifacts captured',
        status: 'created',
        summary:
          artifacts.length > 0
            ? `${artifacts.length} workspace artifact(s) registered.`
            : 'No workspace files were produced by this task.',
      });

      const validation = validateRunCompletion(run, route, result, artifacts);
      if (!validation.valid) {
        for (const failure of validation.failures) {
          TaskRunRegistry.addValidationFailure(run.runId, failure);
        }
        TaskRunRegistry.addCheckpoint(run.runId, {
          label: 'Final validation failed',
          status: 'failed',
          summary: validation.failures.join('\n'),
        });
        throw new Error(validation.failures.join(' '));
      }
      TaskRunRegistry.addCheckpoint(run.runId, {
        label: 'Final validation passed',
        status: 'validated',
        summary: validation.proof.summary,
      });

      const completed = this.patch(run.runId, {
        status: 'completed',
        phase: 'completed',
        activeAgent: 'critic',
        finalAnswer: result.finalAnswer,
        validationStatus: 'valid',
        completionProof: validation.proof,
        completedAt: Date.now(),
      });
      this.addProgress(run.runId, {
        title: 'Task completed',
        detail: compact(result.finalAnswer),
        status: 'done',
        eventType: 'hermes.completed',
      });
      ComputerRuntimeController.complete('Task completed');
      store.setState({
        status: StatusEnum.END,
        thinking: false,
        messages: [
          ...(store.getState().messages || []),
          {
            from: 'gpt',
            value: result.finalAnswer,
          },
        ],
        taskState: completed || store.getState().taskState,
      });
      return completed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const wasCancelled = options.signal?.aborted;
      logger.warn('[TaskManager] Hermes task failed', error);
      const failed = this.patch(run.runId, {
        status: wasCancelled ? 'cancelled' : 'failed',
        phase: wasCancelled ? 'cancelled' : 'failed',
        error: message,
        finalAnswer: wasCancelled
          ? `The task was cancelled: ${message}`
          : `Neura could not complete the task: ${message}`,
        completedAt: Date.now(),
      });
      this.addProgress(run.runId, {
        title: wasCancelled ? 'Task cancelled' : 'Task failed',
        detail: message,
        status: wasCancelled ? 'done' : 'failed',
        eventType: 'hermes.failed',
      });
      if (wasCancelled) {
        ComputerRuntimeController.complete('Task cancelled');
      } else {
        ComputerRuntimeController.fail(message);
      }
      store.setState({
        status: wasCancelled ? StatusEnum.USER_STOPPED : StatusEnum.ERROR,
        thinking: false,
        errorMsg: wasCancelled ? null : message,
        taskState: failed || store.getState().taskState,
      });
      return failed;
    } finally {
      TaskRunRegistry.setActiveRunId(null);
    }
  }

  async startMcpAutonomousTask(goal: string, options: TaskStartOptions = {}) {
    return this.startHermesTask(goal, {
      ...options,
      runMode: 'mcp_autonomous',
    });
  }

  async retryRun(runId: string, signal?: AbortSignal) {
    const run = this.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    TaskRunRegistry.addCheckpoint(runId, {
      label: 'Retry requested',
      status: 'retrying',
      summary: 'Starting a new attempt with the same task session.',
    });
    return this.startHermesTask(run.originalGoal, {
      signal,
      publicGoal: run.originalGoal,
      runMode: run.runMode,
      sessionId: run.sessionId,
      retryOfRunId: run.runId,
      retryCount: (run.retryCount || 0) + 1,
    });
  }

  async startMultiAgentTask(goal: string, options: TaskStartOptions = {}) {
    return this.startHermesTask(goal, {
      ...options,
      runMode: 'multi_agent',
    });
  }

  async startSkillTask(input: {
    skillName: string;
    arguments?: Record<string, unknown>;
    goal?: string;
    signal?: AbortSignal;
    backgroundTaskId?: string;
  }) {
    const goal = [
      input.goal || `Use ${input.skillName} skill.`,
      '',
      `Skill: ${input.skillName}`,
      '',
      `Arguments:\n${JSON.stringify(input.arguments || {}, null, 2)}`,
    ].join('\n');

    return this.startHermesTask(goal, {
      runMode: 'skill',
      publicGoal: input.goal || `Use ${input.skillName} skill`,
      signal: input.signal,
      backgroundTaskId: input.backgroundTaskId,
    });
  }

  createRunId() {
    return `run_${Date.now()}_${randomUUID().slice(0, 8)}`;
  }
}
