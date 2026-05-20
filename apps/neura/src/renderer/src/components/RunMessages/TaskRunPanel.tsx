/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  AlertCircle,
  CheckCircle2,
  CircleHelp,
  ExternalLink,
  FileCode2,
  FileImage,
  FileSearch,
  FileText,
  FolderOpen,
  Loader2,
  MonitorPlay,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  Wand2,
} from 'lucide-react';
import { useState, useEffect } from 'react';

import { TaskSourceRecord, TaskState } from '@main/store/types';
import type { TaskEvidence } from '@shared/taskEvidence';
import { cn } from '@renderer/utils';
import { api } from '@renderer/api';
import { Markdown } from '@renderer/components/markdown';
import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';

type ArtifactPreviewState = {
  title: string;
  path: string;
  kind: 'text' | 'binary' | 'unsupported';
  text?: string;
  dataUrl?: string;
  mimeType?: string;
  reason?: string;
};

type WorkspaceEntry = {
  path: string;
  name: string;
  type: 'file' | 'directory';
  sizeBytes: number;
  modifiedAt: number;
};

type WorkspaceRoot = {
  rootPath: string;
  entries: WorkspaceEntry[];
};

class SoundEffects {
  private static ctx: AudioContext | null = null;

  private static getContext(): AudioContext | null {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  static playClick() {
    try {
      const ctx = this.getContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.exponentialRampToValueAtTime(100, now + 0.05);

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.05);
    } catch (e) {
      console.warn('Web Audio synthesis failed:', e);
    }
  }

  static playChime() {
    try {
      const ctx = this.getContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, idx) => {
        const time = now + idx * 0.12;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, time);

        gain.gain.setValueAtTime(0.0, time);
        gain.gain.linearRampToValueAtTime(0.12, time + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.6);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(time);
        osc.stop(time + 0.61);
      });
    } catch (e) {
      console.warn('Web Audio chime synthesis failed:', e);
    }
  }
}

function VisualFlowchart({ taskState, validationFailures }: { taskState: TaskState; validationFailures: any[] }) {
  const status = taskState.status;
  
  const getStageStatus = (stage: 'intent' | 'created' | 'execution' | 'validation') => {
    if (stage === 'intent') return 'completed';
    if (stage === 'created') return 'completed';
    
    if (stage === 'execution') {
      if (status === 'completed') return 'completed';
      if (status === 'failed' || status === 'cancelled') return 'failed';
      if (status === 'running') return 'active';
      return 'pending';
    }
    
    if (stage === 'validation') {
      if (status === 'completed') return 'completed';
      if (validationFailures.length > 0 || status === 'failed') return 'failed';
      if (status === 'running' && taskState.phase === 'validating') return 'active';
      return 'pending';
    }
    return 'pending';
  };

  const stages = [
    { id: 'intent', label: 'Intent Arbitration', desc: 'Arbitrating input' },
    { id: 'created', label: 'Task Created', desc: 'Context initialized' },
    { id: 'execution', label: 'Autopilot Executing', desc: 'Running workspace steps' },
    { id: 'validation', label: 'Artifact Validation', desc: 'QA & proof verification' },
  ];

  return (
    <div className="mb-6 rounded-2xl border border-white/[0.06] bg-white/[0.01] p-4 text-xs">
      <style>{`
        @keyframes flowDash {
          to {
            stroke-dashoffset: -20;
          }
        }
        @keyframes pulseGlow {
          0%, 100% {
            transform: scale(1);
            opacity: 0.15;
          }
          50% {
            transform: scale(1.35);
            opacity: 0.5;
          }
        }
        .flow-line-active {
          stroke-dasharray: 6, 4;
          animation: flowDash 0.8s linear infinite;
        }
        .pulse-ring {
          animation: pulseGlow 1.8s ease-in-out infinite;
        }
      `}</style>

      <div className="mb-3 text-[11px] font-medium uppercase tracking-wider text-white/35">
        Execution Pipeline
      </div>

      <div className="grid grid-cols-4 gap-4 relative">
        {stages.map((stage, idx) => {
          const s = getStageStatus(stage.id as any);
          const isLast = idx === stages.length - 1;
          
          let colorClass = 'border-white/10 text-muted-foreground bg-white/[0.02]';
          
          if (s === 'completed') {
            colorClass = 'border-emerald-500/30 bg-emerald-500/[0.04] text-emerald-100 shadow-[0_0_12px_rgba(16,185,129,0.08)]';
          } else if (s === 'active') {
            colorClass = 'border-blue-500/40 bg-blue-500/[0.04] text-blue-100 shadow-[0_0_15px_rgba(59,130,246,0.12)]';
          } else if (s === 'failed') {
            colorClass = 'border-red-500/30 bg-red-500/[0.04] text-red-100 shadow-[0_0_12px_rgba(239,68,68,0.08)]';
          }

          return (
            <div key={stage.id} className="flex flex-col items-center text-center relative z-10">
              <div className="relative flex items-center justify-center h-10 w-10 mb-2">
                {s === 'active' && (
                  <div className="absolute inset-0 rounded-full bg-blue-500/20 pulse-ring" />
                )}
                <div className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-full border transition-all duration-300',
                  colorClass
                )}>
                  {stage.id === 'intent' && <span className="font-semibold text-[10px]">INT</span>}
                  {stage.id === 'created' && <span className="font-semibold text-[10px]">NEW</span>}
                  {stage.id === 'execution' && <span className="font-semibold text-[10px]">EXE</span>}
                  {stage.id === 'validation' && <span className="font-semibold text-[10px]">VAL</span>}
                </div>
              </div>

              <div className="font-medium text-white/80 text-[11px] truncate w-full px-1" title={stage.label}>
                {stage.label}
              </div>
              <div className="text-[10px] text-white/40 mt-0.5 truncate w-full px-1">
                {stage.desc}
              </div>

              {!isLast && (
                <div className="absolute left-[calc(50%+20px)] top-[20px] w-[calc(100%-40px)] h-[2px] z-0 hidden md:block">
                  <svg className="w-full h-2 overflow-visible">
                    <line
                      x1="0"
                      y1="1"
                      x2="100%"
                      y2="1"
                      stroke={s === 'completed' ? '#10b981' : s === 'active' ? '#3b82f6' : '#2a2a2a'}
                      strokeWidth="2"
                      className={cn(
                        s === 'active' ? 'flow-line-active' : ''
                      )}
                    />
                  </svg>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const statusIcon = {
  pending: Loader2,
  running: Loader2,
  completed: CheckCircle2,
  failed: AlertCircle,
  cancelled: AlertCircle,
};

const DEBUG_PROGRESS_PATTERN =
  /\b(regex|pattern|validator|validated \d+ local computer actor|command output contains|planner checklist|planner step|raw|screenshot observed|predictionParsed|FullyQualifiedErrorId|CategoryInfo)\b|previous response was not executable|authorized benign UI automation|Action Space|previous action had invalid coordinates|browser state has not changed after repeated actions|previous browser DOM action could not be executed|continue autonomously: take a fresh screenshot\/DOM map|do not finish with this recovery message|element id was stale|take a fresh screenshot\/DOM map|Could not (?:type into|click) that DOM element|Refresh the DOM map or use coordinate click\/type|reply with finished\(content=|visible current DOM element|<(html|xml|rdf|!doctype)|xmlns=|rdf:resource=/i;

const publicFinalAnswer = (answer?: string) => {
  const cleaned = (answer || '').trim();
  return cleaned && !DEBUG_PROGRESS_PATTERN.test(cleaned) ? cleaned : '';
};

type RecoveryMetadata = {
  kind?: string;
  status?: string;
  nextAction?: string;
  userFacingMessage?: string;
  attemptedAction?: string;
  attemptedUrl?: string;
  steps?: string[];
};

type RecoveryEvidenceItem = {
  evidence: TaskEvidence;
  recovery: RecoveryMetadata;
};

const getRecoveryMetadata = (metadata?: Record<string, unknown>) => {
  const recovery = metadata?.recovery;
  if (!recovery || typeof recovery !== 'object') {
    return null;
  }
  return recovery as RecoveryMetadata;
};

const recoveryLabel = (value?: string) =>
  (value || 'unknown').replace(/_/g, ' ');

const artifactRefinementInstruction = (
  kind: string,
  path: string,
  originalGoal: string,
  action: 'refine' | 'reuse' | 'qa' | 'polish' = 'refine',
) => {
  if (action === 'reuse') {
    return [
      'Reuse this existing media artifact as source material for the next iteration. Inspect the file first, preserve attribution/path context, and only create a new real output when a configured local/provider tool can do it.',
      `Artifact path: ${path}`,
      `Original task: ${originalGoal}`,
      'Validate file existence, nonzero size, readable preview, and expected media format before saying it is complete.',
    ].join('\n');
  }
  if (action === 'qa') {
    return [
      'Run website QA on this generated artifact: inspect layout, responsiveness, accessibility, console/build errors, linked media reuse, and export a validated website project/archive only after checks pass.',
      `Artifact path: ${path}`,
      `Original task: ${originalGoal}`,
      'Validate file existence, nonzero size, readable preview, and expected format before saying it is complete.',
    ].join('\n');
  }
  if (action === 'polish') {
    return [
      'Polish this slide artifact with a stronger narrative, slide hierarchy, speaker notes, citations, visual consistency, and export a validated PPTX.',
      `Artifact path: ${path}`,
      `Original task: ${originalGoal}`,
      'Validate file existence, nonzero size, readable preview, and expected format before saying it is complete.',
    ].join('\n');
  }
  const templates: Record<string, string> = {
    presentation:
      'Polish the deck narrative, slide hierarchy, speaker notes, citations, visual consistency, and export a validated PPTX.',
    spreadsheet:
      'Clean the workbook structure, headers, formulas, number formats, filters, summary sheet, and export a validated XLSX/CSV.',
    website:
      'Run website QA for layout, responsiveness, accessibility, console errors, build output, media reuse, and export a validated project/archive.',
    report:
      'Edit the report for source-backed claims, structure, citations, clarity, and export a validated DOCX/PDF/Markdown file.',
    document:
      'Edit the document for structure, proof, citations, readability, and export a validated DOCX/PDF.',
    image:
      'Reuse the media asset honestly, verify the file is readable, and create a real improved image artifact only if a configured provider/tool is available.',
  };
  return [
    templates[kind] ||
      'Inspect and improve this artifact, then save a real validated output file.',
    `Artifact path: ${path}`,
    `Original task: ${originalGoal}`,
    'Validate file existence, nonzero size, readable preview, and expected format before saying it is complete.',
  ].join('\n');
};

const artifactPrimaryAction = (kind: string) => {
  if (kind === 'presentation') {
    return { key: 'polish' as const, label: 'Polish' };
  }
  if (kind === 'website') {
    return { key: 'qa' as const, label: 'QA' };
  }
  if (kind === 'image' || kind === 'audio' || kind === 'video') {
    return { key: 'reuse' as const, label: 'Reuse' };
  }
  return { key: 'refine' as const, label: 'Refine' };
};

export function TaskRunPanel({ taskState }: { taskState: TaskState | null }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, string>>(
    {},
  );
  const [previewLoading, setPreviewLoading] = useState(false);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [previewState, setPreviewState] = useState<ArtifactPreviewState | null>(
    null,
  );
  const [workspaceState, setWorkspaceState] = useState<WorkspaceRoot[]>([]);

  const currentStatus = taskState?.status;
  const currentPhase = taskState?.phase;
  const currentTodoCount = (taskState?.todoItems || []).filter((t) => t.status === 'done').length;

  useEffect(() => {
    if (!taskState) return;
    if (taskState.status === 'running') {
      SoundEffects.playClick();
    }
  }, [currentStatus, currentPhase, currentTodoCount]);

  useEffect(() => {
    if (taskState?.status === 'completed') {
      SoundEffects.playChime();
    }
  }, [currentStatus]);

  const finalAnswer = publicFinalAnswer(taskState?.finalAnswer);
  const artifacts = (taskState?.artifacts || []).slice(-6);
  const todoItems = taskState?.todoItems || [];
  const validationFailures = taskState?.validationFailures || [];
  const approvalEvents = taskState?.approvalEvents || [];
  const userQuestionEvents = taskState?.userQuestionEvents || [];
  const sourcesVisited = taskState?.sourcesVisited || [];
  const rawSourceRecords = taskState?.sourceRecords || [];
  const wideResearchWorkers = taskState?.wideResearchWorkers || [];
  const completionProof = taskState?.completionProof;
  const evidenceValidation = taskState?.evidenceValidation;
  const browserActionAudit = taskState?.browserActionAudit || [];
  const latestBrowserAction =
    browserActionAudit[browserActionAudit.length - 1] || null;
  const recoveryEvidence: RecoveryEvidenceItem[] = (taskState?.evidence || [])
    .map((item) => ({
      evidence: item,
      recovery: getRecoveryMetadata(item.metadata),
    }))
    .filter((item): item is RecoveryEvidenceItem => Boolean(item.recovery))
    .slice(-3);

  if (!taskState) {
    return null;
  }

  const sourceRecords: TaskSourceRecord[] =
    rawSourceRecords.length > 0
      ? rawSourceRecords
      : sourcesVisited.map((url, index) => ({
          id: `${taskState.runId}-source-${index}`,
          url,
          capturedAt: taskState.startedAt,
        }));

  const previewArtifact = async (artifact: (typeof artifacts)[number]) => {
    setPreviewLoading(true);
    setPreviewOpen(true);
    try {
      const preview = await api.readArtifactPreview({ path: artifact.path });
      if (preview.kind === 'text') {
        setPreviewState({
          title: artifact.title,
          path: artifact.path,
          kind: 'text',
          text: preview.text,
          mimeType: preview.mimeType,
        });
        return;
      }
      if (preview.kind === 'binary') {
        setPreviewState({
          title: artifact.title,
          path: artifact.path,
          kind: 'binary',
          dataUrl: preview.dataUrl,
          mimeType: preview.mimeType,
        });
        return;
      }
      setPreviewState({
        title: artifact.title,
        path: artifact.path,
        kind: 'unsupported',
        reason: preview.reason,
      });
    } catch (error) {
      setPreviewState({
        title: artifact.title,
        path: artifact.path,
        kind: 'unsupported',
        reason:
          error instanceof Error
            ? error.message
            : 'Unable to preview this artifact.',
      });
    } finally {
      setPreviewLoading(false);
    }
  };

  const openWorkspaceExplorer = async () => {
    setWorkspaceOpen(true);
    setWorkspaceLoading(true);
    try {
      const roots = await api.listWorkspaceEntries({
        paths: artifacts.map((artifact) => artifact.path),
      });
      setWorkspaceState(roots);
    } catch {
      setWorkspaceState([]);
    } finally {
      setWorkspaceLoading(false);
    }
  };

  const exportSummary = async () => {
    if (!taskState) {
      return;
    }
    setActionBusy('export-summary');
    try {
      await api.exportRunSummary({ runId: taskState.runId });
    } finally {
      setActionBusy(null);
    }
  };

  const retryRun = async () => {
    if (!taskState) {
      return;
    }
    setActionBusy('retry-run');
    try {
      await api.retryRun({ runId: taskState.runId });
    } finally {
      setActionBusy(null);
    }
  };

  const resumeRun = async () => {
    if (!taskState) {
      return;
    }
    setActionBusy('resume-run');
    try {
      await api.resumeRun({ runId: taskState.runId });
    } finally {
      setActionBusy(null);
    }
  };

  const retryWideResearchWorker = async (workerId: string) => {
    if (!taskState) {
      return;
    }
    setActionBusy(`retry-worker-${workerId}`);
    try {
      await api.retryWideResearchWorker({
        runId: taskState.runId,
        workerId,
      });
    } finally {
      setActionBusy(null);
    }
  };

  const refineArtifact = async (
    artifact: (typeof artifacts)[number],
    action: 'refine' | 'reuse' | 'qa' | 'polish' = 'refine',
  ) => {
    if (!taskState) {
      return;
    }
    const prompt = artifactRefinementInstruction(
      artifact.kind,
      artifact.path,
      taskState.originalGoal,
      action,
    );
    setActionBusy(`${action}-${artifact.id}`);
    try {
      await api.setInstructions({ instructions: prompt });
      await api.runAgent();
    } finally {
      setActionBusy(null);
    }
  };

  const formatBytes = (value: number) => {
    if (value < 1024) {
      return `${value} B`;
    }
    if (value < 1024 * 1024) {
      return `${(value / 1024).toFixed(1)} KB`;
    }
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  };

  const StatusIcon = statusIcon[taskState.status] || Loader2;
  const requestedApprovals = approvalEvents.filter(
    (event) => event.status === 'requested',
  );
  const requestedQuestions = userQuestionEvents.filter(
    (event) => event.status === 'requested',
  );
  const evidenceLabel =
    evidenceValidation?.completionStatus === 'verified'
      ? 'Verified'
      : evidenceValidation?.completionStatus === 'blocked'
        ? 'Blocked'
        : 'Needs verification';
  return (
    <section className="overflow-hidden rounded-[22px] border border-white/[0.075] bg-[#070808] text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
      <div className="border-b border-white/[0.07] px-5 py-4">
        <div className="flex items-center gap-3 text-white">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.035]">
            <StatusIcon
              className={cn(
                'h-4 w-4',
                taskState.status === 'running'
                  ? 'animate-spin text-blue-300'
                  : '',
                taskState.status === 'completed' ? 'text-emerald-300' : '',
                taskState.status === 'failed' ? 'text-red-300' : '',
              )}
            />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold">Run Trace</div>
            <div className="mt-1 truncate text-xs text-white/42">
              {taskState.runMode.replace(/_/g, ' ')} /{' '}
              {taskState.phase || taskState.status}
              {taskState.activeAgent ? ` / ${taskState.activeAgent}` : ''}
            </div>
          </div>
          <span
            className={cn(
              'rounded-full border px-3 py-1 text-xs capitalize',
              taskState.status === 'running' &&
                'border-blue-300/25 bg-blue-300/10 text-blue-100',
              taskState.status === 'completed' &&
                'border-emerald-300/25 bg-emerald-300/10 text-emerald-100',
              taskState.status === 'failed' &&
                'border-red-300/25 bg-red-300/10 text-red-100',
              taskState.status === 'pending' &&
                'border-white/10 bg-white/5 text-muted-foreground',
            )}
          >
            {taskState.status}
          </span>
          {evidenceValidation && (
            <span
              className={cn(
                'rounded-full border px-3 py-1 text-xs',
                evidenceValidation.completionStatus === 'verified' &&
                  'border-emerald-300/25 bg-emerald-300/10 text-emerald-100',
                evidenceValidation.completionStatus === 'needs_verification' &&
                  'border-amber-300/25 bg-amber-300/10 text-amber-100',
                evidenceValidation.completionStatus === 'blocked' &&
                  'border-red-300/25 bg-red-300/10 text-red-100',
              )}
              title={evidenceValidation.agentFacingMessage}
            >
              {evidenceLabel}
              {evidenceValidation.completionStatus === 'verified'
                ? ` ${Math.round(evidenceValidation.confidence * 100)}%`
                : ''}
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-8 rounded-lg px-2 text-xs text-white/48 hover:bg-white/[0.05] hover:text-white"
            disabled={actionBusy === 'resume-run' || taskState.status === 'running'}
            onClick={resumeRun}
          >
            <PlayCircle className="h-3.5 w-3.5" />
            Resume
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 rounded-lg px-2 text-xs text-white/48 hover:bg-white/[0.05] hover:text-white"
            disabled={actionBusy === 'retry-run' || taskState.status === 'running'}
            onClick={retryRun}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </Button>
        </div>
      </div>
      <div className="p-5">
        <VisualFlowchart taskState={taskState} validationFailures={validationFailures} />

      {taskState.nextAction || taskState.browserRestoreSnapshot ? (
        <div className="mb-5 rounded-2xl border border-blue-300/15 bg-blue-300/[0.04] px-4 py-3 text-xs">
          {taskState.nextAction ? (
            <div className="text-blue-100">
              Next action: {taskState.nextAction}
            </div>
          ) : null}
          {taskState.browserRestoreSnapshot ? (
            <div className="mt-2 grid gap-1 text-white/44">
              <div>
                Browser: {taskState.browserRestoreSnapshot.bridgeStatus}
                {taskState.browserRestoreSnapshot.backend
                  ? ` / ${taskState.browserRestoreSnapshot.backend}`
                  : ''}
              </div>
              {taskState.browserRestoreSnapshot.url ? (
                <div className="truncate" title={taskState.browserRestoreSnapshot.url}>
                  Last URL: {taskState.browserRestoreSnapshot.url}
                </div>
              ) : null}
              {taskState.browserRestoreSnapshot.title ? (
                <div
                  className="truncate"
                  title={taskState.browserRestoreSnapshot.title}
                >
                  Page title: {taskState.browserRestoreSnapshot.title}
                </div>
              ) : null}
              {latestBrowserAction ? (
                <div className="truncate" title={latestBrowserAction.action}>
                  Last action: {latestBrowserAction.action.replace(/_/g, ' ')} /{' '}
                  {latestBrowserAction.status}
                </div>
              ) : null}
              {taskState.browserRestoreSnapshot.health.issues.length > 0 ? (
                <div className="text-amber-100/75">
                  Health: {taskState.browserRestoreSnapshot.health.issues[0]}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {finalAnswer && (
        <div>
          <div className="mb-2 text-xs font-medium uppercase text-white/35">
            Output
          </div>
          <div className="max-h-[48vh] min-h-[120px] overflow-y-auto overflow-x-hidden rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.04] px-5 py-4 text-sm leading-6 text-white/88">
            <div className="break-words [overflow-wrap:anywhere] [&_a]:break-all [&_li]:my-1 [&_ol]:pl-5 [&_p]:my-2 [&_pre]:overflow-x-auto [&_ul]:pl-5">
              <Markdown>{finalAnswer}</Markdown>
            </div>
          </div>
        </div>
      )}

      {todoItems.length > 0 && (
        <div className="mt-5 border-t border-white/[0.07] pt-4">
          <div className="mb-3 text-xs font-medium uppercase text-white/35">
            Steps
          </div>
          <div className="space-y-0 border-l border-white/[0.08] pl-4">
            {todoItems.map((item) => (
              <div
                key={item.id}
                className="relative flex items-start gap-3 py-2 text-xs"
              >
                <span
                  className={cn(
                    'absolute -left-[21px] mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border bg-[#070808]',
                    item.status === 'done' &&
                      'border-emerald-400/40 bg-emerald-400/10 text-emerald-200',
                    item.status === 'failed' &&
                      'border-red-400/40 bg-red-400/10 text-red-200',
                    item.status === 'in_progress' &&
                      'border-blue-400/40 bg-blue-400/10 text-blue-200',
                    item.status === 'pending' &&
                      'border-white/10 bg-white/5 text-muted-foreground',
                  )}
                >
                  {item.status === 'done' ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : item.status === 'in_progress' ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : item.status === 'failed' ? (
                    <AlertCircle className="h-3 w-3" />
                  ) : null}
                </span>
                <span className="min-w-0 break-words text-white/62">
                  {item.text}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {recoveryEvidence.length > 0 && (
        <div className="mt-5 border-t border-white/[0.07] pt-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-white/35">
            <AlertCircle className="h-3.5 w-3.5" />
            Recovery
          </div>
          <div className="divide-y divide-white/[0.06]">
            {recoveryEvidence.map(({ evidence, recovery }) => (
              <div key={evidence.id} className="py-2.5 text-xs">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-white">
                    {evidence.summary}
                  </span>
                  <span className="shrink-0 rounded-full border border-amber-300/25 bg-amber-300/10 px-2 py-0.5 text-[10px] uppercase text-amber-100">
                    {recoveryLabel(recovery.status)}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-white/42">
                  Next: {recoveryLabel(recovery.nextAction)}
                </div>
                {recovery.userFacingMessage ? (
                  <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-white/48">
                    {recovery.userFacingMessage}
                  </div>
                ) : null}
                {(recovery.attemptedUrl || recovery.attemptedAction) && (
                  <div className="mt-1 truncate text-[11px] text-white/32">
                    {recovery.attemptedUrl || recovery.attemptedAction}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {wideResearchWorkers.length > 0 && (
        <div className="mt-5 border-t border-white/[0.07] pt-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-white/35">
            <FileSearch className="h-3.5 w-3.5" />
            Wide Research Workers
          </div>
          <div className="divide-y divide-white/[0.06]">
            {wideResearchWorkers.map((worker) => (
              <div key={worker.id} className="py-2.5 text-xs">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-white">
                      {worker.subtask}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-white/38">
                      <span>{worker.status}</span>
                      <span>{worker.sourceUrls.length} sources</span>
                      <span>{worker.attempts} attempts</span>
                    </div>
                    {worker.error ? (
                      <div className="mt-1 line-clamp-2 text-[11px] text-red-100/72">
                        {worker.error}
                      </div>
                    ) : null}
                  </div>
                  {worker.status === 'failed' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 rounded-lg px-2 text-[11px] text-white/48 hover:bg-white/[0.05] hover:text-white"
                      disabled={actionBusy === `retry-worker-${worker.id}`}
                      onClick={() => retryWideResearchWorker(worker.id)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Retry
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {sourceRecords.length > 0 && (
        <div className="mt-5 border-t border-white/[0.07] pt-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-white/35">
            <ExternalLink className="h-3.5 w-3.5" />
            Sources
          </div>
          <div className="divide-y divide-white/[0.06]">
            {sourceRecords.slice(-6).map((source) => (
              <button
                type="button"
                key={source.id}
                className="w-full px-0 py-2 text-left"
                onClick={() => api.openExternal({ url: source.url })}
              >
                <div className="truncate text-xs text-blue-200/90">
                  {source.title || source.url}
                </div>
                {source.quality ? (
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] uppercase text-white/32">
                    <span
                      className={cn(
                        'rounded-full border px-2 py-0.5',
                        source.quality.tier === 'high' &&
                          'border-emerald-300/20 bg-emerald-300/10 text-emerald-100',
                        source.quality.tier === 'medium' &&
                          'border-blue-300/20 bg-blue-300/10 text-blue-100',
                        source.quality.tier === 'low' &&
                          'border-amber-300/20 bg-amber-300/10 text-amber-100',
                      )}
                    >
                      {source.quality.tier} {source.quality.score}/100
                    </span>
                    {source.quality.domain ? (
                      <span className="truncate lowercase">
                        {source.quality.domain}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {source.excerpt ? (
                  <div className="mt-1 line-clamp-2 text-[11px] text-white/38">
                    {source.excerpt}
                  </div>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      )}

      {completionProof && (
        <div className="mt-5 border-t border-white/[0.07] pt-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-medium uppercase text-white/35">
              <ShieldCheck className="h-3.5 w-3.5" />
              Proof
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 rounded-lg px-2 text-xs text-white/48 hover:bg-white/[0.05] hover:text-white"
              disabled={actionBusy === 'export-summary'}
              onClick={exportSummary}
            >
              Export summary
            </Button>
          </div>
          <div className="rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.035] p-3 text-xs text-white/62">
            <div className="font-medium text-white/82">
              {completionProof.summary}
            </div>
            {completionProof.completionStatus ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                <span
                  className={cn(
                    'rounded-full border px-2 py-0.5 capitalize',
                    completionProof.completionStatus === 'verified' &&
                      'border-emerald-300/20 bg-emerald-300/10 text-emerald-100',
                    completionProof.completionStatus === 'needs_verification' &&
                      'border-amber-300/20 bg-amber-300/10 text-amber-100',
                    completionProof.completionStatus === 'blocked' &&
                      'border-red-300/20 bg-red-300/10 text-red-100',
                  )}
                >
                  {completionProof.completionStatus.replace('_', ' ')}
                </span>
                {typeof completionProof.confidence === 'number' ? (
                  <span className="text-white/42">
                    confidence {Math.round(completionProof.confidence * 100)}%
                  </span>
                ) : null}
              </div>
            ) : null}
            {completionProof.sourceQuality ? (
              <div className="mt-2 text-[11px] text-white/42">
                Sources: {completionProof.sourceQuality.mediumOrBetterCount}/
                {completionProof.sourceQuality.sourceCount} medium-or-better,
                average {completionProof.sourceQuality.averageScore}/100
              </div>
            ) : null}
            {completionProof.missingEvidence?.length ? (
              <div className="mt-2 space-y-1">
                {completionProof.missingEvidence.slice(0, 3).map((item) => (
                  <div
                    key={item}
                    className="text-[11px] text-amber-100/75"
                    title={item}
                  >
                    {item}
                  </div>
                ))}
              </div>
            ) : null}
            {completionProof.evidence.length > 0 ? (
              <div className="mt-2 space-y-1">
                {completionProof.evidence.slice(0, 4).map((item, index) => (
                  <div
                    key={`${item}-${index}`}
                    className="truncate text-[11px] text-white/36"
                    title={item}
                  >
                    {item}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {validationFailures.length > 0 && (
        <div className="mt-3 border-t border-white/10 pt-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-red-200">
            <AlertCircle className="h-3.5 w-3.5" />
            Validation Failures
          </div>
          <div className="grid gap-2">
            {validationFailures.slice(-4).map((failure, index) => (
              <div
                key={`${failure}-${index}`}
                className="rounded-md border border-red-400/20 bg-red-400/[0.05] px-2 py-1.5 text-xs text-red-100"
              >
                {failure}
              </div>
            ))}
          </div>
        </div>
      )}

      {artifacts.length > 0 && (
        <div className="mt-5 border-t border-white/[0.07] pt-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-medium uppercase text-white/35">
              <FolderOpen className="h-3.5 w-3.5" />
              Artifacts
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 rounded-lg px-2 text-xs text-white/48 hover:bg-white/[0.05] hover:text-white"
              onClick={openWorkspaceExplorer}
            >
              <FileSearch className="h-3.5 w-3.5" />
              Browse workspace
            </Button>
          </div>
          <div className="divide-y divide-white/[0.06]">
            {artifacts.map((artifact) => {
              const primaryAction = artifactPrimaryAction(artifact.kind);
              return (
                <div
                  key={artifact.id}
                  className="py-2.5"
                  title={artifact.path}
                >
                  <div className="flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-blue-200/75" />
                    <span className="truncate text-xs text-white">
                      {artifact.title}
                    </span>
                    <span className="ml-auto shrink-0 text-[10px] uppercase text-white/35">
                      {artifact.kind}
                    </span>
                  </div>
                  <div className="mt-1 truncate pl-5 text-[11px] text-white/35">
                    {artifact.path}
                  </div>
                  <div className="mt-2 flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 rounded-lg px-2 text-xs text-white/55 hover:bg-white/[0.05] hover:text-white"
                      disabled={
                        actionBusy === `${primaryAction.key}-${artifact.id}`
                      }
                      onClick={() =>
                        void refineArtifact(artifact, primaryAction.key)
                      }
                    >
                      <Wand2 className="h-3.5 w-3.5" />
                      {primaryAction.label}
                    </Button>
                    {primaryAction.key !== 'refine' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 rounded-lg px-2 text-xs text-white/55 hover:bg-white/[0.05] hover:text-white"
                        disabled={actionBusy === `refine-${artifact.id}`}
                        onClick={() => void refineArtifact(artifact)}
                      >
                        Refine
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 rounded-lg px-2 text-xs text-white/55 hover:bg-white/[0.05] hover:text-white"
                      onClick={() => void previewArtifact(artifact)}
                    >
                      <MonitorPlay className="h-3.5 w-3.5" />
                      Preview
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 rounded-lg px-2 text-xs text-white/55 hover:bg-white/[0.05] hover:text-white"
                      onClick={() => api.revealPath({ path: artifact.path })}
                    >
                      Reveal
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 rounded-lg px-2 text-xs text-white/55 hover:bg-white/[0.05] hover:text-white"
                      onClick={() => api.openPath({ path: artifact.path })}
                    >
                      Open
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {userQuestionEvents.length > 0 && (
        <div className="mt-5 border-t border-white/[0.07] pt-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-white/35">
            <CircleHelp className="h-3.5 w-3.5" />
            Questions
          </div>
          <div className="divide-y divide-white/[0.06]">
            {userQuestionEvents.slice(-4).map((event) => (
              <div key={event.id} className="py-2.5 text-xs">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-white">{event.question}</div>
                    {event.context && (
                      <div className="mt-1 text-[11px] text-white/40">
                        {event.context}
                      </div>
                    )}
                  </div>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] uppercase',
                      event.status === 'requested' &&
                        'bg-amber-400/15 text-amber-200',
                      event.status === 'answered' &&
                        'bg-emerald-400/15 text-emerald-200',
                      event.status === 'dismissed' &&
                        'bg-red-400/15 text-red-200',
                    )}
                  >
                    {event.status}
                  </span>
                </div>
                {event.choices?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {event.choices.map((choice) => (
                      <button
                        key={choice}
                        type="button"
                        disabled={event.status !== 'requested'}
                        className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-white/65 hover:border-white/20 hover:text-white disabled:opacity-45"
                        onClick={() =>
                          setQuestionDrafts((drafts) => ({
                            ...drafts,
                            [event.id]: choice,
                          }))
                        }
                      >
                        {choice}
                      </button>
                    ))}
                  </div>
                ) : null}
                {event.status === 'answered' && event.answer && (
                  <div className="mt-2 rounded-md border border-white/[0.07] bg-white/[0.03] px-2 py-1.5 text-[11px] text-white/55">
                    {event.answer}
                  </div>
                )}
                {event.status === 'requested' && (
                  <div className="mt-2 flex flex-col gap-2">
                    <textarea
                      value={questionDrafts[event.id] || ''}
                      onChange={(input) =>
                        setQuestionDrafts((drafts) => ({
                          ...drafts,
                          [event.id]: input.target.value,
                        }))
                      }
                      placeholder="Type your answer so Neura can continue"
                      className="min-h-16 rounded-md border border-white/10 bg-black/35 px-2 py-2 text-xs text-white outline-none placeholder:text-white/25 focus:border-white/25"
                    />
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        className="h-7 rounded-lg px-2 text-xs"
                        disabled={!questionDrafts[event.id]?.trim()}
                        onClick={async () => {
                          const answer = questionDrafts[event.id] || '';
                          await api.resolveUserQuestion({
                            runId: taskState.runId,
                            eventId: event.id,
                            answer,
                          });
                        }}
                      >
                        Send answer
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          {requestedQuestions.length > 0 && (
            <div className="mt-2 text-[11px] text-amber-200">
              Agent execution is waiting for your answer.
            </div>
          )}
        </div>
      )}

      {approvalEvents.length > 0 && (
        <div className="mt-5 border-t border-white/[0.07] pt-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-white/35">
            <ShieldCheck className="h-3.5 w-3.5" />
            Approvals
          </div>
          <div className="divide-y divide-white/[0.06]">
            {approvalEvents.slice(-4).map((event) => (
              <div
                key={event.id}
                className="py-2.5 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-white">{event.action}</span>
                  <span
                    className={cn(
                      'ml-auto rounded-full px-2 py-0.5 text-[10px] uppercase',
                      event.status === 'requested' &&
                        'bg-amber-400/15 text-amber-200',
                      event.status === 'approved' &&
                        'bg-emerald-400/15 text-emerald-200',
                      event.status === 'denied' && 'bg-red-400/15 text-red-200',
                      event.status === 'auto_approved' &&
                        'bg-blue-400/15 text-blue-200',
                    )}
                  >
                    {event.status.replace('_', ' ')}
                  </span>
                </div>
                {event.target && (
                  <div className="mt-1 truncate text-[11px] text-white/35">
                    {event.target}
                  </div>
                )}
                {event.status === 'requested' && (
                  <div className="mt-2 flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 rounded-lg px-2 text-xs text-white/55 hover:bg-white/[0.05] hover:text-white"
                      onClick={() =>
                        api.resolveApproval({
                          runId: taskState.runId,
                          eventId: event.id,
                          approved: false,
                        })
                      }
                    >
                      Deny
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 rounded-lg px-2 text-xs"
                      onClick={() =>
                        api.resolveApproval({
                          runId: taskState.runId,
                          eventId: event.id,
                          approved: true,
                        })
                      }
                    >
                      Approve
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {requestedApprovals.length > 0 && (
            <div className="mt-2 text-[11px] text-amber-200">
              Agent execution is waiting for your approval.
            </div>
          )}
        </div>
      )}
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl max-h-[88vh] overflow-hidden border border-white/20 bg-black/95 text-white">
          <DialogHeader>
            <DialogTitle className="truncate">
              {previewState?.title}
            </DialogTitle>
            <DialogDescription className="truncate text-xs text-muted-foreground">
              {previewState?.path}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 h-[68vh] overflow-auto rounded-md border border-white/10 bg-black/40 p-3">
            {previewLoading && (
              <div className="text-sm text-muted-foreground">
                Loading preview...
              </div>
            )}
            {!previewLoading && previewState?.kind === 'text' && (
              <pre className="whitespace-pre-wrap break-words text-xs leading-5 text-white/90">
                {previewState.text}
              </pre>
            )}
            {!previewLoading &&
              previewState?.kind === 'binary' &&
              previewState.mimeType?.startsWith('image/') && (
                <img
                  src={previewState.dataUrl}
                  alt={previewState.title}
                  className="max-h-[64vh] w-auto max-w-full rounded-md border border-white/10"
                />
              )}
            {!previewLoading &&
              previewState?.kind === 'binary' &&
              previewState.mimeType === 'application/pdf' && (
                <iframe
                  src={previewState.dataUrl}
                  title={previewState.title}
                  className="h-[64vh] w-full rounded-md border border-white/10 bg-white"
                />
              )}
            {!previewLoading &&
              previewState?.kind === 'binary' &&
              previewState.mimeType?.startsWith('audio/') && (
                <audio
                  src={previewState.dataUrl}
                  controls
                  className="mt-4 w-full"
                />
              )}
            {!previewLoading &&
              previewState?.kind === 'binary' &&
              previewState.mimeType?.startsWith('video/') && (
                <video
                  src={previewState.dataUrl}
                  controls
                  className="max-h-[64vh] w-full rounded-md border border-white/10"
                />
              )}
            {!previewLoading && previewState?.kind === 'unsupported' && (
              <div className="space-y-3 text-sm text-muted-foreground">
                <div>{previewState.reason || 'Preview is not available.'}</div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      previewState?.path &&
                      api.revealPath({ path: previewState.path })
                    }
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    Reveal
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      previewState?.path &&
                      api.openPath({ path: previewState.path })
                    }
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open externally
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={workspaceOpen} onOpenChange={setWorkspaceOpen}>
        <DialogContent className="max-w-5xl max-h-[88vh] overflow-hidden border border-white/20 bg-black/95 text-white">
          <DialogHeader>
            <DialogTitle>Workspace Explorer</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Browse generated files and artifacts for this run.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 h-[68vh] overflow-auto space-y-4 rounded-md border border-white/10 bg-black/40 p-3">
            {workspaceLoading && (
              <div className="text-sm text-muted-foreground">
                Loading workspace...
              </div>
            )}
            {!workspaceLoading && workspaceState.length === 0 && (
              <div className="text-sm text-muted-foreground">
                No workspace files were found for this run.
              </div>
            )}
            {!workspaceLoading &&
              workspaceState.map((root) => (
                <section
                  key={root.rootPath}
                  className="rounded-md border border-white/10 bg-black/20 p-3"
                >
                  <div className="mb-2 break-words text-xs text-blue-200">
                    {root.rootPath}
                  </div>
                  <div className="space-y-2">
                    {root.entries.map((entry) => (
                      <div
                        key={entry.path}
                        className="flex flex-wrap items-center gap-2 rounded-md border border-white/10 bg-black/20 px-2 py-1.5"
                      >
                        {entry.type === 'directory' ? (
                          <FolderOpen className="h-3.5 w-3.5 text-blue-300" />
                        ) : entry.name.match(
                            /\.(png|jpg|jpeg|webp|gif|svg)$/i,
                          ) ? (
                          <FileImage className="h-3.5 w-3.5 text-emerald-300" />
                        ) : (
                          <FileCode2 className="h-3.5 w-3.5 text-slate-300" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-xs text-white">
                          {entry.name}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {entry.type === 'file'
                            ? formatBytes(entry.sizeBytes)
                            : 'dir'}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {new Date(entry.modifiedAt).toLocaleString()}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={() => api.revealPath({ path: entry.path })}
                        >
                          Reveal
                        </Button>
                        {entry.type === 'file' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() =>
                              void previewArtifact({
                                id: entry.path,
                                title: entry.name,
                                kind: 'other',
                                path: entry.path,
                                sourceRunId: taskState.runId,
                                createdAt: entry.modifiedAt,
                              })
                            }
                          >
                            Preview
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
