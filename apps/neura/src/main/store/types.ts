/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { GUIAgentData, Message } from '@neura-desktop/shared/types';
import type {
  EvidenceCompletionStatus,
  TaskEvidence,
  TaskEvidenceValidationResult,
} from '@shared/taskEvidence';

import { LocalStore, PresetSource } from './validate';
import { ConversationWithSoM } from '@main/shared/types';

export type NextAction =
  | { type: 'key'; text: string }
  | { type: 'type'; text: string }
  | { type: 'mouse_move'; x: number; y: number }
  | { type: 'left_click' }
  | { type: 'left_click_drag'; x: number; y: number }
  | { type: 'right_click' }
  | { type: 'middle_click' }
  | { type: 'double_click' }
  | { type: 'screenshot' }
  | { type: 'cursor_position' }
  | { type: 'finish' }
  | { type: 'error'; message: string };

export type AgentRunMode =
  | 'direct'
  | 'gui_computer'
  | 'gui_browser'
  | 'executor_browser'
  | 'wide_research'
  | 'website_builder'
  | 'artifact_workflow'
  | 'multimodal_workflow'
  | 'mcp_autonomous'
  | 'skill'
  | 'multi_agent';

export type HermesTaskMode =
  | 'research'
  | 'scrape'
  | 'code'
  | 'spreadsheet'
  | 'browser_login'
  | 'scheduled_job'
  | 'general';

export type HermesBrowserBackend =
  | 'local'
  | 'browser-use'
  | 'browserbase'
  | 'camofox'
  | 'firecrawl';

export type TaskComplexity = 'simple' | 'multi_step' | 'research';

export type TaskProgressEventType =
  | 'task.started'
  | 'plan.updated'
  | 'step.started'
  | 'step.completed'
  | 'step.failed'
  | 'validation.completed'
  | 'task.completed';

export type TaskRunPhase =
  | 'planning'
  | 'acting'
  | 'observing'
  | 'validating'
  | 'waiting_for_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TaskTodoStatus = 'pending' | 'in_progress' | 'done' | 'failed';

export type TaskRunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ArtifactKind =
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'image'
  | 'audio'
  | 'video'
  | 'website'
  | 'archive'
  | 'data'
  | 'report'
  | 'other';

export type TaskArtifact = {
  id: string;
  title: string;
  kind: ArtifactKind;
  mimeType?: string;
  path: string;
  previewPath?: string;
  sourceRunId: string;
  createdAt: number;
};

export type TaskSourceQuality = {
  score: number;
  tier: 'high' | 'medium' | 'low';
  reasons: string[];
  domain?: string;
};

export type TaskProgressItem = {
  id: string;
  title: string;
  detail?: string;
  status: TaskTodoStatus;
  createdAt: number;
  completedAt?: number;
  agentName?: 'planner' | 'researcher' | 'executor' | 'critic';
  eventType?: string;
};

export type TaskSourceRecord = {
  id: string;
  url: string;
  title?: string;
  sourceName?: string;
  excerpt?: string;
  quality?: TaskSourceQuality;
  validationNotes?: string[];
  capturedAt: number;
};

export type TaskToolCallRecord = {
  id: string;
  externalCallId?: string;
  serverName: string;
  toolName: string;
  arguments?: Record<string, unknown>;
  status: 'pending' | 'completed' | 'failed';
  resultPreview?: string;
  startedAt: number;
  completedAt?: number;
};

export type TaskCheckpoint = {
  id: string;
  label: string;
  status: 'created' | 'resumed' | 'retrying' | 'validated' | 'failed';
  summary?: string;
  createdAt: number;
};

export type BackgroundTaskKind = 'mcp_autonomous' | 'skill' | 'multi_agent';

export type BackgroundTaskStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type BackgroundTaskRecord = {
  id: string;
  kind: BackgroundTaskKind;
  goal: string;
  status: BackgroundTaskStatus;
  runId?: string;
  skillName?: string;
  arguments?: Record<string, unknown>;
  error?: string;
  cancelRequested?: boolean;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
};

export type ApprovalEvent = {
  id: string;
  action: string;
  target?: string;
  risk: 'low' | 'medium' | 'high';
  status: 'requested' | 'approved' | 'denied' | 'auto_approved';
  createdAt: number;
};

export type CompletionProof = {
  kind:
    | 'source'
    | 'artifact'
    | 'browser_terminal_page'
    | 'local_action'
    | 'connector_action';
  summary: string;
  evidence: string[];
  completionStatus?: EvidenceCompletionStatus;
  confidence?: number;
  missingEvidence?: string[];
  sourceQuality?: {
    sourceCount: number;
    highQualityCount: number;
    mediumOrBetterCount: number;
    averageScore: number;
    domains: string[];
  };
  verifiedAt: number;
};

export type RoadmapTaskStatus =
  | 'not_started'
  | 'in_progress'
  | 'blocked'
  | 'done';

export type RoadmapEvidenceKind =
  | 'test'
  | 'typecheck'
  | 'build'
  | 'manual'
  | 'commit'
  | 'tag';

export type RoadmapEvidence = {
  id: string;
  kind: RoadmapEvidenceKind;
  summary: string;
  command?: string;
  artifactPath?: string;
  url?: string;
  recordedAt: number;
};

export type RoadmapTask = {
  id: string;
  title: string;
  doneWhen: string;
  status: RoadmapTaskStatus;
  evidence: RoadmapEvidence[];
  updatedAt?: number;
  blockedReason?: string;
};

export type RoadmapPhase = {
  id: string;
  title: string;
  summary: string;
  tasks: RoadmapTask[];
};

export type RoadmapProgress = {
  id: string;
  title: string;
  version: number;
  phases: RoadmapPhase[];
  updatedAt: number;
};

export type TaskTodoItem = {
  id: string;
  text: string;
  status: TaskTodoStatus;
};

export type TaskState = {
  runId: string;
  sessionId?: string;
  originalGoal: string;
  runMode: AgentRunMode;
  taskMode?: HermesTaskMode;
  browserBackend?: HermesBrowserBackend;
  status: TaskRunStatus;
  phase?: TaskRunPhase;
  activeAgent?: 'planner' | 'researcher' | 'executor' | 'critic';
  backgroundTaskId?: string;
  retryOfRunId?: string;
  retryCount?: number;
  workspacePath?: string;
  memoryFilePath?: string;
  memorySummary?: string;
  retrievedRunIds?: string[];
  checkpoints?: TaskCheckpoint[];
  todoItems: TaskTodoItem[];
  progressItems: TaskProgressItem[];
  currentStep?: string;
  factsFound: string[];
  sourcesVisited: string[];
  sourceRecords: TaskSourceRecord[];
  toolCalls: TaskToolCallRecord[];
  artifacts: TaskArtifact[];
  artifactManifestPath?: string;
  approvalEvents: ApprovalEvent[];
  evidence?: TaskEvidence[];
  evidenceValidation?: TaskEvidenceValidationResult;
  completionProof?: CompletionProof;
  roadmapProgress?: RoadmapProgress;
  finalAnswer?: string;
  error?: string;
  validationFailures: string[];
  validationStatus?: 'pending' | 'valid' | 'invalid' | 'failed';
  startedAt: number;
  completedAt?: number;
};

export type TaskRunRecord = TaskState;

export type ComputerRuntimeMode = 'browser' | 'terminal' | 'desktop' | 'rdp';

export type ComputerRuntimeStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'waiting'
  | 'paused'
  | 'completed'
  | 'failed';

export type ComputerRuntimeEventType =
  | 'runtime.started'
  | 'runtime.frame'
  | 'runtime.output'
  | 'runtime.mode_changed'
  | 'runtime.takeover_changed'
  | 'runtime.completed'
  | 'runtime.failed';

export type ComputerRuntimeFrame = {
  dataUrl?: string;
  mime?: string;
  width?: number;
  height?: number;
  scaleFactor?: number;
  sourceId?: string;
  sourceName?: string;
  updatedAt: number;
};

export type ComputerRuntimeOutput = {
  kind: 'terminal';
  command?: string;
  cwd?: string;
  stdout?: string;
  stderr?: string;
  raw?: string;
  failed: boolean;
  updatedAt: number;
};

export type ComputerRuntimeSurface =
  | 'native_browser'
  | 'frame_stream'
  | 'terminal';

export type ComputerRuntimeBrowserState = {
  surfaceId: string;
  url?: string;
  title?: string;
  canGoBack?: boolean;
  canGoForward?: boolean;
  updatedAt: number;
};

export type ComputerRuntimeEvent = {
  id: string;
  type: ComputerRuntimeEventType;
  mode: ComputerRuntimeMode;
  message?: string;
  createdAt: number;
};

export type ComputerRuntimeState = {
  mode: ComputerRuntimeMode;
  status: ComputerRuntimeStatus;
  surface?: ComputerRuntimeSurface;
  title: string;
  subtitle?: string;
  display?: string;
  activity?: string;
  currentUrl?: string;
  cwd?: string;
  browser?: ComputerRuntimeBrowserState;
  frame?: ComputerRuntimeFrame;
  terminal?: ComputerRuntimeOutput;
  latestFrame?: ComputerRuntimeFrame;
  latestOutput?: ComputerRuntimeOutput;
  activeProcessId?: string;
  takeoverEnabled: boolean;
  events: ComputerRuntimeEvent[];
  updatedAt: number;
};

export type ConnectorPermissionLevel = 'read' | 'write' | 'admin';

export type ConnectorDefinition = {
  id: string;
  displayName: string;
  type: 'builtin' | 'mcp' | 'webhook' | 'export' | 'oauth' | 'api' | 'rest';
  enabled: boolean;
  authState: 'not_configured' | 'configured' | 'error';
  permissionLevel: ConnectorPermissionLevel;
  tools: string[];
  config?: Record<string, string>;
  updatedAt?: number;
};

export type ConnectorAuditEvent = {
  id: string;
  connectorId: string;
  toolName: string;
  permission: ConnectorPermissionLevel;
  status: 'completed' | 'failed';
  error?: string;
  createdAt: number;
};

export type AppState = {
  theme: 'dark' | 'light';
  ensurePermissions: { screenCapture?: boolean; accessibility?: boolean };
  instructions: string | null;
  restUserData: Omit<GUIAgentData, 'status' | 'conversations'> | null;
  status: GUIAgentData['status'];
  errorMsg: string | null;
  sessionHistoryMessages: Message[];
  messages: ConversationWithSoM[];
  abortController: AbortController | null;
  thinking: boolean;
  browserAvailable: boolean;
  taskState: TaskState | null;
  computerRuntime: ComputerRuntimeState | null;
};

export enum VlmProvider {
  // Ollama = 'ollama',
  Huggingface = 'Hugging Face',
  vLLM = 'vLLM',
}

export enum VLMProviderV2 {
  nvidia_nim = 'NVIDIA NIM',
  neura_1_0 = 'Hugging Face for Neura-1.0',
  neura_1_5 = 'Hugging Face for Neura-1.5',
  doubao_1_5 = 'VolcEngine Ark for Doubao-1.5-Neura',
  doubao_1_5_vl = 'VolcEngine Ark for Doubao-1.5-thinking-vision-pro',
}

export enum SearchEngineForSettings {
  GOOGLE = 'google',
  BAIDU = 'baidu',
  BING = 'bing',
}

export enum Operator {
  RemoteComputer = 'Remote Computer Operator',
  RemoteBrowser = 'Remote Browser Operator',
  LocalComputer = 'Local Computer Operator',
  LocalBrowser = 'Local Browser Operator',
}

export type { PresetSource, LocalStore };
