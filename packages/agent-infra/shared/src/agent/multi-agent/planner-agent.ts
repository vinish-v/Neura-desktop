/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AutonomousPlanStep } from '../autonomous-agent';
import {
  BaseAgent,
  compactForPrompt,
  extractJsonObject,
  type ConnectorRecommendation,
  type MultiAgentState,
  type MultiAgentStepResult,
} from './base-agent';

const normalizePlan = (raw: unknown, goal: string): AutonomousPlanStep[] => {
  const record =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const steps = Array.isArray(record.steps) ? record.steps : [];
  const normalized = steps
    .map((step, index): AutonomousPlanStep | null => {
      if (!step || typeof step !== 'object') {
        return null;
      }
      const item = step as Record<string, unknown>;
      const title =
        typeof item.title === 'string' && item.title.trim()
          ? item.title.trim()
          : `Step ${index + 1}`;
      return {
        id:
          typeof item.id === 'string' && item.id.trim()
            ? item.id.trim()
            : `step-${index + 1}`,
        title,
        detail:
          typeof item.detail === 'string' && item.detail.trim()
            ? item.detail.trim()
            : undefined,
      };
    })
    .filter((step): step is AutonomousPlanStep => Boolean(step));

  return normalized.length
    ? normalized
    : [
        {
          id: 'step-1',
          title: 'Work toward the user goal',
          detail: goal,
        },
      ];
};

export class PlannerAgent extends BaseAgent {
  readonly name = 'planner' as const;

  async execute(state: MultiAgentState): Promise<MultiAgentStepResult> {
    const tools = await this.runtime.tools.listTools();
    const skills = (await this.runtime.skills?.listSkills()) || [];
    const recommendations = recommendConnectors(
      state.goal,
      tools.map((tool) => tool.name),
    );
    const output = await this.runtime.model.complete({
      role: 'planner',
      temperature: 0.15,
      system:
        'You are Neura Planner in a multi-agent system. Build a compact, executable plan. Return only JSON.',
      user: [
        `Goal:\n${state.goal}`,
        '',
        `Relevant memory:\n${compactForPrompt(state.memory, 5000)}`,
        '',
        `Available MCP tools:\n${compactForPrompt(
          tools.map((tool) => ({
            serverName: tool.serverName,
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
          6000,
        )}`,
        '',
        `Available skills:\n${compactForPrompt(skills, 4000)}`,
        '',
        recommendations.length
          ? `Recommended connectors not currently available:\n${compactForPrompt(
              recommendations,
              2000,
            )}`
          : 'Recommended connectors not currently available: none',
        '',
        'Return JSON: {"steps":[{"id":"step-1","title":"short public step","detail":"what must be achieved"}]}',
        recommendations.length
          ? 'When a required connector is missing, include an early step that asks the user to connect it before attempting connector-specific work.'
          : '',
      ].join('\n'),
    });

    const plan = normalizePlan(extractJsonObject(output), state.goal);
    const planned =
      recommendations.length && !state.connectorRecommendations.length
        ? [
            {
              id: 'connectors-required',
              title: 'Connect required integrations',
              detail: recommendations
                .map(
                  (item) =>
                    `${item.connectorId}: ${item.reason} (${item.requiredPermission})`,
                )
                .join('\n'),
            },
            ...plan,
          ]
        : plan;
    return {
      agentName: this.name,
      status: 'continue',
      summary: `Created ${planned.length} step plan.`,
      detail: planned.map((step) => step.title).join('\n'),
      plan: planned,
      connectorRecommendations: recommendations,
    };
  }
}

const recommendConnectors = (
  goal: string,
  availableToolNames: string[],
): ConnectorRecommendation[] => {
  const lower = goal.toLowerCase();
  const recommendations: ConnectorRecommendation[] = [];
  const maybeAdd = (
    connectorId: string,
    toolName: string,
    requiredPermission: ConnectorRecommendation['requiredPermission'],
    pattern: RegExp,
    reason: string,
  ) => {
    if (pattern.test(lower) && !availableToolNames.includes(toolName)) {
      recommendations.push({ connectorId, reason, requiredPermission });
    }
  };

  maybeAdd(
    'gmail',
    'gmail_list_unread',
    'read',
    /\bgmail\b|\bemail\b|\binbox\b|\bunread\b/,
    'The task refers to email or unread inbox content.',
  );
  maybeAdd(
    'notion',
    'notion_create_page',
    'write',
    /\bnotion\b|\bknowledge base\b|\bwiki\b/,
    'The task asks to create or update Notion content.',
  );
  maybeAdd(
    'slack',
    'slack_post_message',
    'write',
    /\bslack\b|\bchannel\b/,
    'The task asks to send a Slack message.',
  );
  maybeAdd(
    'github',
    'github_create_issue',
    'write',
    /\bgithub\b|\bissue\b|\brepository\b|\brepo\b/,
    'The task needs repository or issue access.',
  );

  return recommendations;
};
