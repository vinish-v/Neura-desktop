/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';

import {
  createDefaultNeuraRoadmap,
  normalizeNeuraRoadmap,
  summarizeRoadmapProgress,
  updateRoadmapTaskStatus,
} from './neuraRoadmap';

describe('neuraRoadmap', () => {
  it('creates the phased Manus-style upgrade roadmap', () => {
    const roadmap = createDefaultNeuraRoadmap(1_000);

    expect(roadmap.title).toBe('Neura Manus-Style Upgrade');
    expect(roadmap.phases).toHaveLength(6);
    expect(roadmap.phases[0].tasks.map((task) => task.id)).toEqual([
      'P1.1',
      'P1.2',
      'P1.3',
      'P1.4',
    ]);
    expect(roadmap.phases.flatMap((phase) => phase.tasks)).toHaveLength(27);
    expect(
      roadmap.phases
        .flatMap((phase) => phase.tasks)
        .every((task) => task.status === 'not_started'),
    ).toBe(true);
  });

  it('normalizes old stored progress while preserving known task status and evidence', () => {
    const roadmap = createDefaultNeuraRoadmap(1_000);
    const updated = updateRoadmapTaskStatus(
      roadmap,
      'P2.1',
      'done',
      {
        id: 'evidence-1',
        kind: 'test',
        summary: 'browser routing test',
        command: 'npm test -- --run browser-routing.test.ts',
        recordedAt: 1_100,
      },
      1_100,
    );

    const normalized = normalizeNeuraRoadmap(
      {
        ...updated,
        phases: [
          {
            id: 'legacy',
            title: 'Legacy',
            summary: 'removed phase',
            tasks: [
              updated.phases[1].tasks[0],
              {
                id: 'unknown',
                title: 'Unknown',
                doneWhen: 'Should be removed',
                status: 'done',
                evidence: [],
                updatedAt: 1_100,
              },
            ],
          },
        ],
      },
      2_000,
    );

    const task = normalized.phases
      .flatMap((phase) => phase.tasks)
      .find((candidate) => candidate.id === 'P2.1');

    expect(normalized.phases).toHaveLength(6);
    expect(task?.status).toBe('done');
    expect(task?.evidence).toHaveLength(1);
    expect(
      normalized.phases
        .flatMap((phase) => phase.tasks)
        .some((candidate) => candidate.id === 'unknown'),
    ).toBe(false);
  });

  it('updates task status and summarizes counts', () => {
    const roadmap = createDefaultNeuraRoadmap(1_000);
    const next = updateRoadmapTaskStatus(roadmap, 'P1.1', 'in_progress');
    const summary = summarizeRoadmapProgress(next);

    expect(summary.total).toBe(27);
    expect(summary.inProgress).toBe(1);
    expect(summary.done).toBe(0);
    expect(summary.blocked).toBe(0);
    expect(summary.notStarted).toBe(26);
  });

  it('rejects unknown task ids', () => {
    const roadmap = createDefaultNeuraRoadmap(1_000);

    expect(() => updateRoadmapTaskStatus(roadmap, 'P9.9', 'done')).toThrowError(
      'Unknown roadmap task id: P9.9',
    );
  });
});
