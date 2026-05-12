/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */

import { LocalVectorMemory } from './vector-memory';
import { TaskMemoryStore } from './task-memory';
import type { MemoryRecord, MemorySearchOptions } from './types';

export type MemoryManagerOptions = {
  taskStore?: TaskMemoryStore;
  seedRecords?: MemoryRecord[];
};

export class MemoryManager {
  private readonly vectorMemory: LocalVectorMemory;
  private loaded = false;

  constructor(private readonly options: MemoryManagerOptions = {}) {
    this.vectorMemory = new LocalVectorMemory(options.seedRecords || []);
  }

  async load() {
    if (this.loaded) {
      return;
    }
    const storedRecords = this.options.taskStore
      ? await this.options.taskStore.load()
      : [];
    storedRecords.forEach((record) => this.vectorMemory.upsert(record));
    this.loaded = true;
  }

  async list() {
    await this.load();
    return this.vectorMemory.list();
  }

  async remember(record: MemoryRecord) {
    await this.load();
    const saved = this.vectorMemory.upsert(record);
    await this.persist();
    return saved;
  }

  async rememberTask(input: {
    id: string;
    goal: string;
    status: string;
    finalAnswer?: string;
    observations?: string[];
    metadata?: Record<string, unknown>;
  }) {
    if (!this.options.taskStore) {
      return this.remember({
        id: input.id,
        kind: 'task',
        text: input.finalAnswer || input.goal,
        metadata: input.metadata,
        createdAt: Date.now(),
      });
    }
    return this.remember(this.options.taskStore.toTaskRecord(input));
  }

  async search(query: string, options: MemorySearchOptions = {}) {
    await this.load();
    return this.vectorMemory.search(query, options);
  }

  private async persist() {
    if (!this.options.taskStore) {
      return;
    }
    await this.options.taskStore.save(this.vectorMemory.list());
  }
}
