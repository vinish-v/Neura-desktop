import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { TaskRunRecord } from '@main/store/types';

import {
  __setTaskWorkspaceRootForTests,
  getTaskContextHint,
  prepareTaskRunContext,
  retrieveRelevantTaskMemories,
} from './taskContextMemory';

const createRun = (overrides: Partial<TaskRunRecord>): TaskRunRecord => ({
  runId: overrides.runId || 'run-default',
  originalGoal: overrides.originalGoal || 'default goal',
  runMode: overrides.runMode || 'gui_browser',
  status: overrides.status || 'completed',
  todoItems: overrides.todoItems || [],
  progressItems: overrides.progressItems || [],
  factsFound: overrides.factsFound || [],
  sourcesVisited: overrides.sourcesVisited || [],
  artifacts: overrides.artifacts || [],
  approvalEvents: overrides.approvalEvents || [],
  startedAt: overrides.startedAt || 1_000,
  finalAnswer: overrides.finalAnswer,
  currentStep: overrides.currentStep,
  completionProof: overrides.completionProof,
  completedAt: overrides.completedAt,
  error: overrides.error,
  validationStatus: overrides.validationStatus,
  roadmapProgress: overrides.roadmapProgress,
  workspacePath: overrides.workspacePath,
  memoryFilePath: overrides.memoryFilePath,
  memorySummary: overrides.memorySummary,
  retrievedRunIds: overrides.retrievedRunIds,
});

describe('taskContextMemory', () => {
  let tempRoot = '';

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'neura-task-memory-'));
    __setTaskWorkspaceRootForTests(tempRoot);
  });

  afterEach(async () => {
    __setTaskWorkspaceRootForTests(null);
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('retrieves completed related runs by token overlap', () => {
    const matches = retrieveRelevantTaskMemories(
      'latest tamil nadu weather news',
      [
        createRun({
          runId: 'run-weather',
          originalGoal: 'find the latest Tamil Nadu weather forecast',
          finalAnswer: 'Tamil Nadu weather has heavy rain warnings today.',
          factsFound: ['Heavy rain warning for Tamil Nadu districts'],
          completionProof: {
            kind: 'source',
            summary: 'Summarized current weather reports.',
            evidence: ['https://weather.example/article'],
            verifiedAt: 2_000,
          },
        }),
        createRun({
          runId: 'run-unrelated',
          originalGoal: 'open youtube and play a song',
          finalAnswer: 'Opened YouTube.',
        }),
      ],
      'run-current',
    );

    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches.some((match) => match.runId === 'run-weather')).toBe(true);
    expect(matches.find((match) => match.runId === 'run-weather')?.summary).toContain(
      'Tamil Nadu',
    );
  });

  it('prepares a persistent workspace context file for each run', async () => {
    const prepared = prepareTaskRunContext(
      createRun({
        runId: 'run-current',
        originalGoal: 'find the latest Tamil Nadu news',
        status: 'running',
      }),
      [
        createRun({
          runId: 'run-previous',
          originalGoal: 'summarize the latest Tamil Nadu political news',
          finalAnswer: 'Summarized two Tamil Nadu political sources.',
          factsFound: ['Visited two Tamil Nadu political news sources'],
        }),
      ],
    );

    expect(prepared.workspacePath).toBe(
      path.join(tempRoot, 'run-current'),
    );
    expect(prepared.memoryFilePath).toBe(
      path.join(tempRoot, 'run-current', 'context.md'),
    );
    expect(prepared.retrievedRunIds).toEqual(['run-previous']);
    expect(prepared.memorySummary).toContain(
      'Summarized two Tamil Nadu political sources.',
    );

    const memoryContents = await fs.readFile(prepared.memoryFilePath!, 'utf8');
    expect(memoryContents).toContain('# Neura Task Context');
    expect(memoryContents).toContain('Goal: find the latest Tamil Nadu news');
    expect(memoryContents).toContain('Retrieved Runs: run-previous');
  });

  it('builds a short task context hint only when prior memory exists', () => {
    expect(getTaskContextHint(undefined)).toBe('');
    expect(
      getTaskContextHint(
        createRun({
          runId: 'run-current',
          memorySummary: '1. Prior task summarized Tamil Nadu headlines.',
        }),
      ),
    ).toContain('Prior related task context');
  });
});
