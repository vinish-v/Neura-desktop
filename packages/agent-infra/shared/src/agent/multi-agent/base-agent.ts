/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AutonomousAgentModel,
  AutonomousPlanStep,
  AutonomousSkillCall,
  AutonomousSkillsRuntime,
  AutonomousToolCall,
  AutonomousToolResult,
  AutonomousToolRuntime,
} from '../autonomous-agent';
import type { MemoryManager, MemorySearchResult } from '../../memory';

export type MultiAgentName = 'planner' | 'researcher' | 'executor' | 'critic';

export type MultiAgentStatus =
  | 'planning'
  | 'researching'
  | 'executing'
  | 'reflecting'
  | 'completed'
  | 'failed';

export type MultiAgentArtifact = {
  id: string;
  title: string;
  kind: string;
  path?: string;
  dataUrl?: string;
  createdAt: number;
};

export type ConnectorRecommendation = {
  connectorId: string;
  reason: string;
  requiredPermission: 'read' | 'write' | 'admin';
};

export type MultiAgentObservation = {
  id: string;
  agentName: MultiAgentName;
  summary: string;
  detail?: string;
  createdAt: number;
};

export type MultiAgentState = {
  taskId: string;
  goal: string;
  status: MultiAgentStatus;
  iteration: number;
  maxIterations: number;
  plan: AutonomousPlanStep[];
  completedStepIds: string[];
  observations: MultiAgentObservation[];
  artifacts: MultiAgentArtifact[];
  connectorRecommendations: ConnectorRecommendation[];
  memory: MemorySearchResult[];
  currentAgent?: MultiAgentName;
  lastAgent?: MultiAgentName;
  lastResult?: MultiAgentStepResult;
  isComplete: boolean;
  finalAnswer?: string;
  error?: string;
};

export type MultiAgentStepResult = {
  agentName: MultiAgentName;
  status: 'continue' | 'retry' | 'complete' | 'fail';
  summary: string;
  detail?: string;
  plan?: AutonomousPlanStep[];
  toolCall?: AutonomousToolCall;
  skillCall?: AutonomousSkillCall;
  toolResult?: AutonomousToolResult;
  artifacts?: MultiAgentArtifact[];
  connectorRecommendations?: ConnectorRecommendation[];
  finalAnswer?: string;
};

export type MultiAgentRuntime = {
  model: AutonomousAgentModel;
  tools: AutonomousToolRuntime;
  skills?: AutonomousSkillsRuntime;
  memory?: MemoryManager;
};

export type MultiAgentEvent =
  | {
      type: 'agent.started';
      agentName: MultiAgentName;
      state: MultiAgentState;
    }
  | {
      type: 'agent.completed';
      agentName: MultiAgentName;
      result: MultiAgentStepResult;
      state: MultiAgentState;
    }
  | {
      type: 'state.updated';
      state: MultiAgentState;
    }
  | {
      type: 'artifact';
      artifact: MultiAgentArtifact;
      state: MultiAgentState;
    }
  | {
      type: 'connector.recommended';
      recommendation: ConnectorRecommendation;
      state: MultiAgentState;
    }
  | {
      type: 'completed';
      finalAnswer: string;
      state: MultiAgentState;
    };

export const compactForPrompt = (value: unknown, limit = 8000) => {
  const text =
    typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (!text) {
    return '';
  }
  return text.length > limit ? `${text.slice(0, limit)}\n...[truncated]` : text;
};

export const extractJsonObject = (value: string): Record<string, unknown> => {
  const trimmed = value.trim();
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) {
      return extractJsonObject(fenced);
    }
    const objectStart = trimmed.indexOf('{');
    const objectEnd = trimmed.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
      return extractJsonObject(trimmed.slice(objectStart, objectEnd + 1));
    }
    return {};
  }
};

export abstract class BaseAgent {
  abstract readonly name: MultiAgentName;

  constructor(protected readonly runtime: MultiAgentRuntime) {}

  abstract execute(state: MultiAgentState): Promise<MultiAgentStepResult>;

  protected observationsForPrompt(state: MultiAgentState, limit = 6000) {
    return compactForPrompt(
      state.observations.map((item) => ({
        agent: item.agentName,
        summary: item.summary,
        detail: item.detail,
      })),
      limit,
    );
  }
}
