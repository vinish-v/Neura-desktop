/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AutonomousSkillCall,
  AutonomousTool,
  AutonomousToolCall,
  AutonomousToolResult,
} from '../autonomous-agent';
import {
  BaseAgent,
  compactForPrompt,
  extractJsonObject,
  type MultiAgentArtifact,
  type MultiAgentState,
  type MultiAgentStepResult,
} from './base-agent';

const normalizeToolCall = (
  candidate: unknown,
  tools: AutonomousTool[],
): AutonomousToolCall | undefined => {
  if (!candidate || typeof candidate !== 'object') {
    return undefined;
  }
  const record = candidate as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const serverName =
    typeof record.serverName === 'string' ? record.serverName.trim() : '';
  const matched = tools.find(
    (tool) =>
      tool.name === name && (!serverName || tool.serverName === serverName),
  );
  if (!matched) {
    return undefined;
  }
  return {
    serverName: matched.serverName,
    name: matched.name,
    arguments:
      record.arguments && typeof record.arguments === 'object'
        ? (record.arguments as Record<string, unknown>)
        : {},
  };
};

const normalizeSkillCall = (
  candidate: unknown,
  skillNames: string[],
): AutonomousSkillCall | undefined => {
  if (!candidate || typeof candidate !== 'object') {
    return undefined;
  }
  const record = candidate as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!name || !skillNames.includes(name)) {
    return undefined;
  }
  return {
    name,
    arguments:
      record.arguments && typeof record.arguments === 'object'
        ? (record.arguments as Record<string, unknown>)
        : {},
  };
};

const extractArtifacts = (
  result: AutonomousToolResult,
): MultiAgentArtifact[] => {
  const content = Array.isArray(result.content) ? result.content : [];
  return content
    .map((item, index): MultiAgentArtifact | null => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const record = item as Record<string, unknown>;
      const type = typeof record.type === 'string' ? record.type : '';
      const data = typeof record.data === 'string' ? record.data : '';
      const path = typeof record.path === 'string' ? record.path : undefined;
      const mimeType =
        typeof record.mimeType === 'string' ? record.mimeType : undefined;
      if (type !== 'image' && !path) {
        return null;
      }
      return {
        id: `artifact-${Date.now()}-${index}`,
        title: path || `${mimeType || type || 'artifact'} result`,
        kind: type || mimeType || 'other',
        path,
        dataUrl:
          type === 'image' && data
            ? data.startsWith('data:')
              ? data
              : `data:${mimeType || 'image/png'};base64,${data}`
            : undefined,
        createdAt: Date.now(),
      };
    })
    .filter((artifact): artifact is MultiAgentArtifact => Boolean(artifact));
};

export class ExecutorAgent extends BaseAgent {
  readonly name = 'executor' as const;

  async execute(state: MultiAgentState): Promise<MultiAgentStepResult> {
    const nextStep = state.plan.find(
      (step) => !state.completedStepIds.includes(step.id),
    );
    if (!nextStep) {
      return {
        agentName: this.name,
        status: 'complete',
        summary: 'No remaining plan steps.',
      };
    }

    const tools = await this.runtime.tools.listTools();
    const skills = (await this.runtime.skills?.listSkills()) || [];
    const output = await this.runtime.model.complete({
      role: 'executor',
      temperature: 0.15,
      system:
        'You are Neura Executor. Choose one real action for the current step. Return only JSON.',
      user: [
        `Goal:\n${state.goal}`,
        '',
        `Current step:\n${nextStep.title}`,
        nextStep.detail ? `Detail:\n${nextStep.detail}` : '',
        '',
        `Prior observations:\n${this.observationsForPrompt(state) || 'None'}`,
        '',
        `Available tools:\n${compactForPrompt(tools, 6000)}`,
        '',
        `Available skills:\n${compactForPrompt(skills, 4000)}`,
        '',
        'Return JSON: {"action":"tool|skill|reason","tool":{"serverName":"server","name":"tool","arguments":{}},"skill":{"name":"skill-name","arguments":{}},"reason":"only for reason action"}',
        'Use tool or skill only when it is available. Use reason when no safe external action is needed.',
      ].join('\n'),
    });
    const action = extractJsonObject(output);
    const toolCall = normalizeToolCall(action.tool, tools);
    const skillCall = normalizeSkillCall(
      action.skill,
      skills.map((skill) => skill.name),
    );

    if (toolCall) {
      const toolResult = await this.runtime.tools.callTool(toolCall);
      return {
        agentName: this.name,
        status: toolResult.isError ? 'retry' : 'continue',
        summary: `${toolCall.serverName}: ${toolCall.name}`,
        detail: compactForPrompt(toolResult, 4000),
        toolCall,
        toolResult,
        artifacts: extractArtifacts(toolResult),
      };
    }

    if (skillCall && this.runtime.skills) {
      const skill = await this.runtime.skills.getSkill(skillCall.name);
      if (!skill) {
        return {
          agentName: this.name,
          status: 'retry',
          summary: `Skill not found: ${skillCall.name}`,
          skillCall,
        };
      }
      const skillOutput = await this.runtime.model.complete({
        role: 'executor',
        temperature: 0.2,
        system:
          'You are Neura Executor running a selected reusable skill. Follow the skill instructions and produce the next concrete result.',
        user: [
          `Goal:\n${state.goal}`,
          '',
          `Current step:\n${nextStep.title}`,
          '',
          `Skill: ${skill.name}`,
          `Description: ${skill.description}`,
          `Instructions:\n${skill.instructions}`,
          `Arguments:\n${compactForPrompt(skillCall.arguments || {}, 2000)}`,
          '',
          `Prior observations:\n${this.observationsForPrompt(state) || 'None'}`,
        ].join('\n'),
      });
      return {
        agentName: this.name,
        status: 'continue',
        summary: `Used skill: ${skill.name}`,
        detail: skillOutput.trim(),
        skillCall,
      };
    }

    const reason =
      typeof action.reason === 'string' && action.reason.trim()
        ? action.reason.trim()
        : output.trim();
    return {
      agentName: this.name,
      status: 'continue',
      summary: nextStep.title,
      detail: reason,
    };
  }
}
