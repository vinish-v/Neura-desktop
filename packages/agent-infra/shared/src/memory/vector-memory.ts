/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  MemoryRecord,
  MemoryRecordKind,
  MemorySearchOptions,
  MemorySearchResult,
} from './types';

const tokenize = (value: string) =>
  value
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);

const toVector = (value: string) => {
  const vector = new Map<string, number>();
  for (const token of tokenize(value)) {
    vector.set(token, (vector.get(token) || 0) + 1);
  }
  return vector;
};

const cosineSimilarity = (
  left: Map<string, number>,
  right: Map<string, number>,
) => {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (const value of left.values()) {
    leftMagnitude += value * value;
  }
  for (const value of right.values()) {
    rightMagnitude += value * value;
  }
  for (const [token, leftValue] of left) {
    dot += leftValue * (right.get(token) || 0);
  }

  if (!leftMagnitude || !rightMagnitude) {
    return 0;
  }
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
};

export class LocalVectorMemory {
  private records = new Map<string, MemoryRecord>();

  constructor(records: MemoryRecord[] = []) {
    records.forEach((record) => this.records.set(record.id, record));
  }

  list(kind?: MemoryRecordKind) {
    const records = [...this.records.values()];
    return kind ? records.filter((record) => record.kind === kind) : records;
  }

  upsert(record: MemoryRecord) {
    const existing = this.records.get(record.id);
    const nextRecord: MemoryRecord = {
      ...record,
      createdAt: existing?.createdAt || record.createdAt || Date.now(),
      updatedAt: existing ? Date.now() : record.updatedAt,
    };
    this.records.set(nextRecord.id, nextRecord);
    return nextRecord;
  }

  delete(id: string) {
    return this.records.delete(id);
  }

  search(
    query: string,
    options: MemorySearchOptions = {},
  ): MemorySearchResult[] {
    const queryVector = toVector(query);
    if (!queryVector.size) {
      return [];
    }

    const limit = options.limit ?? 5;
    const minScore = options.minScore ?? 0.08;
    return this.list(options.kind)
      .map((record) => ({
        ...record,
        score: cosineSimilarity(queryVector, toVector(record.text)),
      }))
      .filter((record) => record.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
