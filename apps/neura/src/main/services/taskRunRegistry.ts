/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'crypto';

import {
  AgentRunMode,
  ApprovalEvent,
  CompletionProof,
  TaskArtifact,
  TaskProgressItem,
  TaskRunRecord,
  TaskSourceRecord,
  TaskToolCallRecord,
  TaskRunStatus,
  TaskTodoItem,
  TaskCheckpoint,
} from '@main/store/types';
import { SettingStore } from '@main/store/setting';
import { persistTaskRunContext } from './taskContextMemory';
import { scoreSourceQuality } from './sourceQuality';
import {
  TaskEvidence,
  TaskEvidenceRequirements,
  sanitizeTaskEvidence,
  validateTaskEvidence,
} from '@shared/taskEvidence';

const MAX_STORED_RUNS = 100;

const pathEquals = (left?: string, right?: string) =>
  (left || '').trim().toLowerCase() === (right || '').trim().toLowerCase();

const normalizeSourceUrl = (value: string) => {
  try {
    const url = new URL(value.trim());
    url.hash = '';
    if (url.pathname !== '/') {
      url.pathname = url.pathname.replace(/\/+$/u, '');
    }
    return url.toString();
  } catch {
    return value.trim();
  }
};

const VISIBLE_DATE_PATTERN =
  /\b(?:published|updated|posted|date)?\s*:?\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})\b/i;

const extractVisibleDate = (...values: Array<string | undefined>) => {
  for (const value of values) {
    const match = value?.match(VISIBLE_DATE_PATTERN)?.[1];
    if (match) {
      return match.trim();
    }
  }
  return undefined;
};

const parseVisibleDate = (value?: string) => {
  if (!value) {
    return undefined;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
};

const toolNameIncludes = (toolCall: TaskToolCallRecord, pattern: RegExp) =>
  pattern.test(`${toolCall.serverName}.${toolCall.toolName}`);

const toolCallEvidenceKind = (
  toolCall: TaskToolCallRecord,
): TaskEvidence['kind'] => {
  if (
    toolNameIncludes(
      toolCall,
      /command|terminal|shell|powershell|cmd|run\.?command|test|typecheck|build/i,
    )
  ) {
    return 'command_test';
  }
  if (
    toolNameIncludes(
      toolCall,
      /browser|web|search|navigate|screenshot|extract|page|url/i,
    )
  ) {
    return 'browser_snapshot';
  }
  return 'connector_action';
};

const summarizeToolCall = (toolCall: TaskToolCallRecord) =>
  `${toolCall.serverName}.${toolCall.toolName} ${toolCall.status}`;

export const collectTaskEvidenceForRun = (
  run: TaskRunRecord,
): TaskEvidence[] => {
  const sourceEvidence: TaskEvidence[] = (run.sourceRecords || []).map(
    (source) =>
      sanitizeTaskEvidence({
        id: source.id,
        kind: 'citation_source',
        summary: source.title || source.sourceName || source.url,
        status: 'completed',
        confidence: source.quality ? source.quality.score / 100 : undefined,
        capturedAt: source.capturedAt,
        url: source.url,
        title: source.title,
        sourceName: source.sourceName,
        metadata: {
          visibleDate: source.visibleDate,
          publishedAt: source.publishedAt,
          claimIds: source.claimIds,
          workerId: source.workerId,
          validationNotes: source.validationNotes,
          qualityReasons: source.quality?.reasons,
        },
        excerpt: source.excerpt,
        sourceQualityScore: source.quality?.score,
        sourceQualityTier: source.quality?.tier,
      }),
  );

  const artifactEvidence: TaskEvidence[] = (run.artifacts || []).map(
    (artifact) =>
      sanitizeTaskEvidence({
        id: artifact.id,
        kind: 'file_artifact',
        summary: artifact.title,
        status: 'completed',
        confidence: 0.86,
        capturedAt: artifact.createdAt,
        path: artifact.path,
        artifactKind: artifact.kind,
        metadata: {
          mimeType: artifact.mimeType,
          previewPath: artifact.previewPath,
          sourceRunId: artifact.sourceRunId,
        },
      }),
  );

  const toolEvidence: TaskEvidence[] = (run.toolCalls || [])
    .filter((toolCall) => toolCall.status !== 'pending')
    .map((toolCall) =>
      sanitizeTaskEvidence({
        id: toolCall.id,
        kind: toolCallEvidenceKind(toolCall),
        summary: summarizeToolCall(toolCall),
        status: toolCall.status,
        confidence: toolCall.status === 'completed' ? 0.78 : 0,
        capturedAt: toolCall.completedAt || toolCall.startedAt,
        command:
          typeof toolCall.arguments?.command === 'string'
            ? toolCall.arguments.command
            : undefined,
        connectorName: toolCall.serverName,
        toolName: toolCall.toolName,
        metadata: {
          arguments: toolCall.arguments,
          resultPreview: toolCall.resultPreview,
          externalCallId: toolCall.externalCallId,
        },
      }),
    );

  const browserSnapshotEvidence: TaskEvidence[] = run.browserRestoreSnapshot
    ? [
        sanitizeTaskEvidence({
          id: `${run.runId}-browser-restore`,
          kind: 'browser_snapshot',
          summary:
            run.browserRestoreSnapshot.title ||
            run.browserRestoreSnapshot.url ||
            'Browser restore snapshot',
          status:
            run.browserRestoreSnapshot.bridgeStatus === 'failed'
              ? 'failed'
              : 'completed',
          confidence:
            run.browserRestoreSnapshot.bridgeStatus === 'connected'
              ? 0.82
              : 0.45,
          capturedAt: run.browserRestoreSnapshot.capturedAt,
          url: run.browserRestoreSnapshot.url,
          title: run.browserRestoreSnapshot.title,
          metadata: {
            browserRestoreSnapshot: run.browserRestoreSnapshot,
          },
        }),
      ]
    : [];

  const explicitEvidence = (run.evidence || []).map(sanitizeTaskEvidence);
  const evidenceById = new Map<string, TaskEvidence>();
  for (const item of [
    ...sourceEvidence,
    ...artifactEvidence,
    ...toolEvidence,
    ...browserSnapshotEvidence,
    ...explicitEvidence,
  ]) {
    evidenceById.set(item.id, item);
  }
  return [...evidenceById.values()];
};

export const buildTaskRunEvidenceRequirements = (
  run: TaskRunRecord,
): TaskEvidenceRequirements => {
  const isResearch =
    run.runMode === 'wide_research' ||
    run.taskMode === 'research' ||
    run.taskMode === 'scrape';
  const isArtifactWorkflow = [
    'website_builder',
    'artifact_workflow',
    'multimodal_workflow',
  ].includes(run.runMode);
  return {
    requireEvidence: run.status === 'completed',
    requireCitationSource: isResearch,
    minimumCitationSources: isResearch ? 1 : undefined,
    minimumMediumConfidenceSources: run.taskMode === 'research' ? 1 : undefined,
    validateResearchClaims: isResearch,
    requireFileArtifact: isArtifactWorkflow,
  };
};

const validateRunEvidence = (run: TaskRunRecord) => {
  if (run.status === 'pending' || run.status === 'running') {
    return validateTaskEvidence({
      claim: run.currentStep || run.originalGoal,
      evidence: collectTaskEvidenceForRun(run),
      requirements: buildTaskRunEvidenceRequirements({
        ...run,
        status: 'completed',
      }),
      knownFailures: [],
    });
  }
  return validateTaskEvidence({
    claim: run.finalAnswer || run.error || run.currentStep || run.originalGoal,
    evidence: collectTaskEvidenceForRun(run),
    requirements: buildTaskRunEvidenceRequirements(run),
    knownFailures: run.validationFailures,
  });
};

export const createRunId = () =>
  `run_${Date.now()}_${randomUUID().slice(0, 8)}`;

export const createSessionId = (runId: string) =>
  `neura_${runId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

export const createTaskRun = (
  originalGoal: string,
  runMode: AgentRunMode,
): TaskRunRecord => {
  const runId = createRunId();
  return {
    runId,
    sessionId: createSessionId(runId),
    originalGoal,
    runMode,
    status: 'running',
    checkpoints: [],
    retryCount: 0,
    todoItems: [],
    progressItems: [],
    factsFound: [],
    sourcesVisited: [],
    sourceRecords: [],
    wideResearchWorkers: [],
    toolCalls: [],
    artifacts: [],
    approvalEvents: [],
    validationFailures: [],
    validationStatus: runMode === 'executor_browser' ? 'pending' : undefined,
    startedAt: Date.now(),
  };
};

const normalizeRun = (run: TaskRunRecord): TaskRunRecord => {
  const normalized = {
    ...run,
    sessionId: run.sessionId || createSessionId(run.runId),
    retryCount: run.retryCount || 0,
    checkpoints: run.checkpoints || [],
    todoItems: run.todoItems || [],
    progressItems: run.progressItems || [],
    factsFound: run.factsFound || [],
    sourcesVisited: run.sourcesVisited || [],
    sourceRecords: run.sourceRecords || [],
    wideResearchWorkers: run.wideResearchWorkers || [],
    toolCalls: run.toolCalls || [],
    artifacts: run.artifacts || [],
    approvalEvents: run.approvalEvents || [],
    validationFailures: run.validationFailures || [],
    retrievedRunIds: run.retrievedRunIds || [],
  };
  const evidence = collectTaskEvidenceForRun(normalized);
  return {
    ...normalized,
    evidence,
    evidenceValidation: validateRunEvidence({ ...normalized, evidence }),
  };
};

export class TaskRunRegistry {
  private static activeRunId: string | null = null;

  static setActiveRunId(runId: string | null) {
    TaskRunRegistry.activeRunId = runId;
  }

  static getActiveRunId() {
    return TaskRunRegistry.activeRunId;
  }

  static list(): TaskRunRecord[] {
    return ((SettingStore.get('taskRuns') || []) as TaskRunRecord[]).map(
      normalizeRun,
    );
  }

  static cancelStaleRunningRuns(reason: string) {
    const runs = TaskRunRegistry.list();
    const completedAt = Date.now();
    let changed = false;
    let cancelledCount = 0;
    const nextRuns = runs.map((run) => {
      if (run.status !== 'running') {
        return run;
      }
      changed = true;
      cancelledCount += 1;
      return normalizeRun({
        ...run,
        status: 'cancelled',
        error: reason,
        currentStep: 'Interrupted',
        completedAt,
      });
    });

    if (!changed) {
      return 0;
    }

    SettingStore.set('taskRuns', nextRuns.slice(0, MAX_STORED_RUNS));
    TaskRunRegistry.setActiveRunId(null);
    return cancelledCount;
  }

  static upsert(run: TaskRunRecord) {
    const runs = TaskRunRegistry.list();
    const index = runs.findIndex((item) => item.runId === run.runId);
    const nextRun = normalizeRun(run);
    const nextRuns =
      index >= 0
        ? runs.map((item) => (item.runId === run.runId ? nextRun : item))
        : [nextRun, ...runs];
    SettingStore.set('taskRuns', nextRuns.slice(0, MAX_STORED_RUNS));
    persistTaskRunContext(nextRun);
    if (nextRun.status === 'running') {
      TaskRunRegistry.setActiveRunId(nextRun.runId);
    }
    return nextRun;
  }

  static patch(runId: string, patch: Partial<TaskRunRecord>) {
    const run = TaskRunRegistry.list().find((item) => item.runId === runId);
    if (!run) {
      return null;
    }
    return TaskRunRegistry.upsert({ ...run, ...patch });
  }

  static setStatus(runId: string, status: TaskRunStatus, error?: string) {
    return TaskRunRegistry.patch(runId, {
      status,
      phase:
        status === 'completed' || status === 'failed' || status === 'cancelled'
          ? status
          : undefined,
      error,
      completedAt:
        status === 'completed' || status === 'failed' || status === 'cancelled'
          ? Date.now()
          : undefined,
    });
  }

  static addProgress(
    runId: string,
    item: Omit<TaskProgressItem, 'id' | 'createdAt'>,
  ) {
    const run = TaskRunRegistry.list().find((record) => record.runId === runId);
    if (!run) {
      return null;
    }
    const progress: TaskProgressItem = {
      ...item,
      id: `${Date.now()}-${run.progressItems.length}`,
      createdAt: Date.now(),
      completedAt:
        item.status === 'done' || item.status === 'failed'
          ? Date.now()
          : undefined,
    };
    return TaskRunRegistry.upsert({
      ...run,
      progressItems: [...run.progressItems, progress],
      currentStep: item.title,
      nextAction:
        item.status === 'failed'
          ? 'Review the failure guidance, fix the setup or evidence gap, then resume or retry.'
          : run.nextAction,
    });
  }

  static addSource(runId: string, source: Omit<TaskSourceRecord, 'id' | 'capturedAt'>) {
    const run = TaskRunRegistry.list().find((record) => record.runId === runId);
    if (!run || !source.url.trim()) {
      return null;
    }
    const url = normalizeSourceUrl(source.url);
    const visibleDate =
      source.visibleDate ||
      extractVisibleDate(source.title, source.sourceName, source.excerpt, url);
    const existingIndex = run.sourceRecords.findIndex(
      (item) => normalizeSourceUrl(item.url) === url,
    );
    const existingSource =
      existingIndex >= 0 ? run.sourceRecords[existingIndex] : undefined;
    const mergedClaimIds = [
      ...new Set([...(existingSource?.claimIds || []), ...(source.claimIds || [])]),
    ];
    const mergedValidationNotes = [
      ...new Set([
        ...(existingSource?.validationNotes || []),
        ...(source.validationNotes || []),
      ]),
    ];
    const sourceRecord: TaskSourceRecord = {
      ...existingSource,
      ...source,
      url,
      visibleDate: visibleDate || existingSource?.visibleDate,
      publishedAt:
        source.publishedAt ||
        parseVisibleDate(visibleDate) ||
        existingSource?.publishedAt,
      claimIds: mergedClaimIds,
      quality:
        source.quality ||
        existingSource?.quality ||
        scoreSourceQuality({ ...source, url }),
      validationNotes: mergedValidationNotes,
      id: existingSource?.id || `source-${Date.now()}-${run.sourceRecords.length}`,
      capturedAt: Date.now(),
    };
    const sourceRecords =
      existingIndex >= 0
        ? run.sourceRecords.map((item, index) =>
            index === existingIndex ? { ...item, ...sourceRecord } : item,
          )
        : [...run.sourceRecords, sourceRecord];
    const fallbackWorkerId = !source.workerId
      ? (run.wideResearchWorkers || [])
          .filter((worker) => worker.status === 'running')
          .sort((left, right) => left.sourceUrls.length - right.sourceUrls.length)
          [0]?.id
      : undefined;

    return TaskRunRegistry.upsert({
      ...run,
      sourcesVisited: [...new Set([...run.sourcesVisited, url])].slice(-50),
      sourceRecords: sourceRecords.slice(-50),
      wideResearchWorkers: run.wideResearchWorkers?.length
        ? run.wideResearchWorkers.map((worker) => {
            const shouldAttach =
              source.workerId === worker.id ||
              (!source.workerId && fallbackWorkerId === worker.id);
            if (!shouldAttach) {
              return worker;
            }
            return {
              ...worker,
              sourceUrls: [...new Set([...worker.sourceUrls, url])],
              claimIds: [
                ...new Set([...worker.claimIds, ...(source.claimIds || [])]),
              ],
              updatedAt: Date.now(),
            };
          })
        : run.wideResearchWorkers,
    });
  }

  static setWideResearchWorkers(
    runId: string,
    workers: TaskRunRecord['wideResearchWorkers'],
  ) {
    return TaskRunRegistry.patch(runId, {
      wideResearchWorkers: workers || [],
    });
  }

  static updateWideResearchWorker(
    runId: string,
    workerId: string,
    patch: Partial<NonNullable<TaskRunRecord['wideResearchWorkers']>[number]>,
  ) {
    const run = TaskRunRegistry.list().find((record) => record.runId === runId);
    if (!run) {
      return null;
    }
    return TaskRunRegistry.upsert({
      ...run,
      wideResearchWorkers: (run.wideResearchWorkers || []).map((worker) =>
        worker.id === workerId
          ? {
              ...worker,
              ...patch,
              attempts: patch.attempts ?? worker.attempts,
              updatedAt: Date.now(),
            }
          : worker,
      ),
    });
  }

  static retryFailedWideResearchWorkers(runId: string) {
    const run = TaskRunRegistry.list().find((record) => record.runId === runId);
    if (!run) {
      return null;
    }
    const now = Date.now();
    return TaskRunRegistry.upsert({
      ...run,
      wideResearchWorkers: (run.wideResearchWorkers || []).map((worker) =>
        worker.status === 'failed'
          ? {
              ...worker,
              status: 'pending',
              attempts: worker.attempts + 1,
              error: undefined,
              completedAt: undefined,
              updatedAt: now,
            }
          : worker,
      ),
    });
  }

  static addToolCall(
    runId: string,
    toolCall: Omit<TaskToolCallRecord, 'id' | 'startedAt'>,
  ) {
    const run = TaskRunRegistry.list().find((record) => record.runId === runId);
    if (!run) {
      return null;
    }
    const startedAt = Date.now();
    const record: TaskToolCallRecord = {
      ...toolCall,
      id: `tool-${startedAt}-${run.toolCalls.length}`,
      startedAt,
      completedAt:
        toolCall.status === 'completed' || toolCall.status === 'failed'
          ? startedAt
          : undefined,
    };
    return TaskRunRegistry.upsert({
      ...run,
      toolCalls: [...run.toolCalls, record].slice(-100),
      phase: 'acting',
    });
  }

  static updateToolCall(
    runId: string,
    callId: string,
    patch: Partial<Omit<TaskToolCallRecord, 'id' | 'startedAt'>>,
  ) {
    const run = TaskRunRegistry.list().find((record) => record.runId === runId);
    if (!run) {
      return null;
    }
    const completedAt =
      patch.status === 'completed' || patch.status === 'failed'
        ? Date.now()
        : patch.completedAt;
    return TaskRunRegistry.upsert({
      ...run,
      toolCalls: run.toolCalls.map((toolCall) =>
        toolCall.id === callId || toolCall.externalCallId === callId
          ? {
              ...toolCall,
              ...patch,
              completedAt,
            }
          : toolCall,
      ),
      phase: 'acting',
    });
  }

  static addValidationFailure(runId: string, reason: string) {
    const run = TaskRunRegistry.list().find((record) => record.runId === runId);
    if (!run || !reason.trim()) {
      return null;
    }
    return TaskRunRegistry.upsert({
      ...run,
      validationFailures: [...run.validationFailures, reason.trim()].slice(-20),
      validationStatus: 'invalid',
      phase: 'validating',
    });
  }

  static addEvidence(runId: string, evidence: TaskEvidence) {
    const run = TaskRunRegistry.list().find((record) => record.runId === runId);
    if (!run) {
      return null;
    }
    const safeEvidence = sanitizeTaskEvidence(evidence);
    const existingIndex = (run.evidence || []).findIndex(
      (item) => item.id === safeEvidence.id,
    );
    return TaskRunRegistry.upsert({
      ...run,
      evidence:
        existingIndex >= 0
          ? (run.evidence || []).map((item, index) =>
              index === existingIndex ? safeEvidence : item,
            )
          : [...(run.evidence || []), safeEvidence].slice(-120),
    });
  }

  static addTodo(runId: string, item: TaskTodoItem) {
    const run = TaskRunRegistry.list().find((record) => record.runId === runId);
    if (!run) {
      return null;
    }
    return TaskRunRegistry.upsert({
      ...run,
      todoItems: [...run.todoItems, item],
    });
  }

  static upsertTodo(runId: string, item: TaskTodoItem) {
    const run = TaskRunRegistry.list().find((record) => record.runId === runId);
    if (!run) {
      return null;
    }
    const existingIndex = run.todoItems.findIndex((todo) => todo.id === item.id);
    const todoItems =
      existingIndex >= 0
        ? run.todoItems.map((todo, index) =>
            index === existingIndex ? { ...todo, ...item } : todo,
          )
        : [...run.todoItems, item];
    return TaskRunRegistry.upsert({
      ...run,
      todoItems,
    });
  }

  static addCheckpoint(
    runId: string,
    checkpoint: Omit<TaskCheckpoint, 'id' | 'createdAt'>,
  ) {
    const run = TaskRunRegistry.list().find((record) => record.runId === runId);
    if (!run) {
      return null;
    }
    const record: TaskCheckpoint = {
      ...checkpoint,
      id: `checkpoint-${Date.now()}-${run.checkpoints?.length || 0}`,
      createdAt: Date.now(),
    };
    return TaskRunRegistry.upsert({
      ...run,
      checkpoints: [...(run.checkpoints || []), record].slice(-50),
    });
  }

  static setBrowserRestoreSnapshot(
    runId: string,
    browserRestoreSnapshot: TaskRunRecord['browserRestoreSnapshot'],
  ) {
    const run = TaskRunRegistry.list().find((record) => record.runId === runId);
    if (!run || !browserRestoreSnapshot) {
      return null;
    }
    return TaskRunRegistry.upsert({
      ...run,
      browserRestoreSnapshot,
    });
  }

  static addArtifact(
    runId: string,
    artifact: Omit<TaskArtifact, 'sourceRunId'>,
  ) {
    const run = TaskRunRegistry.list().find((record) => record.runId === runId);
    if (!run) {
      return null;
    }
    const existingIndex = run.artifacts.findIndex(
      (item) => pathEquals(item.path, artifact.path),
    );
    const nextArtifact = { ...artifact, sourceRunId: runId };
    return TaskRunRegistry.upsert({
      ...run,
      artifacts:
        existingIndex >= 0
          ? run.artifacts.map((item, index) =>
              index === existingIndex ? { ...item, ...nextArtifact } : item,
            )
          : [...run.artifacts, nextArtifact],
    });
  }

  static addApproval(
    runId: string,
    event: Omit<ApprovalEvent, 'id' | 'createdAt'>,
  ) {
    const run = TaskRunRegistry.list().find((record) => record.runId === runId);
    if (!run) {
      return null;
    }
    const approvalEvent: ApprovalEvent = {
      ...event,
      id: `${Date.now()}-${run.approvalEvents.length}`,
      createdAt: Date.now(),
    };
    TaskRunRegistry.upsert({
      ...run,
      approvalEvents: [...run.approvalEvents, approvalEvent],
    });
    return approvalEvent;
  }

  static setCompletionProof(runId: string, completionProof: CompletionProof) {
    return TaskRunRegistry.patch(runId, {
      completionProof,
      validationStatus: 'valid',
    });
  }

  static updateApproval(
    runId: string,
    eventId: string,
    status: ApprovalEvent['status'],
  ) {
    const run = TaskRunRegistry.list().find((record) => record.runId === runId);
    if (!run) {
      return null;
    }
    return TaskRunRegistry.upsert({
      ...run,
      approvalEvents: run.approvalEvents.map((event) =>
        event.id === eventId ? { ...event, status } : event,
      ),
    });
  }

  static hasApprovedApproval(runId: string, action: string, target?: string) {
    const run = TaskRunRegistry.list().find((record) => record.runId === runId);
    if (!run) {
      return false;
    }
    return run.approvalEvents.some(
      (event) =>
        event.action === action &&
        event.target === target &&
        event.status === 'approved',
    );
  }
}
