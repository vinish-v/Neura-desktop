/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs';
import path from 'path';

import { app } from 'electron';

import type { TaskRunRecord } from '@main/store/types';
import { logger } from '@main/logger';

type RetrievedTaskMemory = {
  runId: string;
  score: number;
  summary: string;
};

const STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'also',
  'and',
  'any',
  'are',
  'because',
  'before',
  'between',
  'build',
  'check',
  'compare',
  'current',
  'find',
  'from',
  'give',
  'have',
  'into',
  'just',
  'latest',
  'look',
  'make',
  'more',
  'news',
  'open',
  'play',
  'price',
  'research',
  'same',
  'search',
  'show',
  'task',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'this',
  'today',
  'what',
  'when',
  'with',
  'youtube',
]);

let workspaceRootOverride: string | null = null;

const normalizeText = (value?: string) => (value || '').replace(/\s+/g, ' ').trim();

const tokenize = (value: string) =>
  Array.from(
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
    ),
  );

const summarizeRun = (run: TaskRunRecord) => {
  const parts = [
    run.originalGoal,
    run.finalAnswer,
    run.currentStep,
    run.completionProof?.summary,
    ...(run.factsFound || []).slice(-4),
  ]
    .map((part) => normalizeText(part))
    .filter(Boolean);
  return parts.join(' | ').slice(0, 600);
};

const scoreRunAgainstGoal = (goal: string, run: TaskRunRecord) => {
  const goalTokens = tokenize(goal);
  if (!goalTokens.length) {
    return 0;
  }
  const runText = [
    run.originalGoal,
    run.finalAnswer,
    run.currentStep,
    run.completionProof?.summary,
    ...(run.factsFound || []),
  ]
    .map((part) => normalizeText(part))
    .join(' ');
  const runTokens = new Set(tokenize(runText));
  const overlapScore = goalTokens.reduce(
    (score, token) => score + (runTokens.has(token) ? 3 : 0),
    0,
  );
  const completionBonus =
    run.status === 'completed' ? 4 : run.status === 'running' ? -3 : 0;
  const answerBonus = run.finalAnswer ? 2 : 0;
  return overlapScore + completionBonus + answerBonus;
};

const getWorkspaceRoot = () =>
  workspaceRootOverride || path.join(app.getPath('userData'), 'task-workspaces');

const getRunWorkspacePath = (runId: string) =>
  path.join(getWorkspaceRoot(), runId);

const getRunMemoryFilePath = (runId: string) =>
  path.join(getRunWorkspacePath(runId), 'context.md');

const buildMemoryFileContents = (run: TaskRunRecord) => {
  const lines = [
    '# Neura Task Context',
    '',
    `- Run ID: ${run.runId}`,
    `- Goal: ${run.originalGoal}`,
    `- Mode: ${run.runMode}`,
    `- Status: ${run.status}`,
    `- Started At: ${new Date(run.startedAt).toISOString()}`,
  ];

  if (run.completedAt) {
    lines.push(`- Completed At: ${new Date(run.completedAt).toISOString()}`);
  }
  if (run.workspacePath) {
    lines.push(`- Workspace: ${run.workspacePath}`);
  }
  if (run.retrievedRunIds?.length) {
    lines.push(`- Retrieved Runs: ${run.retrievedRunIds.join(', ')}`);
  }

  lines.push('', '## Summary', '', normalizeText(run.memorySummary) || 'No prior task context.');

  if (run.factsFound?.length) {
    lines.push('', '## Facts', '', ...run.factsFound.slice(-8).map((fact) => `- ${normalizeText(fact)}`));
  }
  if (run.sourcesVisited?.length) {
    lines.push('', '## Sources', '', ...run.sourcesVisited.slice(-8).map((source) => `- ${source}`));
  }
  if (run.artifacts?.length) {
    lines.push(
      '',
      '## Artifacts',
      '',
      ...run.artifacts.slice(-8).map((artifact) => `- ${artifact.title}: ${artifact.path}`),
    );
  }
  if (run.finalAnswer) {
    lines.push('', '## Final Answer', '', run.finalAnswer.trim());
  }
  if (run.completionProof) {
    lines.push(
      '',
      '## Completion Proof',
      '',
      `- Kind: ${run.completionProof.kind}`,
      `- Summary: ${run.completionProof.summary}`,
      ...run.completionProof.evidence.map((evidence) => `- Evidence: ${evidence}`),
    );
  }

  return `${lines.join('\n')}\n`;
};

export const retrieveRelevantTaskMemories = (
  goal: string,
  runs: TaskRunRecord[],
  currentRunId?: string,
  limit = 3,
): RetrievedTaskMemory[] =>
  runs
    .filter((run) => run.runId !== currentRunId)
    .filter((run) => run.status === 'completed')
    .map((run) => ({
      runId: run.runId,
      score: scoreRunAgainstGoal(goal, run),
      summary: summarizeRun(run),
    }))
    .filter((run) => run.score >= 4 && run.summary)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

export const prepareTaskRunContext = (
  run: TaskRunRecord,
  previousRuns: TaskRunRecord[],
): TaskRunRecord => {
  const workspacePath = getRunWorkspacePath(run.runId);
  const memoryFilePath = getRunMemoryFilePath(run.runId);
  const retrieved = retrieveRelevantTaskMemories(
    run.originalGoal,
    previousRuns,
    run.runId,
  );
  const memorySummary = retrieved.length
    ? retrieved
        .map(
          (entry, index) =>
            `${index + 1}. ${entry.summary}`,
        )
        .join('\n')
    : undefined;

  const nextRun: TaskRunRecord = {
    ...run,
    workspacePath,
    memoryFilePath,
    memorySummary,
    retrievedRunIds: retrieved.map((entry) => entry.runId),
  };

  persistTaskRunContext(nextRun);
  return nextRun;
};

export const persistTaskRunContext = (run: TaskRunRecord) => {
  try {
    if (!run.workspacePath || !run.memoryFilePath) {
      return;
    }
    fs.mkdirSync(run.workspacePath, { recursive: true });
    fs.writeFileSync(run.memoryFilePath, buildMemoryFileContents(run), 'utf8');
  } catch (error) {
    logger.warn(
      '[taskContextMemory] failed to persist run context',
      run.runId,
      error,
    );
  }
};

export const getTaskContextHint = (run?: TaskRunRecord) => {
  const summary = normalizeText(run?.memorySummary);
  if (!summary) {
    return '';
  }
  return `\nPrior related task context:\n${summary}\nUse it only when still relevant to the current task.\n`;
};

export const __setTaskWorkspaceRootForTests = (root: string | null) => {
  workspaceRootOverride = root;
};

