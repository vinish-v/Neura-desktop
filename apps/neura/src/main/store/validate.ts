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

const AgentMemorySchema = z.object({
  preferences: z.record(z.string()).optional(),
  updatedAt: z.number().optional(),
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

const TaskRunSchema = z.object({
  runId: z.string(),
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
  ]),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']),
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
  factsFound: z.array(z.string()).optional(),
  sourcesVisited: z.array(z.string()).optional(),
  artifacts: z.array(TaskArtifactSchema).optional(),
  approvalEvents: z.array(ApprovalEventSchema).optional(),
  completionProof: CompletionProofSchema.optional(),
  finalAnswer: z.string().optional(),
  error: z.string().optional(),
  validationStatus: z
    .enum(['pending', 'valid', 'invalid', 'failed'])
    .optional(),
  startedAt: z.number(),
  completedAt: z.number().optional(),
});

const ConnectorSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  type: z.enum(['builtin', 'mcp', 'webhook', 'export']),
  enabled: z.boolean(),
  authState: z.enum(['not_configured', 'configured', 'error']),
  permissionLevel: z.enum(['read', 'write', 'admin']),
  tools: z.array(z.string()),
  config: z.record(z.string()).optional(),
  updatedAt: z.number().optional(),
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

  // Report Settings
  reportStorageBaseUrl: z.string().url().optional(),
  utioBaseUrl: z.string().url().optional(),
  presetSource: PresetSourceSchema.optional(),
  monitors: z.array(WebMonitorSchema).optional(),
  agentMemory: AgentMemorySchema.optional(),
  taskRuns: z.array(TaskRunSchema).optional(),
  connectors: z.array(ConnectorSchema).optional(),
  multimodalProviders: MultimodalProvidersSchema.optional(),
});

export type PresetSource = z.infer<typeof PresetSourceSchema>;
export type LocalStore = z.infer<typeof PresetSchema>;

export const validatePreset = (data: unknown): LocalStore => {
  return PresetSchema.parse(data);
};
