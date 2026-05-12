/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */

export type MemoryRecordKind = 'task' | 'skill' | 'artifact' | 'note';

export type MemoryRecord = {
  id: string;
  kind: MemoryRecordKind;
  text: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt?: number;
};

export type MemorySearchResult = MemoryRecord & {
  score: number;
};

export type MemorySearchOptions = {
  kind?: MemoryRecordKind;
  limit?: number;
  minScore?: number;
};

export type TaskMemoryRecord = MemoryRecord & {
  kind: 'task';
  metadata: {
    taskId?: string;
    goal?: string;
    status?: string;
    finalAnswer?: string;
    [key: string]: unknown;
  };
};
