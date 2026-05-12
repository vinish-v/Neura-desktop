/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import type { MemoryRecord, TaskMemoryRecord } from './types';

const readJsonArray = async (filePath: string): Promise<MemoryRecord[]> => {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MemoryRecord[]) : [];
  } catch {
    return [];
  }
};

export class TaskMemoryStore {
  constructor(private readonly filePath: string) {}

  async load() {
    return readJsonArray(this.filePath);
  }

  async save(records: MemoryRecord[]) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(records, null, 2), 'utf8');
  }

  toTaskRecord(input: {
    id: string;
    goal: string;
    status: string;
    finalAnswer?: string;
    observations?: string[];
    metadata?: Record<string, unknown>;
  }): TaskMemoryRecord {
    const text = [
      `Goal: ${input.goal}`,
      `Status: ${input.status}`,
      input.finalAnswer ? `Final answer: ${input.finalAnswer}` : '',
      input.observations?.length
        ? `Observations:\n${input.observations.join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    return {
      id: input.id,
      kind: 'task',
      text,
      metadata: {
        taskId: input.id,
        goal: input.goal,
        status: input.status,
        finalAnswer: input.finalAnswer,
        ...(input.metadata || {}),
      },
      createdAt: Date.now(),
    };
  }
}
