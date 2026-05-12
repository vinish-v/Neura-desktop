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

type RoadmapBaselineEntry = {
  status: RoadmapTaskStatus;
  evidence?: Array<
    Omit<RoadmapEvidence, 'recordedAt'> & {
      recordedAt?: number;
    }
  >;
  blockedReason?: string;
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

const STABILIZED_V1_BASELINE: Record<string, RoadmapBaselineEntry> = {
  'P1.1': {
    status: 'done',
    evidence: [
      {
        id: 'baseline-p1-1-task-isolation',
        kind: 'test',
        summary:
          'Sequential new tasks keep separate history, state, and final answers.',
        command:
          'npm test -- --run src/main/services/taskRunRegistry.test.ts',
        artifactPath: 'apps/neura/src/main/services/taskRunRegistry.test.ts',
      },
    ],
  },
  'P1.2': {
    status: 'done',
    evidence: [
      {
        id: 'baseline-p1-2-final-answer-ui',
        kind: 'manual',
        summary:
          'Final answers are rendered in assistant transcript with scrollable content.',
        artifactPath:
          'apps/neura/src/renderer/src/components/RunMessages/TaskRunPanel.tsx',
      },
    ],
  },
  'P1.3': {
    status: 'done',
    evidence: [
      {
        id: 'baseline-p1-3-diagnostics-collapsed',
        kind: 'manual',
        summary:
          'Diagnostics are collapsed by default and not shown as primary output.',
        artifactPath:
          'apps/neura/src/renderer/src/components/RunMessages/TaskRunPanel.tsx',
      },
    ],
  },
  'P1.4': {
    status: 'done',
    evidence: [
      {
        id: 'baseline-p1-4-regression-tests',
        kind: 'test',
        summary: 'Core phase-1 regression tests are present and passing.',
        command:
          'npm test -- --run src/main/services/taskRunRegistry.test.ts src/main/services/neuraRoadmap.test.ts',
      },
    ],
  },
  'P2.1': {
    status: 'done',
    evidence: [
      {
        id: 'baseline-p2-1-routing-split',
        kind: 'test',
        summary:
          'Quick browser and research browser routing are covered by tests.',
        command:
          'npm test -- --run src/main/services/embeddedBrowserResearchTask.test.ts',
      },
    ],
  },
  'P2.2': {
    status: 'done',
    evidence: [
      {
        id: 'baseline-p2-2-source-dedupe',
        kind: 'test',
        summary:
          'Research candidate ranking dedupes by domain and filters low-quality links.',
        artifactPath:
          'apps/neura/src/main/services/embeddedBrowserResearchTask.test.ts',
      },
    ],
  },
  'P2.3': {
    status: 'done',
    evidence: [
      {
        id: 'baseline-p2-3-source-extraction',
        kind: 'test',
        summary:
          'Source extraction captures title, URL, date, excerpt, and readable body.',
        artifactPath:
          'apps/neura/src/main/services/embeddedBrowserResearchTask.test.ts',
      },
    ],
  },
  'P2.4': {
    status: 'done',
    evidence: [
      {
        id: 'baseline-p2-4-answer-validation',
        kind: 'test',
        summary:
          'Research answer validation rejects shallow visible-results summaries.',
        artifactPath:
          'apps/neura/src/main/services/embeddedBrowserResearchTask.test.ts',
      },
    ],
  },
  'P2.5': {
    status: 'done',
    evidence: [
      {
        id: 'baseline-p2-5-research-tests',
        kind: 'test',
        summary: 'Research runner behavior is covered with source-quality tests.',
        command:
          'npm test -- --run src/main/services/embeddedBrowserResearchTask.test.ts',
      },
    ],
  },
  'P3.1': {
    status: 'done',
    evidence: [
      {
        id: 'baseline-p3-1-desktop-path',
        kind: 'test',
        summary:
          'Desktop path reporting distinguishes OneDrive Desktop from local Desktop.',
        command:
          'npm test -- --run src/main/services/nativeComputerTools.test.ts',
      },
    ],
  },
  'P3.2': {
    status: 'done',
    evidence: [
      {
        id: 'baseline-p3-2-file-folder-answer',
        kind: 'test',
        summary:
          'File and folder operations return concise outcome messages with exact paths.',
        artifactPath:
          'apps/neura/src/main/services/nativeComputerTools.test.ts',
      },
    ],
  },
  'P3.3': {
    status: 'done',
    evidence: [
      {
        id: 'baseline-p3-3-gui-only-visible-apps',
        kind: 'manual',
        summary:
          'Native deterministic local operations bypass GUI desktop automation paths.',
        artifactPath:
          'apps/neura/src/main/services/localComputerActorRunner.ts',
      },
    ],
  },
  'P3.4': {
    status: 'done',
    evidence: [
      {
        id: 'baseline-p3-4-native-tool-tests',
        kind: 'test',
        summary: 'Native shell, file, and folder tools have direct tests.',
        command:
          'npm test -- --run src/main/services/nativeComputerTools.test.ts',
      },
    ],
  },
  'P4.1': {
    status: 'done',
    evidence: [
      {
        id: 'baseline-p4-1-artifact-viewer',
        kind: 'manual',
        summary:
          'Task run panel renders artifact previews for markdown, code, PDF, image, and other supported files.',
        artifactPath:
          'apps/neura/src/renderer/src/components/RunMessages/TaskRunPanel.tsx',
      },
    ],
  },
  'P4.2': {
    status: 'done',
    evidence: [
      {
        id: 'baseline-p4-2-workspace-explorer',
        kind: 'manual',
        summary:
          'Workspace explorer lists generated files and task artifacts from the active run.',
        artifactPath:
          'apps/neura/src/renderer/src/components/RunMessages/TaskRunPanel.tsx',
      },
    ],
  },
  'P4.3': {
    status: 'done',
    evidence: [
      {
        id: 'baseline-p4-3-open-reveal',
        kind: 'manual',
        summary:
          'Artifacts support open and reveal actions through window IPC routes.',
        artifactPath: 'apps/neura/src/main/ipcRoutes/window.ts',
      },
    ],
  },
  'P4.4': {
    status: 'done',
    evidence: [
      {
        id: 'baseline-p4-4-artifact-tests',
        kind: 'test',
        summary:
          'Artifact preview and workspace listing metadata are covered by IPC route tests.',
        command:
          'npm test -- --run src/main/ipcRoutes/window.test.ts',
      },
    ],
  },
  'P5.1': {
    status: 'done',
    evidence: [
      {
        id: 'baseline-p5-1-orchestrator-contract',
        kind: 'manual',
        summary:
          'AgentOrchestrator provides the shared plan-act-observe-finish contract used by browser, local workflow, and local computer runners.',
        artifactPath: 'apps/neura/src/main/services/agentOrchestrator.ts',
      },
    ],
  },
  'P5.2': {
    status: 'done',
    evidence: [
      {
        id: 'baseline-p5-2-quick-browser-orchestrated',
        kind: 'manual',
        summary:
          'Quick embedded browser tasks execute through AgentOrchestrator.',
        artifactPath:
          'apps/neura/src/main/services/quickEmbeddedBrowserTask.ts',
      },
    ],
  },
  'P5.3': {
    status: 'done',
    evidence: [
      {
        id: 'baseline-p5-3-research-orchestrated',
        kind: 'manual',
        summary:
          'Embedded browser research tasks execute through AgentOrchestrator.',
        artifactPath:
          'apps/neura/src/main/services/embeddedBrowserResearchTask.ts',
      },
    ],
  },
  'P5.4': {
    status: 'done',
    evidence: [
      {
        id: 'baseline-p5-4-local-orchestrated',
        kind: 'manual',
        summary:
          'Shell, local workflow, and desktop-computer tasks share the same orchestrator lifecycle.',
        artifactPath:
          'apps/neura/src/main/services/localComputerActorRunner.ts',
      },
    ],
  },
  'P5.5': {
    status: 'done',
    evidence: [
      {
        id: 'baseline-p5-5-obsolete-paths-contained',
        kind: 'manual',
        summary:
          'Runtime routing now prefers orchestrated quick/research/local paths instead of competing browser fallbacks.',
        artifactPath: 'apps/neura/src/main/services/runAgent.ts',
      },
    ],
  },
  'P6.1': {
    status: 'done',
    evidence: [
      {
        id: 'baseline-p6-1-file-system-memory',
        kind: 'test',
        summary:
          'Each task run persists a workspace context file under task-workspaces.',
        command:
          'npm test -- --run src/main/services/taskContextMemory.test.ts',
      },
    ],
  },
  'P6.2': {
    status: 'done',
    evidence: [
      {
        id: 'baseline-p6-2-episodic-retrieval',
        kind: 'test',
        summary:
          'Relevant completed runs are retrieved and exposed as context hints for new browser research tasks.',
        command:
          'npm test -- --run src/main/services/taskContextMemory.test.ts src/main/services/embeddedBrowserResearchTask.test.ts',
      },
    ],
  },
  'P6.3': {
    status: 'done',
    evidence: [
      {
        id: 'baseline-p6-3-approval-gates',
        kind: 'manual',
        summary:
          'Sensitive actions surface clean approve and deny controls in the task run panel.',
        artifactPath:
          'apps/neura/src/renderer/src/components/RunMessages/TaskRunPanel.tsx',
      },
    ],
  },
  'P6.4': {
    status: 'done',
    evidence: [
      {
        id: 'baseline-p6-4-extractor-evaluation',
        kind: 'manual',
        summary:
          'Optional scraper backend remains behind SourceExtractor and is documented without enabling a blind runtime dependency.',
        artifactPath: 'docs/neura-source-extractor-evaluation.md',
      },
    ],
  },
  'P6.5': {
    status: 'done',
    evidence: [
      {
        id: 'baseline-p6-5-sandbox-investigation',
        kind: 'manual',
        summary:
          'Sandbox, VM, and microVM direction is documented for the post-stabilization phase.',
        artifactPath: 'docs/neura-sandbox-vm-investigation.md',
      },
    ],
  },
};

const applyBaseline = (
  progress: RoadmapProgress,
  baseline: Record<string, RoadmapBaselineEntry>,
  now: number,
): RoadmapProgress => ({
  ...progress,
  phases: progress.phases.map((phase) => ({
    ...phase,
    tasks: phase.tasks.map((task) => {
      const entry = baseline[task.id];
      if (!entry) {
        return task;
      }
      return {
        ...task,
        status: entry.status,
        blockedReason: entry.blockedReason,
        updatedAt: now,
        evidence: (entry.evidence || []).map((item) => ({
          ...item,
          recordedAt: item.recordedAt || now,
        })),
      };
    }),
  })),
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

export const createStabilizedV1Roadmap = (now = Date.now()) =>
  applyBaseline(createDefaultNeuraRoadmap(now), STABILIZED_V1_BASELINE, now);

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
