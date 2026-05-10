/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { GUIAgentData, Message } from '@neura-desktop/shared/types';

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
  | 'multimodal_workflow';

export type TaskComplexity = 'simple' | 'multi_step' | 'research';

export type TaskProgressEventType =
  | 'task.started'
  | 'plan.updated'
  | 'step.started'
  | 'step.completed'
  | 'step.failed'
  | 'validation.completed'
  | 'task.completed';

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

export type TaskProgressItem = {
  id: string;
  title: string;
  detail?: string;
  status: TaskTodoStatus;
  createdAt: number;
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
  verifiedAt: number;
};

export type TaskTodoItem = {
  id: string;
  text: string;
  status: TaskTodoStatus;
};

export type TaskState = {
  runId: string;
  originalGoal: string;
  runMode: AgentRunMode;
  status: TaskRunStatus;
  todoItems: TaskTodoItem[];
  progressItems: TaskProgressItem[];
  currentStep?: string;
  factsFound: string[];
  sourcesVisited: string[];
  artifacts: TaskArtifact[];
  approvalEvents: ApprovalEvent[];
  completionProof?: CompletionProof;
  finalAnswer?: string;
  error?: string;
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
  type: 'builtin' | 'mcp' | 'webhook' | 'export';
  enabled: boolean;
  authState: 'not_configured' | 'configured' | 'error';
  permissionLevel: ConnectorPermissionLevel;
  tools: string[];
  config?: Record<string, string>;
  updatedAt?: number;
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
