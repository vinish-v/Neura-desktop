/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';

import { SearchEngineForSettings, VLMProviderV2, Operator } from './types';

const PresetSourceSchema = z.object({
  type: z.enum(['local', 'remote']),
  url: z.string().url().optional(),
  autoUpdate: z.boolean().optional(),
  lastUpdated: z.number().optional(),
});

const WebMonitorSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  intervalMinutes: z.number().min(1),
  watch: z.enum(['page', 'selector', 'text']),
  query: z.string().optional(),
  notifyOn: z.enum(['change']).optional(),
  active: z.boolean(),
  createdAt: z.number(),
  lastDigest: z.string().optional(),
  lastCheckedAt: z.number().optional(),
  lastChangedAt: z.number().optional(),
  lastStatus: z.string().optional(),
});

const TaskArtifactSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum([
    'document',
    'spreadsheet',
    'presentation',
    'image',
    'audio',
    'video',
    'website',
    'archive',
    'data',
    'report',
    'other',
  ]),
  mimeType: z.string().optional(),
  path: z.string(),
  previewPath: z.string().optional(),
  sourceRunId: z.string(),
  createdAt: z.number(),
});

const TaskProgressItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string().optional(),
  status: z.enum(['pending', 'in_progress', 'done', 'failed']),
  createdAt: z.number(),
  completedAt: z.number().optional(),
  agentName: z.enum(['planner', 'researcher', 'executor', 'critic']).optional(),
  eventType: z.string().optional(),
});

const TaskSourceRecordSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string().optional(),
  sourceName: z.string().optional(),
  visibleDate: z.string().optional(),
  publishedAt: z.number().optional(),
  excerpt: z.string().optional(),
  claimIds: z.array(z.string()).optional(),
  workerId: z.string().optional(),
  quality: z
    .object({
      score: z.number(),
      tier: z.enum(['high', 'medium', 'low']),
      reasons: z.array(z.string()),
      domain: z.string().optional(),
    })
    .optional(),
  validationNotes: z.array(z.string()).optional(),
  capturedAt: z.number(),
});

const WideResearchWorkerSchema = z.object({
  id: z.string(),
  subtask: z.string(),
  status: z.enum(['pending', 'running', 'completed', 'failed']),
  sessionId: z.string(),
  attempts: z.number(),
  sourceUrls: z.array(z.string()),
  claimIds: z.array(z.string()),
  error: z.string().optional(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  updatedAt: z.number(),
});

const BrowserProfileHealthSchema = z.object({
  profilePath: z.string().optional(),
  exists: z.boolean(),
  writable: z.boolean(),
  lockState: z.enum(['unlocked', 'locked', 'unknown']),
  issues: z.array(z.string()),
});

const BrowserBridgeHealthSchema = z.object({
  executablePath: z.string().optional(),
  executableExists: z.boolean(),
  port: z.number().optional(),
  portReachable: z.boolean(),
  bridgeStatus: z.enum([
    'not_started',
    'starting',
    'connected',
    'disconnected',
    'restarting',
    'failed',
  ]),
  profile: BrowserProfileHealthSchema,
  checkedAt: z.number(),
  issues: z.array(z.string()),
});

const BrowserRestoreSnapshotSchema = z.object({
  url: z.string().optional(),
  title: z.string().optional(),
  profilePath: z.string().optional(),
  backend: z
    .enum(['local', 'browser-use', 'browserbase', 'camofox', 'firecrawl'])
    .optional(),
  cdpUrl: z.string().optional(),
  takeoverActive: z.boolean(),
  bridgeStatus: z.enum([
    'not_started',
    'starting',
    'connected',
    'disconnected',
    'restarting',
    'failed',
  ]),
  health: BrowserBridgeHealthSchema,
  capturedAt: z.number(),
});

const TaskToolCallRecordSchema = z.object({
  id: z.string(),
  externalCallId: z.string().optional(),
  serverName: z.string(),
  toolName: z.string(),
  arguments: z.record(z.unknown()).optional(),
  status: z.enum(['pending', 'completed', 'failed']),
  resultPreview: z.string().optional(),
  startedAt: z.number(),
  completedAt: z.number().optional(),
});

const BackgroundTaskSchema = z.object({
  id: z.string(),
  kind: z.enum(['mcp_autonomous', 'skill', 'multi_agent']),
  goal: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']),
  runId: z.string().optional(),
  skillName: z.string().optional(),
  arguments: z.record(z.unknown()).optional(),
  error: z.string().optional(),
  cancelRequested: z.boolean().optional(),
  createdAt: z.number(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
});

const ScheduledTaskHistorySchema = z.object({
  id: z.string(),
  runId: z.string().optional(),
  status: z.enum(['queued', 'completed', 'failed']),
  message: z.string().optional(),
  queuedAt: z.number(),
});

const ScheduledTaskSchema = z.object({
  id: z.string(),
  name: z.string(),
  goal: z.string(),
  kind: z.enum(['mcp_autonomous', 'skill', 'multi_agent']),
  intervalMinutes: z.number().min(1),
  status: z.enum(['active', 'paused']),
  nextRunAt: z.number(),
  lastRunAt: z.number().optional(),
  history: z.array(ScheduledTaskHistorySchema),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const LocalTaskApiSchema = z.object({
  enabled: z.boolean(),
  port: z.number().int().min(1024).max(65535),
  tokenHash: z.string().optional(),
  tokenCreatedAt: z.number().optional(),
});

const MailTaskIntakeSchema = z.object({
  enabled: z.boolean(),
  connectorId: z.literal('gmail'),
  subjectPrefix: z.string().min(1),
  maxResults: z.number().int().min(1).max(25),
  processedMessageIds: z.array(z.string()),
  updatedAt: z.number().optional(),
});

const DesktopProjectKnowledgeFileSchema = z.object({
  id: z.string(),
  path: z.string(),
  name: z.string(),
  sizeBytes: z.number(),
  updatedAt: z.number(),
  addedAt: z.number(),
});

const DesktopProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  masterInstruction: z.string(),
  pinned: z.boolean(),
  knowledgeFiles: z.array(DesktopProjectKnowledgeFileSchema),
  runIds: z.array(z.string()),
  memory: z.array(z.string()),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const ApprovalEventSchema = z.object({
  id: z.string(),
  action: z.string(),
  target: z.string().optional(),
  risk: z.enum(['low', 'medium', 'high']),
  status: z.enum(['requested', 'approved', 'denied', 'auto_approved']),
  createdAt: z.number(),
});

const CompletionProofSchema = z.object({
  kind: z.enum([
    'source',
    'artifact',
    'browser_terminal_page',
    'local_action',
    'connector_action',
  ]),
  summary: z.string(),
  evidence: z.array(z.string()),
  verifiedAt: z.number(),
});

const RoadmapEvidenceSchema = z.object({
  id: z.string(),
  kind: z.enum(['test', 'typecheck', 'build', 'manual', 'commit', 'tag']),
  summary: z.string(),
  command: z.string().optional(),
  artifactPath: z.string().optional(),
  url: z.string().optional(),
  recordedAt: z.number(),
});

const RoadmapTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  doneWhen: z.string(),
  status: z.enum(['not_started', 'in_progress', 'blocked', 'done']),
  evidence: z.array(RoadmapEvidenceSchema),
  updatedAt: z.number().optional(),
  blockedReason: z.string().optional(),
});

const RoadmapPhaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  tasks: z.array(RoadmapTaskSchema),
});

const RoadmapProgressSchema = z.object({
  id: z.string(),
  title: z.string(),
  version: z.number(),
  phases: z.array(RoadmapPhaseSchema),
  updatedAt: z.number(),
});

const TaskRunSchema = z.object({
  runId: z.string(),
  sessionId: z.string().optional(),
  originalGoal: z.string(),
  runMode: z.enum([
    'direct',
    'gui_computer',
    'gui_browser',
    'executor_browser',
    'wide_research',
    'website_builder',
    'artifact_workflow',
    'multimodal_workflow',
    'mcp_autonomous',
    'skill',
    'multi_agent',
  ]),
  taskMode: z
    .enum([
      'research',
      'scrape',
      'code',
      'spreadsheet',
      'browser_login',
      'scheduled_job',
      'general',
    ])
    .optional(),
  browserBackend: z
    .enum(['local', 'browser-use', 'browserbase', 'camofox', 'firecrawl'])
    .optional(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']),
  phase: z
    .enum([
      'planning',
      'acting',
      'observing',
      'validating',
      'waiting_for_approval',
      'completed',
      'failed',
      'cancelled',
    ])
    .optional(),
  activeAgent: z
    .enum(['planner', 'researcher', 'executor', 'critic'])
    .optional(),
  backgroundTaskId: z.string().optional(),
  projectId: z.string().optional(),
  retryOfRunId: z.string().optional(),
  retryCount: z.number().optional(),
  workspacePath: z.string().optional(),
  memoryFilePath: z.string().optional(),
  memorySummary: z.string().optional(),
  retrievedRunIds: z.array(z.string()).optional(),
  browserRestoreSnapshot: BrowserRestoreSnapshotSchema.optional(),
  wideResearchWorkers: z.array(WideResearchWorkerSchema).optional(),
  checkpoints: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        status: z.enum(['created', 'resumed', 'retrying', 'validated', 'failed']),
        summary: z.string().optional(),
        createdAt: z.number(),
      }),
    )
    .optional(),
  todoItems: z
    .array(
      z.object({
        id: z.string(),
        text: z.string(),
        status: z.enum(['pending', 'in_progress', 'done', 'failed']),
      }),
    )
    .optional(),
  progressItems: z.array(TaskProgressItemSchema).optional(),
  currentStep: z.string().optional(),
  nextAction: z.string().optional(),
  factsFound: z.array(z.string()).optional(),
  sourcesVisited: z.array(z.string()).optional(),
  sourceRecords: z.array(TaskSourceRecordSchema).optional(),
  toolCalls: z.array(TaskToolCallRecordSchema).optional(),
  artifacts: z.array(TaskArtifactSchema).optional(),
  artifactManifestPath: z.string().optional(),
  approvalEvents: z.array(ApprovalEventSchema).optional(),
  evidence: z.array(z.unknown()).optional(),
  evidenceValidation: z.unknown().optional(),
  completionProof: CompletionProofSchema.optional(),
  roadmapProgress: RoadmapProgressSchema.optional(),
  finalAnswer: z.string().optional(),
  error: z.string().optional(),
  validationFailures: z.array(z.string()).optional(),
  validationStatus: z
    .enum(['pending', 'valid', 'invalid', 'failed'])
    .optional(),
  startedAt: z.number(),
  completedAt: z.number().optional(),
});

const ConnectorSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  type: z.enum(['builtin', 'mcp', 'webhook', 'export', 'oauth', 'api', 'rest']),
  enabled: z.boolean(),
  authState: z.enum(['not_configured', 'configured', 'error']),
  permissionLevel: z.enum(['read', 'write', 'admin']),
  tools: z.array(z.string()),
  config: z.record(z.string()).optional(),
  updatedAt: z.number().optional(),
});

const ConnectorAuditEventSchema = z.object({
  id: z.string(),
  connectorId: z.string(),
  toolName: z.string(),
  permission: z.enum(['read', 'write', 'admin']),
  status: z.enum(['completed', 'failed']),
  approvalStatus: z
    .enum(['not_required', 'approved', 'denied', 'missing_run'])
    .optional(),
  error: z.string().optional(),
  createdAt: z.number(),
});

const MultimodalProvidersSchema = z.object({
  image: z
    .object({
      baseUrl: z.string().url().optional(),
      apiKey: z.string().optional(),
      model: z.string().optional(),
    })
    .optional(),
  speechToText: z
    .object({
      baseUrl: z.string().url().optional(),
      apiKey: z.string().optional(),
      model: z.string().optional(),
    })
    .optional(),
  textToSpeech: z
    .object({
      baseUrl: z.string().url().optional(),
      apiKey: z.string().optional(),
      model: z.string().optional(),
      voice: z.string().optional(),
    })
    .optional(),
  video: z
    .object({
      baseUrl: z.string().url().optional(),
      apiKey: z.string().optional(),
      model: z.string().optional(),
    })
    .optional(),
});

export const PresetSchema = z.object({
  // Local VLM Settings
  vlmProvider: z.nativeEnum(VLMProviderV2).optional(),
  vlmBaseUrl: z.string().url(),
  vlmApiKey: z.string().min(1),
  vlmModelName: z.string().min(1),
  useResponsesApi: z.boolean().optional(),
  usePlannerModel: z.boolean().optional(),
  plannerBaseUrl: z.string().url().optional(),
  plannerApiKey: z.string().optional(),
  plannerModelName: z.string().optional(),
  modelTimeoutInMs: z.number().min(30_000).max(600_000).optional(),
  plannerTimeoutInMs: z.number().min(15_000).max(300_000).optional(),

  // Chat Settings
  operator: z.nativeEnum(Operator),
  language: z.enum(['zh', 'en']).optional(),
  screenshotScale: z.number().min(0.1).max(1).optional(),
  maxLoopCount: z.number().min(25).max(200).optional(),
  loopIntervalInMs: z.number().min(0).max(3000).optional(),
  searchEngineForBrowser: z.nativeEnum(SearchEngineForSettings).optional(),
  hermesBrowserBackend: z
    .enum(['local', 'browser-use', 'browserbase', 'camofox', 'firecrawl'])
    .optional(),
  hermesWebBackend: z
    .enum(['auto', 'firecrawl', 'tavily', 'parallel', 'exa', 'searxng'])
    .optional(),
  hermesUseGateway: z.boolean().optional(),

  // Report Settings
  reportStorageBaseUrl: z.string().url().optional(),
  utioBaseUrl: z.string().url().optional(),
  presetSource: PresetSourceSchema.optional(),
  monitors: z.array(WebMonitorSchema).optional(),
  taskRuns: z.array(TaskRunSchema).optional(),
  backgroundTasks: z.array(BackgroundTaskSchema).optional(),
  scheduledTasks: z.array(ScheduledTaskSchema).optional(),
  localTaskApi: LocalTaskApiSchema.optional(),
  mailTaskIntake: MailTaskIntakeSchema.optional(),
  desktopProjects: z.array(DesktopProjectSchema).optional(),
  neuraRoadmap: RoadmapProgressSchema.optional(),
  connectors: z.array(ConnectorSchema).optional(),
  connectorAuditLog: z.array(ConnectorAuditEventSchema).optional(),
  multimodalProviders: MultimodalProvidersSchema.optional(),
  skillsEnabled: z.boolean().optional(),
  selectedSkillName: z.string().optional(),
});

export type PresetSource = z.infer<typeof PresetSourceSchema>;
export type LocalStore = z.infer<typeof PresetSchema>;

export const validatePreset = (data: unknown): LocalStore => {
  return PresetSchema.parse(data);
};
