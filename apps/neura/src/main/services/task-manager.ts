/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'crypto';
import path from 'path';

import {
  AutonomousAgent,
  type AutonomousAgentEvent,
  type AutonomousAgentModel,
  type AutonomousAgentModelRequest,
  type AutonomousToolCall,
  type AutonomousToolResult,
  type AutonomousToolRuntime,
  type AutonomousSkillsRuntime,
  MultiAgentOrchestrator,
  MemoryManager,
  TaskMemoryStore,
  type MultiAgentEvent,
} from '@agent-infra/shared';
import { StatusEnum } from '@neura-desktop/shared/types';
import { app } from 'electron';
import OpenAI from 'openai';

import { logger } from '@main/logger';
import { store } from '@main/store/create';
import { SettingStore } from '@main/store/setting';
import { TaskRunRecord, TaskTodoItem } from '@main/store/types';
import { ComputerRuntimeController } from './computerRuntimeController';
import { MCPService } from './mcp-service';
import { createTaskRun, TaskRunRegistry } from './taskRunRegistry';

class OpenAIPlannerModel implements AutonomousAgentModel {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly timeout: number;

  constructor() {
    const settings = SettingStore.getStore();
    const baseURL = settings.plannerBaseUrl || settings.vlmBaseUrl;
    const apiKey = settings.plannerApiKey || settings.vlmApiKey;
    const model =
      settings.usePlannerModel !== false && settings.plannerModelName
        ? settings.plannerModelName
        : settings.vlmModelName;

    if (!baseURL || !apiKey || !model) {
      throw new Error(
        'MCP autonomous mode requires a configured planner or chat model.',
      );
    }

    this.client = new OpenAI({
      baseURL,
      apiKey,
      maxRetries: 0,
    });
    this.model = model;
    this.timeout = settings.plannerTimeoutInMs || 90_000;
  }

  async complete(request: AutonomousAgentModelRequest) {
    const response = await this.client.chat.completions.create(
      {
        model: this.model,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.role === 'planner' ? 1800 : 1200,
        stream: false,
        messages: [
          {
            role: 'system',
            content: request.system,
          },
          {
            role: 'user',
            content: request.user,
          },
        ],
      },
      { timeout: this.timeout },
    );

    return response.choices?.[0]?.message?.content?.trim() || '';
  }
}

class MCPAutonomousRuntime implements AutonomousToolRuntime {
  constructor(private readonly mcpService: MCPService) {}

  async listTools() {
    const tools = await this.mcpService.listTools();
    return tools.map((tool) => ({
      name: tool.name,
      serverName: tool.serverName,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  async callTool(call: AutonomousToolCall): Promise<AutonomousToolResult> {
    const result = await this.mcpService.callTool({
      serverName: call.serverName,
      name: call.name,
      arguments: call.arguments,
    });
    const record = result as Record<string, unknown>;
    return {
      isError: typeof record.isError === 'boolean' ? record.isError : false,
      content: record.content || result,
    };
  }
}

class DesktopSkillsRuntime implements AutonomousSkillsRuntime {
  async listSkills() {
    const { SkillsService } = await import('./skills-service');
    const skills = await SkillsService.getInstance().list();
    return skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      tools: skill.tools,
      chains: skill.chains,
      tags: skill.tags,
    }));
  }

  async getSkill(name: string) {
    const { SkillsService } = await import('./skills-service');
    return SkillsService.getInstance().get(name);
  }
}

const compact = (value: unknown, limit = 900) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) {
    return '';
  }
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
};

type TaskStartOptions = {
  signal?: AbortSignal;
  backgroundTaskId?: string;
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

  private async handleEvent(runId: string, event: AutonomousAgentEvent) {
    if (event.type === 'plan') {
      const todoItems: TaskTodoItem[] = event.steps.map((step) => ({
        id: step.id,
        text: step.title,
        status: 'pending',
      }));
      this.patch(runId, {
        todoItems,
        currentStep: 'Plan created',
        phase: 'planning',
        activeAgent: 'planner',
      });
      this.addProgress(runId, {
        title: 'Plan created',
        detail: event.steps.map((step) => step.title).join('\n'),
        status: 'done',
      });
      return;
    }

    if (event.type === 'step.started') {
      const run = this.getRun(runId);
      this.patch(runId, {
        currentStep: event.step.title,
        phase: 'acting',
        activeAgent: 'executor',
        todoItems:
          run?.todoItems.map((item) =>
            item.id === event.step.id
              ? { ...item, status: 'in_progress' }
              : item,
          ) || [],
      });
      this.addProgress(runId, {
        title: event.step.title,
        detail: event.step.detail,
        status: 'in_progress',
      });
      return;
    }

    if (event.type === 'tool.called') {
      TaskRunRegistry.addToolCall(runId, {
        serverName: event.tool.serverName,
        toolName: event.tool.name,
        arguments: event.tool.arguments,
        status: event.result.isError ? 'failed' : 'completed',
        resultPreview: compact(event.result),
      });
      this.addProgress(runId, {
        title: `${event.tool.serverName}: ${event.tool.name}`,
        detail: compact(event.result),
        status: event.result.isError ? 'failed' : 'done',
      });
      return;
    }

    if (event.type === 'screenshot') {
      ComputerRuntimeController.frame({
        dataUrl: event.dataUrl,
        mime: event.dataUrl.match(/^data:([^;]+)/)?.[1] || 'image/png',
      });
      this.addProgress(runId, {
        title: 'Screenshot captured',
        detail: event.step.title,
        status: 'done',
      });
      return;
    }

    if (event.type === 'step.completed') {
      const run = this.getRun(runId);
      this.patch(runId, {
        phase: 'observing',
        todoItems:
          run?.todoItems.map((item) =>
            item.id === event.step.id ? { ...item, status: 'done' } : item,
          ) || [],
      });
      this.addProgress(runId, {
        title: `Completed: ${event.step.title}`,
        detail: event.reflection.reason,
        status: 'done',
      });
      return;
    }

    if (event.type === 'step.failed') {
      TaskRunRegistry.addValidationFailure(runId, event.error);
      const run = this.getRun(runId);
      this.patch(runId, {
        phase: 'failed',
        todoItems:
          run?.todoItems.map((item) =>
            item.id === event.step.id ? { ...item, status: 'failed' } : item,
          ) || [],
      });
      this.addProgress(runId, {
        title: `Failed: ${event.step.title}`,
        detail: event.error,
        status: 'failed',
      });
      return;
    }

    if (event.type === 'completed') {
      this.patch(runId, {
        finalAnswer: event.finalAnswer,
        phase: 'completed',
      });
    }
  }

  async startMcpAutonomousTask(goal: string, options: TaskStartOptions = {}) {
    return this.startAutonomousTask({
      goal,
      runMode: 'mcp_autonomous',
      signal: options.signal,
      backgroundTaskId: options.backgroundTaskId,
    });
  }

  async startMultiAgentTask(goal: string, options: TaskStartOptions = {}) {
    const trimmedGoal = goal.trim();
    if (!trimmedGoal) {
      throw new Error('Task goal is required.');
    }

    const run = {
      ...createTaskRun(trimmedGoal, 'multi_agent'),
      phase: 'planning' as const,
      backgroundTaskId: options.backgroundTaskId,
    };
    this.upsert(run);
    ComputerRuntimeController.start({
      mode: 'browser',
      title: 'Multi-Agent Task',
      subtitle: 'Planner, researcher, executor, critic',
      display: 'Multi-agent',
      activity: 'Planning',
    });
    store.setState({
      status: StatusEnum.RUNNING,
      thinking: true,
      errorMsg: null,
    });

    try {
      const mcpService = MCPService.getInstance();
      const memory = new MemoryManager({
        taskStore: new TaskMemoryStore(
          path.join(app.getPath('userData'), 'memory', 'tasks.json'),
        ),
      });
      const orchestrator = new MultiAgentOrchestrator();
      const finalAnswer = await orchestrator.run({
        taskId: run.runId,
        goal: trimmedGoal,
        model: new OpenAIPlannerModel(),
        tools: new MCPAutonomousRuntime(mcpService),
        skills: new DesktopSkillsRuntime(),
        memory,
        maxIterations: 18,
        signal: options.signal,
        onEvent: (event) => this.handleMultiAgentEvent(run.runId, event),
      });

      const completed = this.patch(run.runId, {
        status: 'completed',
        phase: 'completed',
        finalAnswer,
        validationStatus: 'valid',
        completionProof: {
          kind: 'connector_action',
          summary: 'Multi-agent task completed.',
          evidence: [finalAnswer],
          verifiedAt: Date.now(),
        },
        completedAt: Date.now(),
      });
      ComputerRuntimeController.complete('Multi-agent task completed');
      store.setState({
        status: StatusEnum.END,
        thinking: false,
        messages: [
          ...(store.getState().messages || []),
          {
            from: 'gpt',
            value: finalAnswer,
          },
        ],
        taskState: completed || store.getState().taskState,
      });
      return completed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('[TaskManager] multi-agent task failed', error);
      const wasCancelled = options.signal?.aborted;
      const failed = this.patch(run.runId, {
        status: wasCancelled ? 'cancelled' : 'failed',
        phase: wasCancelled ? 'cancelled' : 'failed',
        error: message,
        finalAnswer: wasCancelled
          ? `The multi-agent task was cancelled: ${message}`
          : `I could not complete the multi-agent task: ${message}`,
        completedAt: Date.now(),
      });
      this.addProgress(run.runId, {
        title: wasCancelled
          ? 'Multi-agent task cancelled'
          : 'Multi-agent task failed',
        detail: message,
        status: wasCancelled ? 'done' : 'failed',
        eventType: 'task.failed',
      });
      if (wasCancelled) {
        ComputerRuntimeController.complete('Multi-agent task cancelled');
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

  async startSkillTask(input: {
    skillName: string;
    arguments?: Record<string, unknown>;
    goal?: string;
    signal?: AbortSignal;
    backgroundTaskId?: string;
  }) {
    const { SkillsService } = await import('./skills-service');
    const skill = await SkillsService.getInstance().get(input.skillName);
    if (!skill) {
      throw new Error(`Skill not found: ${input.skillName}`);
    }

    const goal = [
      input.goal || `Use ${skill.name} skill.`,
      '',
      `Skill: ${skill.name}`,
      `Description: ${skill.description}`,
      '',
      `Instructions:\n${skill.instructions}`,
      '',
      `Arguments:\n${JSON.stringify(input.arguments || {}, null, 2)}`,
    ].join('\n');

    return this.startAutonomousTask({
      goal,
      runMode: 'skill',
      publicGoal: input.goal || `Use ${skill.name} skill`,
      signal: input.signal,
      backgroundTaskId: input.backgroundTaskId,
    });
  }

  private async startAutonomousTask(input: {
    goal: string;
    runMode: 'mcp_autonomous' | 'skill';
    publicGoal?: string;
    signal?: AbortSignal;
    backgroundTaskId?: string;
  }) {
    const { goal, runMode, publicGoal, signal, backgroundTaskId } = input;
    const trimmedGoal = goal.trim();
    if (!trimmedGoal) {
      throw new Error('Task goal is required.');
    }

    const run = {
      ...createTaskRun(publicGoal || trimmedGoal, runMode),
      phase: 'planning' as const,
      backgroundTaskId,
    };
    this.upsert(run);
    ComputerRuntimeController.start({
      mode: 'browser',
      title: runMode === 'skill' ? 'Skill Task' : 'MCP Autonomous Task',
      subtitle: runMode === 'skill' ? 'Skill' : 'MCP',
      display: runMode === 'skill' ? 'Skills' : 'MCP tools',
      activity: 'Planning',
    });
    store.setState({
      status: StatusEnum.RUNNING,
      thinking: true,
      errorMsg: null,
    });

    try {
      const mcpService = MCPService.getInstance();
      const agent = new AutonomousAgent();
      const finalAnswer = await agent.run({
        goal: trimmedGoal,
        model: new OpenAIPlannerModel(),
        tools: new MCPAutonomousRuntime(mcpService),
        skills: new DesktopSkillsRuntime(),
        maxSteps: 12,
        maxRetriesPerStep: 1,
        signal,
        onEvent: (event) => this.handleEvent(run.runId, event),
      });

      const completed = this.patch(run.runId, {
        status: 'completed',
        phase: 'completed',
        finalAnswer,
        validationStatus: 'valid',
        completionProof: {
          kind: 'connector_action',
          summary:
            runMode === 'skill'
              ? 'Skill task completed.'
              : 'MCP autonomous task completed.',
          evidence: [finalAnswer],
          verifiedAt: Date.now(),
        },
        completedAt: Date.now(),
      });
      ComputerRuntimeController.complete('MCP task completed');
      store.setState({
        status: StatusEnum.END,
        thinking: false,
        messages: [
          ...(store.getState().messages || []),
          {
            from: 'gpt',
            value: finalAnswer,
          },
        ],
        taskState: completed || store.getState().taskState,
      });
      return completed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('[TaskManager] MCP autonomous task failed', error);
      const wasCancelled = signal?.aborted;
      const failed = this.patch(run.runId, {
        status: wasCancelled ? 'cancelled' : 'failed',
        phase: wasCancelled ? 'cancelled' : 'failed',
        error: message,
        finalAnswer: wasCancelled
          ? `The ${runMode === 'skill' ? 'skill' : 'MCP autonomous'} task was cancelled: ${message}`
          : `I could not complete the ${runMode === 'skill' ? 'skill' : 'MCP autonomous'} task: ${message}`,
        completedAt: Date.now(),
      });
      this.addProgress(run.runId, {
        title: wasCancelled
          ? 'MCP autonomous task cancelled'
          : 'MCP autonomous task failed',
        detail: message,
        status: wasCancelled ? 'done' : 'failed',
      });
      if (wasCancelled) {
        ComputerRuntimeController.complete('MCP task cancelled');
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

  createRunId() {
    return `run_${Date.now()}_${randomUUID().slice(0, 8)}`;
  }

  private async handleMultiAgentEvent(runId: string, event: MultiAgentEvent) {
    if (event.type === 'agent.started') {
      this.patch(runId, {
        currentStep: `${event.agentName} agent`,
        phase:
          event.agentName === 'planner'
            ? 'planning'
            : event.agentName === 'critic'
              ? 'validating'
              : 'acting',
        activeAgent: event.agentName,
      });
      this.addProgress(runId, {
        title: `${event.agentName}: started`,
        detail: `Iteration ${event.state.iteration + 1}`,
        status: 'in_progress',
        agentName: event.agentName,
        eventType: event.type,
      });
      return;
    }

    if (event.type === 'agent.completed') {
      if (event.result.toolCall) {
        TaskRunRegistry.addToolCall(runId, {
          serverName: event.result.toolCall.serverName,
          toolName: event.result.toolCall.name,
          arguments: event.result.toolCall.arguments,
          status: event.result.toolResult?.isError ? 'failed' : 'completed',
          resultPreview: compact(event.result.toolResult || event.result.detail),
        });
      }
      if (event.result.plan?.length) {
        const todoItems: TaskTodoItem[] = event.result.plan.map((step) => ({
          id: step.id,
          text: step.title,
          status: event.state.completedStepIds.includes(step.id)
            ? 'done'
            : 'pending',
        }));
        this.patch(runId, {
          todoItems,
          currentStep: event.result.summary,
          activeAgent: event.agentName,
        });
      } else {
        const run = this.getRun(runId);
        if (run?.todoItems.length) {
          this.patch(runId, {
            todoItems: run.todoItems.map((item) =>
              event.state.completedStepIds.includes(item.id)
                ? { ...item, status: 'done' }
                : item,
            ),
            currentStep: event.result.summary,
            activeAgent: event.agentName,
          });
        }
      }

      this.addProgress(runId, {
        title: `${event.agentName}: ${event.result.summary}`,
        detail: event.result.detail,
        status: event.result.status === 'fail' ? 'failed' : 'done',
        agentName: event.agentName,
        eventType: event.type,
      });
      return;
    }

    if (event.type === 'artifact') {
      if (event.artifact.dataUrl) {
        ComputerRuntimeController.frame({
          dataUrl: event.artifact.dataUrl,
          mime:
            event.artifact.dataUrl.match(/^data:([^;]+)/)?.[1] || 'image/png',
        });
      }
      if (event.artifact.path) {
        TaskRunRegistry.addArtifact(runId, {
          id: event.artifact.id,
          title: event.artifact.title,
          kind: 'other',
          path: event.artifact.path,
          createdAt: event.artifact.createdAt,
        });
      }
      this.addProgress(runId, {
        title: `Artifact: ${event.artifact.title}`,
        detail: event.artifact.path || event.artifact.kind,
        status: 'done',
        eventType: event.type,
      });
      return;
    }

    if (event.type === 'connector.recommended') {
      this.addProgress(runId, {
        title: `Connector recommended: ${event.recommendation.connectorId}`,
        detail: `${event.recommendation.reason} Permission: ${event.recommendation.requiredPermission}`,
        status: 'pending',
        eventType: event.type,
      });
      return;
    }

    if (event.type === 'completed') {
      this.patch(runId, {
        finalAnswer: event.finalAnswer,
        phase: 'completed',
      });
    }
  }
}
