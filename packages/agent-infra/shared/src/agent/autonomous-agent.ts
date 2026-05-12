/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */

export type AutonomousAgentRole = 'planner' | 'executor' | 'reflector';

export type AutonomousAgentModelRequest = {
  role: AutonomousAgentRole;
  system: string;
  user: string;
  temperature?: number;
};

export type AutonomousAgentModel = {
  complete(request: AutonomousAgentModelRequest): Promise<string>;
};

export type AutonomousTool = {
  name: string;
  serverName: string;
  description?: string;
  inputSchema?: unknown;
};

export type AutonomousToolCall = {
  serverName: string;
  name: string;
  arguments?: Record<string, unknown>;
};

export type AutonomousSkill = {
  name: string;
  description: string;
  tools?: unknown[];
  chains?: string[];
  tags?: string[];
};

export type AutonomousSkillCall = {
  name: string;
  arguments?: Record<string, unknown>;
};

export type AutonomousToolResult = {
  isError?: boolean;
  content?: unknown;
};

export type AutonomousToolRuntime = {
  listTools(): Promise<AutonomousTool[]>;
  callTool(call: AutonomousToolCall): Promise<AutonomousToolResult>;
};

export type AutonomousSkillsRuntime = {
  listSkills(): Promise<AutonomousSkill[]>;
  getSkill(name: string): Promise<
    | (AutonomousSkill & {
        instructions: string;
        examples?: unknown[];
      })
    | null
  >;
};

export type AutonomousPlanStep = {
  id: string;
  title: string;
  detail?: string;
  tool?: AutonomousToolCall;
  skill?: AutonomousSkillCall;
};

export type AutonomousReflectionStatus =
  | 'continue'
  | 'retry'
  | 'complete'
  | 'fail';

export type AutonomousReflection = {
  status: AutonomousReflectionStatus;
  reason: string;
  finalAnswer?: string;
};

export type AutonomousAgentEvent =
  | {
      type: 'plan';
      steps: AutonomousPlanStep[];
    }
  | {
      type: 'step.started';
      step: AutonomousPlanStep;
    }
  | {
      type: 'tool.called';
      step: AutonomousPlanStep;
      tool: AutonomousToolCall;
      result: AutonomousToolResult;
    }
  | {
      type: 'step.completed';
      step: AutonomousPlanStep;
      reflection: AutonomousReflection;
      result?: AutonomousToolResult;
    }
  | {
      type: 'step.failed';
      step: AutonomousPlanStep;
      error: string;
    }
  | {
      type: 'screenshot';
      step: AutonomousPlanStep;
      dataUrl: string;
    }
  | {
      type: 'completed';
      finalAnswer: string;
    };

export type AutonomousAgentOptions = {
  goal: string;
  model: AutonomousAgentModel;
  tools: AutonomousToolRuntime;
  skills?: AutonomousSkillsRuntime;
  skillDepth?: number;
  maxSteps?: number;
  maxRetriesPerStep?: number;
  onEvent?: (event: AutonomousAgentEvent) => void | Promise<void>;
};

const extractJson = (value: string): unknown => {
  const trimmed = value.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) {
      return JSON.parse(fenced);
    }
    const objectStart = trimmed.indexOf('{');
    const objectEnd = trimmed.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
      return JSON.parse(trimmed.slice(objectStart, objectEnd + 1));
    }
    throw new Error('Model did not return valid JSON.');
  }
};

const stringifyForPrompt = (value: unknown, limit = 8000) => {
  const text =
    typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (!text) {
    return '';
  }
  return text.length > limit ? `${text.slice(0, limit)}\n...[truncated]` : text;
};

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

  if (!name) {
    return undefined;
  }

  const matchedTool = tools.find(
    (tool) =>
      tool.name === name && (!serverName || tool.serverName === serverName),
  );
  if (!matchedTool) {
    return undefined;
  }

  const args =
    record.arguments && typeof record.arguments === 'object'
      ? (record.arguments as Record<string, unknown>)
      : {};

  return {
    serverName: matchedTool.serverName,
    name: matchedTool.name,
    arguments: args,
  };
};

const normalizeSkillCall = (
  candidate: unknown,
  skills: AutonomousSkill[],
): AutonomousSkillCall | undefined => {
  if (!candidate || typeof candidate !== 'object') {
    return undefined;
  }

  const record = candidate as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!name || !skills.some((skill) => skill.name === name)) {
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

const normalizePlan = (
  raw: unknown,
  tools: AutonomousTool[],
  skills: AutonomousSkill[],
  goal: string,
): AutonomousPlanStep[] => {
  const record =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rawSteps = Array.isArray(record.steps) ? record.steps : [];
  const steps = rawSteps
    .map((item, index): AutonomousPlanStep | null => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const step = item as Record<string, unknown>;
      const title =
        typeof step.title === 'string' && step.title.trim()
          ? step.title.trim()
          : `Step ${index + 1}`;
      const detail =
        typeof step.detail === 'string' && step.detail.trim()
          ? step.detail.trim()
          : undefined;
      return {
        id:
          typeof step.id === 'string' && step.id.trim()
            ? step.id.trim()
            : `step-${index + 1}`,
        title,
        detail,
        tool: normalizeToolCall(step.tool, tools),
        skill: normalizeSkillCall(step.skill, skills),
      };
    })
    .filter((step): step is AutonomousPlanStep => Boolean(step));

  if (steps.length) {
    return steps;
  }

  return [
    {
      id: 'step-1',
      title: 'Assess the goal and available tools',
      detail: goal,
    },
  ];
};

const normalizeReflection = (raw: unknown): AutonomousReflection => {
  const record =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rawStatus =
    typeof record.status === 'string' ? record.status.toLowerCase() : '';
  const status: AutonomousReflectionStatus =
    rawStatus === 'retry' || rawStatus === 'complete' || rawStatus === 'fail'
      ? rawStatus
      : 'continue';
  return {
    status,
    reason:
      typeof record.reason === 'string' && record.reason.trim()
        ? record.reason.trim()
        : 'Step evaluated.',
    finalAnswer:
      typeof record.finalAnswer === 'string' && record.finalAnswer.trim()
        ? record.finalAnswer.trim()
        : undefined,
  };
};

const extractImageDataUrls = (result: AutonomousToolResult): string[] => {
  const content = Array.isArray(result.content) ? result.content : [];
  return content
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return '';
      }
      const record = item as Record<string, unknown>;
      const type = typeof record.type === 'string' ? record.type : '';
      const data = typeof record.data === 'string' ? record.data : '';
      const mimeType =
        typeof record.mimeType === 'string' ? record.mimeType : 'image/png';
      if (type !== 'image' || !data) {
        return '';
      }
      return data.startsWith('data:')
        ? data
        : `data:${mimeType};base64,${data}`;
    })
    .filter(Boolean);
};

export class AutonomousAgent {
  async run(options: AutonomousAgentOptions): Promise<string> {
    const maxSteps = options.maxSteps ?? 12;
    const maxRetriesPerStep = options.maxRetriesPerStep ?? 1;
    const skillDepth = options.skillDepth ?? 0;
    const availableTools = await options.tools.listTools();
    const availableSkills =
      skillDepth < 3 ? await options.skills?.listSkills() : [];
    const toolsForPrompt = availableTools.map((tool) => ({
      serverName: tool.serverName,
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
    const skillsForPrompt =
      availableSkills?.map((skill) => ({
        name: skill.name,
        description: skill.description,
        tools: skill.tools,
        chains: skill.chains,
        tags: skill.tags,
      })) || [];

    const rawPlan = await options.model.complete({
      role: 'planner',
      temperature: 0.2,
      system:
        'You are Neura Planner. Build a compact executable plan using provided MCP tools and reusable skills. Return only JSON.',
      user: [
        `Goal:\n${options.goal}`,
        '',
        `Available tools:\n${stringifyForPrompt(toolsForPrompt)}`,
        '',
        `Available skills metadata:\n${stringifyForPrompt(skillsForPrompt)}`,
        '',
        'Return JSON with this shape:',
        '{"steps":[{"id":"step-1","title":"short public step","detail":"optional","skill":{"name":"skill-name","arguments":{}},"tool":{"serverName":"server","name":"tool","arguments":{}}}]}',
        'Use skill for reusable high-level work. Use tool for direct low-level MCP work. Only include one of skill or tool per step.',
      ].join('\n'),
    });

    const steps = normalizePlan(
      extractJson(rawPlan),
      availableTools,
      availableSkills || [],
      options.goal,
    ).slice(0, maxSteps);
    await options.onEvent?.({ type: 'plan', steps });

    const observations: string[] = [];
    let finalAnswer = '';

    for (const step of steps) {
      await options.onEvent?.({ type: 'step.started', step });

      let retries = 0;
      let stepResult: AutonomousToolResult | undefined;
      while (retries <= maxRetriesPerStep) {
        try {
          if (step.skill && options.skills) {
            const skill = await options.skills.getSkill(step.skill.name);
            if (!skill) {
              throw new Error(`Skill not found: ${step.skill.name}`);
            }
            const skillGoal = [
              `Parent goal: ${options.goal}`,
              `Skill: ${skill.name}`,
              `Skill description: ${skill.description}`,
              `Skill instructions:\n${skill.instructions}`,
              `Skill arguments:\n${stringifyForPrompt(step.skill.arguments || {})}`,
            ].join('\n\n');
            const skillOutput = await this.run({
              ...options,
              goal: skillGoal,
              skillDepth: skillDepth + 1,
              maxSteps: Math.min(maxSteps, 8),
            });
            stepResult = {
              isError: false,
              content: [
                {
                  type: 'text',
                  text: skillOutput,
                },
              ],
            };
            observations.push(
              `${step.title}\nSkill: ${step.skill.name}\nResult: ${skillOutput}`,
            );
          } else if (step.tool) {
            stepResult = await options.tools.callTool(step.tool);
            await options.onEvent?.({
              type: 'tool.called',
              step,
              tool: step.tool,
              result: stepResult,
            });
            for (const dataUrl of extractImageDataUrls(stepResult)) {
              await options.onEvent?.({ type: 'screenshot', step, dataUrl });
            }
            observations.push(
              `${step.title}\nTool: ${step.tool.serverName}.${step.tool.name}\nResult: ${stringifyForPrompt(stepResult, 2500)}`,
            );
          } else {
            const executorOutput = await options.model.complete({
              role: 'executor',
              temperature: 0.2,
              system:
                'You are Neura Executor. Reason only about the current step and return a concise public observation. Do not claim external action unless a tool result proves it.',
              user: [
                `Goal:\n${options.goal}`,
                '',
                `Step:\n${step.title}`,
                step.detail ? `Detail:\n${step.detail}` : '',
                '',
                `Prior observations:\n${observations.join('\n\n') || 'None'}`,
              ].join('\n'),
            });
            stepResult = {
              isError: false,
              content: [{ type: 'text', text: executorOutput }],
            };
            observations.push(`${step.title}\n${executorOutput}`);
          }

          const rawReflection = await options.model.complete({
            role: 'reflector',
            temperature: 0,
            system:
              'You are Neura Reflector. Judge whether the latest step advanced the user goal. Return only JSON.',
            user: [
              `Goal:\n${options.goal}`,
              '',
              `Latest step:\n${step.title}`,
              '',
              `Latest result:\n${stringifyForPrompt(stepResult, 4000)}`,
              '',
              `Prior observations:\n${observations.join('\n\n')}`,
              '',
              'Return JSON: {"status":"continue|retry|complete|fail","reason":"short public reason","finalAnswer":"only when complete or fail"}',
            ].join('\n'),
          });
          const reflection = normalizeReflection(extractJson(rawReflection));
          await options.onEvent?.({
            type: 'step.completed',
            step,
            reflection,
            result: stepResult,
          });

          if (reflection.status === 'complete') {
            finalAnswer =
              reflection.finalAnswer || `Completed: ${reflection.reason}`;
            await options.onEvent?.({ type: 'completed', finalAnswer });
            return finalAnswer;
          }

          if (reflection.status === 'fail') {
            finalAnswer =
              reflection.finalAnswer ||
              `I could not complete the task: ${reflection.reason}`;
            await options.onEvent?.({ type: 'completed', finalAnswer });
            return finalAnswer;
          }

          if (reflection.status === 'retry' && retries < maxRetriesPerStep) {
            retries += 1;
            observations.push(`Retry requested: ${reflection.reason}`);
            continue;
          }

          break;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          await options.onEvent?.({
            type: 'step.failed',
            step,
            error: message,
          });
          if (retries >= maxRetriesPerStep) {
            throw error;
          }
          retries += 1;
        }
      }
    }

    finalAnswer = await options.model.complete({
      role: 'reflector',
      temperature: 0,
      system:
        'You are Neura Finalizer. Produce a concise user-facing answer grounded only in the observations.',
      user: [
        `Goal:\n${options.goal}`,
        '',
        `Observations:\n${observations.join('\n\n') || 'No observations.'}`,
      ].join('\n'),
    });
    finalAnswer = finalAnswer.trim() || 'The autonomous MCP run finished.';
    await options.onEvent?.({ type: 'completed', finalAnswer });
    return finalAnswer;
  }
}
