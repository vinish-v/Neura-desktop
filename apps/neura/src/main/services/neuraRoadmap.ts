/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  RoadmapEvidence,
  RoadmapProgress,
  RoadmapTask,
  RoadmapTaskStatus,
} from '@main/store/types';

const ROADMAP_ID = 'neura-manus-style-upgrade';
const ROADMAP_VERSION = 1;

type RoadmapTaskDefinition = {
  id: string;
  title: string;
  doneWhen: string;
};

type RoadmapPhaseDefinition = {
  id: string;
  title: string;
  summary: string;
  tasks: RoadmapTaskDefinition[];
};

const PHASE_DEFINITIONS: RoadmapPhaseDefinition[] = [
  {
    id: 'P1',
    title: 'Stabilize Core Task Flow',
    summary:
      'Make task runs isolated, final answers readable, diagnostics hidden, and regression tests reliable.',
    tasks: [
      {
        id: 'P1.1',
        title: 'Verify task isolation',
        doneWhen:
          'New task does not overwrite previous task history, messages, runtime, or final answer.',
      },
      {
        id: 'P1.2',
        title: 'Fix final answer rendering',
        doneWhen:
          'Long answers render as normal assistant messages and are scrollable.',
      },
      {
        id: 'P1.3',
        title: 'Hide diagnostics by default',
        doneWhen:
          'Stack traces, DOM retry text, validator text, and planner internals are collapsed.',
      },
      {
        id: 'P1.4',
        title: 'Add regression tests',
        doneWhen: 'Task isolation and final-answer UI tests pass.',
      },
    ],
  },
  {
    id: 'P2',
    title: 'Browser Research Upgrade',
    summary:
      'Separate quick browsing from multi-source research and validate source-backed answers.',
    tasks: [
      {
        id: 'P2.1',
        title: 'Split quick browser vs research routing',
        doneWhen:
          'YouTube/open-site uses quick path; latest/news/current/price/top tasks use research path.',
      },
      {
        id: 'P2.2',
        title: 'Strengthen source selection',
        doneWhen: 'Research visits 2-4 deduped credible source pages.',
      },
      {
        id: 'P2.3',
        title: 'Improve extraction',
        doneWhen:
          'Each source captures title, URL, source name, date if visible, excerpt, and readable body.',
      },
      {
        id: 'P2.4',
        title: 'Add answer validation',
        doneWhen: 'Shallow visible-results answers are rejected.',
      },
      {
        id: 'P2.5',
        title: 'Add research tests',
        doneWhen: 'Research runner tests prove multi-source synthesis.',
      },
    ],
  },
  {
    id: 'P3',
    title: 'Local Computer Polish',
    summary:
      'Keep deterministic native tools strong and reserve GUI automation for visible app work.',
    tasks: [
      {
        id: 'P3.1',
        title: 'Fix Desktop path reporting',
        doneWhen: 'Output clearly says local Desktop or OneDrive Desktop.',
      },
      {
        id: 'P3.2',
        title: 'Improve file/folder final answers',
        doneWhen: 'Local actions return concise, useful paths and outcomes.',
      },
      {
        id: 'P3.3',
        title: 'Keep GUI only for visible apps',
        doneWhen:
          'File/folder/shell tasks use native tools, not desktop vision.',
      },
      {
        id: 'P3.4',
        title: 'Add native tool tests',
        doneWhen: 'Shell, folder, file, and Desktop path tests pass.',
      },
    ],
  },
  {
    id: 'P4',
    title: 'Workspace And Artifacts',
    summary:
      'Let users inspect generated files and task artifacts without leaving Neura.',
    tasks: [
      {
        id: 'P4.1',
        title: 'Add artifact viewer',
        doneWhen:
          'Markdown/code/PDF/image artifacts can be opened inside Neura.',
      },
      {
        id: 'P4.2',
        title: 'Add workspace explorer',
        doneWhen: 'User can browse task artifacts and generated files.',
      },
      {
        id: 'P4.3',
        title: 'Add reveal/open actions',
        doneWhen:
          'Artifacts can be opened in system apps or revealed in Explorer.',
      },
      {
        id: 'P4.4',
        title: 'Add artifact tests',
        doneWhen: 'Artifact creation and viewer metadata tests pass.',
      },
    ],
  },
  {
    id: 'P5',
    title: 'Unified Orchestrator',
    summary:
      'Move browser, terminal, native tools, and desktop GUI behind one plan-act-observe-finish contract.',
    tasks: [
      {
        id: 'P5.1',
        title: 'Define orchestration contract',
        doneWhen:
          'Browser, terminal, native tools, desktop GUI share one plan-act-observe-finish interface.',
      },
      {
        id: 'P5.2',
        title: 'Move quick browser behind contract',
        doneWhen: 'Existing YouTube/open-site behavior still passes.',
      },
      {
        id: 'P5.3',
        title: 'Move research behind contract',
        doneWhen: 'Source-backed research still passes.',
      },
      {
        id: 'P5.4',
        title: 'Move shell/native tools behind contract',
        doneWhen: 'Shell and local file tasks still pass.',
      },
      {
        id: 'P5.5',
        title: 'Remove obsolete paths safely',
        doneWhen: 'Old paths deleted only after equivalent tests pass.',
      },
    ],
  },
  {
    id: 'P6',
    title: 'Advanced Manus-Like Capabilities',
    summary:
      'Add durable memory, approval gates, optional scraper evaluation, and sandbox planning after V1 is stable.',
    tasks: [
      {
        id: 'P6.1',
        title: 'File-system memory',
        doneWhen: 'Each task/project has persistent working context.',
      },
      {
        id: 'P6.2',
        title: 'Episodic retrieval',
        doneWhen: 'Past useful task records can inform new runs.',
      },
      {
        id: 'P6.3',
        title: 'Approval gates',
        doneWhen: 'Sensitive actions show clean approve/deny controls.',
      },
      {
        id: 'P6.4',
        title: 'Optional scraper backend evaluation',
        doneWhen:
          'Obscura is tested behind SourceExtractor, not added blindly.',
      },
      {
        id: 'P6.5',
        title: 'Sandbox/VM investigation',
        doneWhen:
          'VM/RDP/microVM plan exists after local Standard Mode is stable.',
      },
    ],
  },
];

const cloneEvidence = (evidence: RoadmapEvidence): RoadmapEvidence => ({
  ...evidence,
});

const createTask = (task: RoadmapTaskDefinition, now: number): RoadmapTask => ({
  ...task,
  status: 'not_started',
  evidence: [],
  updatedAt: now,
});

export const createDefaultNeuraRoadmap = (
  now = Date.now(),
): RoadmapProgress => ({
  id: ROADMAP_ID,
  title: 'Neura Manus-Style Upgrade',
  version: ROADMAP_VERSION,
  phases: PHASE_DEFINITIONS.map((phase) => ({
    ...phase,
    tasks: phase.tasks.map((task) => createTask(task, now)),
  })),
  updatedAt: now,
});

const knownTaskIds = new Set(
  PHASE_DEFINITIONS.flatMap((phase) => phase.tasks.map((task) => task.id)),
);

export const normalizeNeuraRoadmap = (
  progress: RoadmapProgress | undefined,
  now = Date.now(),
): RoadmapProgress => {
  const defaultProgress = createDefaultNeuraRoadmap(now);
  if (!progress || progress.id !== ROADMAP_ID) {
    return defaultProgress;
  }

  const existingTasks = new Map<string, RoadmapTask>();
  for (const phase of progress.phases || []) {
    for (const task of phase.tasks || []) {
      if (knownTaskIds.has(task.id)) {
        existingTasks.set(task.id, task);
      }
    }
  }

  return {
    ...defaultProgress,
    phases: defaultProgress.phases.map((phase) => ({
      ...phase,
      tasks: phase.tasks.map((task) => {
        const existing = existingTasks.get(task.id);
        if (!existing) {
          return task;
        }
        return {
          ...task,
          status: existing.status,
          evidence: (existing.evidence || []).map(cloneEvidence),
          updatedAt: existing.updatedAt || task.updatedAt,
          blockedReason: existing.blockedReason,
        };
      }),
    })),
    updatedAt: progress.updatedAt || now,
  };
};

export const updateRoadmapTaskStatus = (
  progress: RoadmapProgress,
  taskId: string,
  status: RoadmapTaskStatus,
  evidence?: RoadmapEvidence,
  now = Date.now(),
): RoadmapProgress => {
  let found = false;
  const next = normalizeNeuraRoadmap(progress, now);
  const phases = next.phases.map((phase) => ({
    ...phase,
    tasks: phase.tasks.map((task) => {
      if (task.id !== taskId) {
        return task;
      }
      found = true;
      return {
        ...task,
        status,
        evidence: evidence ? [...task.evidence, evidence] : task.evidence,
        updatedAt: now,
        blockedReason: status === 'blocked' ? task.blockedReason : undefined,
      };
    }),
  }));

  if (!found) {
    throw new Error(`Unknown roadmap task id: ${taskId}`);
  }

  return {
    ...next,
    phases,
    updatedAt: now,
  };
};

export const summarizeRoadmapProgress = (progress: RoadmapProgress) => {
  const tasks = progress.phases.flatMap((phase) => phase.tasks);
  return {
    total: tasks.length,
    done: tasks.filter((task) => task.status === 'done').length,
    inProgress: tasks.filter((task) => task.status === 'in_progress').length,
    blocked: tasks.filter((task) => task.status === 'blocked').length,
    notStarted: tasks.filter((task) => task.status === 'not_started').length,
  };
};
