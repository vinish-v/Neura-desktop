/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { motion } from 'framer-motion';
import {
  Check,
  AlertTriangle,
  Maximize2,
  Minimize2,
  Monitor,
  PanelTop,
  RefreshCw,
  SkipBack,
  SkipForward,
  Terminal,
  X,
} from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import { Slider } from '@renderer/components/ui/slider';
import { type ConversationWithSoM } from '@main/shared/types';
import {
  type ComputerRuntimeInteraction,
  type ComputerRuntimeOutput,
} from '@main/store/types';
import {
  MotionPanel,
  panelMotion,
} from '@renderer/components/magic/PremiumSurface';
import { useStore } from '@renderer/hooks/useStore';
import { cn } from '@renderer/utils';
import { Markdown } from '../markdown';
import { api } from '@renderer/api';

interface ImageGalleryProps {
  selectImgIndex?: number;
  messages: ConversationWithSoM[];
  onClose?: () => void;
}

interface Action {
  type: string;
  label: string;
  cost?: number;
  input?: string;
}

type CommandFrame = {
  command: string;
  cwd?: string;
  stdout?: string;
  stderr?: string;
  raw?: string;
  failed: boolean;
};

const runtimeOutputToCommandFrame = (
  output?: ComputerRuntimeOutput,
): CommandFrame | null => {
  if (!output) {
    return null;
  }
  return {
    command: output.command || '',
    cwd: output.cwd,
    stdout: output.stdout,
    stderr: output.stderr,
    raw: output.raw,
    failed: output.failed,
  };
};

const interactionLabel = (interaction?: ComputerRuntimeInteraction) => {
  if (!interaction) {
    return '';
  }
  switch (interaction.type) {
    case 'click':
      return 'Click';
    case 'double_click':
      return 'Double click';
    case 'right_click':
      return 'Right click';
    case 'scroll':
      return interaction.direction === 'up' ? 'Scroll up' : 'Scroll down';
    case 'text':
      return interaction.text ? `Typing ${interaction.text}` : 'Typing';
    case 'hotkey':
      return interaction.key ? `Hotkey ${interaction.key}` : 'Hotkey';
    case 'key':
      return interaction.key ? `Key ${interaction.key}` : 'Key press';
    default:
      return 'Input';
  }
};

const getActionInput = (
  item: NonNullable<ConversationWithSoM['predictionParsed']>[number],
) => {
  if (item.action_type === 'finished') {
    return '';
  }

  const inputs = item.action_inputs as typeof item.action_inputs & {
    command?: string;
  };
  return (
    inputs?.command ||
    inputs?.content ||
    inputs?.key ||
    inputs?.element_id ||
    inputs?.start_box ||
    ''
  );
};

const getActionLabel = (type: string) => {
  switch (type) {
    case 'navigate':
      return 'Navigating';
    case 'navigate_back':
      return 'Going back';
    case 'click_element':
    case 'click':
    case 'left_double':
      return 'Clicking element';
    case 'type_element':
    case 'type':
      return 'Typing';
    case 'run_command':
      return 'Running command';
    case 'finished':
      return 'Finished';
    case 'wait':
      return 'Waiting';
    default:
      return type.replace(/_/g, ' ');
  }
};

const INTERNAL_PROGRESS_PATTERN =
  /previous response was not executable|authorized benign UI automation|Action Space|previous action had invalid coordinates|browser state has not changed after repeated actions|previous browser DOM action could not be executed|continue autonomously: take a fresh screenshot\/DOM map|do not finish with this recovery message|element id was stale|take a fresh screenshot\/DOM map|Could not (?:type into|click) that DOM element|Refresh the DOM map or use coordinate click\/type|reply with finished\(content=|visible current DOM element|regex|pattern|validator|validated \d+ local computer actor|command output contains|planner checklist|planner step|predictionParsed|<(html|xml|rdf|!doctype)|xmlns=|rdf:resource=/i;
const RUNTIME_NAME_PATTERN = new RegExp('her' + 'mes[-_.]agent', 'gi');
const RUNTIME_WORD_PATTERN = new RegExp('\\bher' + 'mes\\b', 'gi');
const RUNTIME_PREFIX_PATTERN = new RegExp('\\bher' + 'mes[._:-]?', 'gi');

const cleanProgressInput = (value?: string) =>
  (value || '')
    .replace(/\\n/g, ' ')
    .replace(RUNTIME_NAME_PATTERN, 'runtime')
    .replace(RUNTIME_WORD_PATTERN, 'Neura')
    .replace(RUNTIME_PREFIX_PATTERN, '')
    .replace(/file:\/\/\/[^\s)]+/g, '[runtime files]')
    .replace(/C:\\Users\\[^\s]+/gi, '[local path]')
    .replace(/\s+/g, ' ')
    .trim();

const publicProgressLabel = (value?: string) => {
  const cleaned = cleanProgressInput(value);
  if (/browser bridge ready|browser automation ready/i.test(cleaned)) {
    return 'Browser automation ready';
  }
  if (/backend configured|runtime configured/i.test(cleaned)) {
    return 'Runtime configured';
  }
  if (/backend output|preparing runtime/i.test(cleaned)) {
    return 'Preparing runtime';
  }
  if (/agent started|runtime started/i.test(cleaned)) {
    return 'Runtime started';
  }
  if (/tool:\s*browser|browser navigate|browser action/i.test(cleaned)) {
    return 'Browser action';
  }
  if (/terminal|command|shell/i.test(cleaned)) {
    return 'Command';
  }
  return cleaned;
};

const isInternalProgressText = (...parts: Array<string | undefined>) =>
  INTERNAL_PROGRESS_PATTERN.test(parts.filter(Boolean).join(' '));

const cleanFinalAnswer = (value?: string) => {
  const text = (value || '').replace(/\\n/g, '\n').trim();
  return text && !isInternalProgressText(text) ? text : '';
};

const parseCommandFrame = (value: string): CommandFrame | null => {
  if (!/Command (completed|failed)/i.test(value)) {
    return null;
  }

  const command =
    value.match(/^Command:\s*(.+)$/im)?.[1]?.trim() ||
    value.match(/-Command\s+([^\r\n]+)/i)?.[1]?.trim() ||
    value.match(/`([^`]+)`/)?.[1]?.trim() ||
    '';
  const cwd = value.match(/^CWD:\s*(.+)$/im)?.[1]?.trim();
  const stdout = value
    .match(/\nstdout:\n([\s\S]*?)(?:\n\nstderr:|\nstderr:|$)/i)?.[1]
    ?.trim();
  const stderr = value.match(/\nstderr:\n([\s\S]*)$/i)?.[1]?.trim();

  return {
    command,
    cwd,
    stdout,
    stderr,
    raw: stdout || stderr ? undefined : value.trim(),
    failed: /Command failed/i.test(value),
  };
};

const getPageUrl = (message?: ConversationWithSoM) => {
  const domText = message?.domText || '';
  return domText.match(/^URL:\s*(.+)$/m)?.[1]?.trim();
};

const getFinalAnswer = (messages: ConversationWithSoM[]) => {
  for (const message of [...messages].reverse()) {
    const finished = message.predictionParsed?.find(
      (item) =>
        item.action_type === 'finished' &&
        typeof item.action_inputs?.content === 'string' &&
        item.action_inputs.content.trim(),
    );
    if (typeof finished?.action_inputs?.content === 'string') {
      const content = cleanFinalAnswer(finished.action_inputs.content);
      if (content) {
        return content;
      }
    }

    if (
      message.from === 'gpt' &&
      typeof message.value === 'string' &&
      message.value.trim() &&
      !message.predictionParsed?.length
    ) {
      const content = cleanFinalAnswer(message.value);
      if (content) {
        return content;
      }
    }
  }

  return '';
};

const ImageGallery: React.FC<ImageGalleryProps> = ({
  messages,
  selectImgIndex,
  onClose,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const { taskState, computerRuntime } = useStore();
  const [takeoverBusy, setTakeoverBusy] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const nativeBrowserSurfaceRef = useRef<HTMLDivElement>(null);

  const imageEntries = useMemo(() => {
    return messages
      .map((msg, index) => {
        let actions: Action[] = [];

        if (msg.from === 'human') {
          actions = [
            {
              label: 'Observed frame',
              type: 'screenshot',
              cost: msg.timing?.cost,
            },
          ];
        } else {
          actions =
            msg.predictionParsed?.map((item) => {
              const input = getActionInput(item);

              return {
                label: getActionLabel(item.action_type),
                type: item.action_type,
                cost: msg.timing?.cost,
                input,
              };
            }) || [];
        }

        return {
          originalIndex: index,
          message: msg,
          imageData: msg.screenshotBase64,
          actions,
          timing: msg.timing,
        };
      })
      .filter((entry) => entry.imageData);
  }, [messages]);

  const allActions = useMemo(
    () =>
      messages.flatMap(
        (msg) =>
          msg.predictionParsed?.map((item) => ({
            type: item.action_type,
            label: getActionLabel(item.action_type),
            input: getActionInput(item),
          })) || [],
      ),
    [messages],
  );

  useEffect(() => {
    if (typeof selectImgIndex === 'number') {
      const targetIndex = imageEntries.findIndex(
        (entry) => entry.originalIndex === selectImgIndex,
      );
      if (targetIndex !== -1) {
        setCurrentIndex(targetIndex);
      }
    }
  }, [selectImgIndex, imageEntries]);

  useEffect(() => {
    setCurrentIndex(imageEntries.length - 1);
  }, [imageEntries.length]);

  const handleSliderChange = (value: number[]) => {
    setCurrentIndex(value[0]);
  };

  const handlePrevious = () => {
    setCurrentIndex(
      (current) => (current - 1 + imageEntries.length) % imageEntries.length,
    );
  };

  const handleNext = () => {
    setCurrentIndex((current) => (current + 1) % imageEntries.length);
  };

  const currentEntry = imageEntries[currentIndex];
  const liveFrame = computerRuntime?.frame || computerRuntime?.latestFrame;
  const liveFrameSrc = liveFrame?.dataUrl;
  const liveCursor = liveFrame?.cursor;
  const latestInteraction = computerRuntime?.latestInteraction;
  const streamFrameRate = computerRuntime?.liveStream?.frameRate;
  const takeoverEnabled = Boolean(computerRuntime?.takeoverEnabled);
  const isNativeBrowserSurface =
    computerRuntime?.mode === 'browser' &&
    computerRuntime?.surface === 'native_browser';
  const replayFrameSrc = currentEntry?.imageData
    ? `data:${currentEntry?.message?.screenshotContext?.mime || 'image/png'};base64,${currentEntry.imageData}`
    : '';
  const frameImageSrc = liveFrameSrc || replayFrameSrc;
  const activeFrameSize =
    liveFrame?.width && liveFrame?.height
      ? { width: liveFrame.width, height: liveFrame.height }
      : currentEntry?.message?.screenshotContext?.size;
  const currentAction =
    currentEntry?.actions.find((action) => action.type !== 'screenshot') ||
    allActions[allActions.length - 1];
  const latestSource = taskState?.sourcesVisited.slice(-1)[0];
  const pageUrl =
    computerRuntime?.browser?.url ||
    getPageUrl(currentEntry?.message) ||
    latestSource;
  const parsedCommandFrame = useMemo(() => {
    const candidates = [
      ...(taskState?.completionProof?.evidence || []),
      ...messages.map((message) => message.value || ''),
    ];
    for (const candidate of candidates.reverse()) {
      const parsed = parseCommandFrame(candidate);
      if (parsed) {
        return parsed;
      }
    }
    return null;
  }, [messages, taskState?.completionProof?.evidence]);
  const commandFrame =
    runtimeOutputToCommandFrame(
      computerRuntime?.terminal || computerRuntime?.latestOutput,
    ) || parsedCommandFrame;
  const hasVisualFrame = Boolean(frameImageSrc) && !isNativeBrowserSurface;
  const isLiveStream = Boolean(liveFrameSrc) && !isNativeBrowserSurface;
  const shouldShowCommandFrame =
    Boolean(commandFrame) &&
    (computerRuntime?.mode === 'terminal' ||
      (!hasVisualFrame && currentAction?.type === 'run_command'));
  const isTerminalMode =
    computerRuntime?.mode === 'terminal' ||
    (!hasVisualFrame && currentAction?.type === 'run_command');
  const mode = isTerminalMode
    ? 'Terminal'
    : computerRuntime?.mode === 'browser' || pageUrl
      ? 'Browser'
      : computerRuntime?.mode === 'desktop'
        ? 'Desktop'
        : 'Computer';
  const isFinished = allActions.some((action) => action.type === 'finished');
  const finalAnswer = useMemo(
    () => getFinalAnswer(messages) || cleanFinalAnswer(taskState?.finalAnswer),
    [messages, taskState?.finalAnswer],
  );
  const shouldShowFinalAnswer =
    Boolean(finalAnswer) && (taskState?.status === 'completed' || isFinished);
  const activityText =
    publicProgressLabel(
      computerRuntime?.activity || currentAction?.label || taskState?.currentStep,
    );
  const needsRecovery =
    computerRuntime?.status === 'failed' ||
    computerRuntime?.status === 'paused' ||
    taskState?.status === 'failed';
  const recoveryMessage =
    taskState?.error ||
    computerRuntime?.activity ||
    (computerRuntime?.status === 'paused'
      ? 'Execution is paused.'
      : 'The runtime needs attention.');

  const syncNativeBrowserSurface = useCallback(() => {
    const element = nativeBrowserSurfaceRef.current;
    if (!isNativeBrowserSurface || !element) {
      void api.setComputerSurfaceVisible({ visible: false });
      return;
    }

    const rect = element.getBoundingClientRect();
    const visible = rect.width >= 24 && rect.height >= 24;
    void api.setComputerSurfaceBounds({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    });
    void api.setComputerSurfaceVisible({ visible });
  }, [isNativeBrowserSurface]);

  useEffect(() => {
    syncNativeBrowserSurface();
    if (!isNativeBrowserSurface || !nativeBrowserSurfaceRef.current) {
      return;
    }

    const element = nativeBrowserSurfaceRef.current;
    const observer = new ResizeObserver(syncNativeBrowserSurface);
    observer.observe(element);
    window.addEventListener('resize', syncNativeBrowserSurface);
    const interval = window.setInterval(syncNativeBrowserSurface, 500);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncNativeBrowserSurface);
      window.clearInterval(interval);
      void api.setComputerSurfaceVisible({ visible: false });
    };
  }, [isNativeBrowserSurface, syncNativeBrowserSurface]);

  const renderEmptyState = () => (
    <div className="flex h-full max-w-xl flex-col items-center justify-center gap-4 px-6 text-center text-muted-foreground">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
        <Monitor className="h-8 w-8" />
      </div>
      <div>
        <div className="text-base font-semibold text-white">
          {taskState?.status === 'running'
            ? "Neura's Computer is running"
            : "Neura's Computer is ready"}
        </div>
        <div className="mt-2 text-sm leading-6">
          {publicProgressLabel(taskState?.currentStep) ||
            publicProgressLabel(taskState?.progressItems.slice(-1)[0]?.detail) ||
            'Terminal, browser, and desktop activity appears here while the task runs.'}
        </div>
      </div>
    </div>
  );

  const renderCommandFrame = (frame: CommandFrame) => (
    <div className="flex h-full w-full flex-col bg-[#171717] font-mono text-sm leading-6">
      <div className="flex h-11 shrink-0 items-center justify-center border-b border-white/10 bg-[#1f1f1f] px-4 font-sans text-sm font-medium text-muted-foreground">
        {frame.cwd || 'Terminal'}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-5">
        <div className="text-[#68d13f]">
          PS&gt;{' '}
          <span className="font-semibold text-white">
            {frame.command || 'command'}
          </span>
        </div>
        {frame.stdout ? (
          <pre className="mt-3 whitespace-pre-wrap break-words text-white">
            {frame.stdout}
          </pre>
        ) : null}
        {frame.stderr ? (
          <pre className="mt-3 whitespace-pre-wrap break-words text-amber-100">
            {frame.stderr}
          </pre>
        ) : null}
        {frame.raw ? (
          <pre className="mt-3 whitespace-pre-wrap break-words text-amber-100">
            {frame.raw}
          </pre>
        ) : null}
        <div
          className={
            frame.failed ? 'mt-3 text-amber-300' : 'mt-3 text-[#68d13f]'
          }
        >
          {frame.failed ? 'Command needs attention' : 'Command completed'}
        </div>
      </div>
    </div>
  );

  const renderLiveOverlays = () => {
    if (!activeFrameSize) {
      return null;
    }
    const cursorLeft =
      liveCursor && activeFrameSize.width
        ? `${(liveCursor.x / activeFrameSize.width) * 100}%`
        : undefined;
    const cursorTop =
      liveCursor && activeFrameSize.height
        ? `${(liveCursor.y / activeFrameSize.height) * 100}%`
        : undefined;
    const interactionLeft =
      latestInteraction?.x !== undefined && activeFrameSize.width
        ? `${(latestInteraction.x / activeFrameSize.width) * 100}%`
        : cursorLeft;
    const interactionTop =
      latestInteraction?.y !== undefined && activeFrameSize.height
        ? `${(latestInteraction.y / activeFrameSize.height) * 100}%`
        : cursorTop;
    const showInteraction =
      latestInteraction &&
      Date.now() - latestInteraction.createdAt < 1800 &&
      (interactionLeft || latestInteraction.type === 'text' || latestInteraction.type === 'key');

    return (
      <div className="pointer-events-none absolute inset-0">
        {isLiveStream ? (
          <div className="absolute left-3 top-3 flex items-center gap-2 rounded-md border border-emerald-300/25 bg-black/70 px-2.5 py-1 text-[11px] font-medium text-emerald-100 shadow-lg">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" />
            Live
            {streamFrameRate ? (
              <span className="text-emerald-100/60">
                {streamFrameRate.toFixed(1)} fps
              </span>
            ) : null}
          </div>
        ) : null}
        {cursorLeft && cursorTop ? (
          <motion.div
            className="absolute h-4 w-4 -translate-x-1 -translate-y-1"
            style={{ left: cursorLeft, top: cursorTop }}
            animate={{ left: cursorLeft, top: cursorTop }}
            transition={{ duration: 0.08, ease: 'linear' }}
          >
            <div className="h-3 w-3 rotate-45 border-l-2 border-t-2 border-white drop-shadow-[0_0_4px_rgba(0,0,0,0.9)]" />
          </motion.div>
        ) : null}
        {showInteraction ? (
          <motion.div
            key={latestInteraction.id}
            className="absolute"
            style={{
              left: interactionLeft || '50%',
              top: interactionTop || '88%',
            }}
            initial={{ opacity: 0, scale: 0.75, x: '-50%', y: '-50%' }}
            animate={{ opacity: [0, 1, 1, 0], scale: [0.75, 1, 1, 1.18] }}
            transition={{ duration: 1.35, ease: 'easeOut' }}
          >
            <div className="relative flex items-center justify-center">
              {latestInteraction.x !== undefined ? (
                <span className="absolute h-12 w-12 rounded-full border-2 border-emerald-300/80 bg-emerald-300/10" />
              ) : null}
              <span className="relative rounded-md border border-white/15 bg-black/80 px-2 py-1 text-[11px] font-semibold text-white shadow-lg">
                {interactionLabel(latestInteraction)}
              </span>
            </div>
          </motion.div>
        ) : null}
      </div>
    );
  };

  const toggleTakeover = async () => {
    if (!computerRuntime || takeoverBusy) {
      return;
    }
    setTakeoverBusy(true);
    try {
      await api.setComputerTakeover({
        enabled: !computerRuntime.takeoverEnabled,
      });
    } finally {
      setTakeoverBusy(false);
    }
  };

  const recoverRun = async () => {
    if (!taskState || recoveryBusy) {
      return;
    }
    setRecoveryBusy(true);
    try {
      await api.retryRun({ runId: taskState.runId });
    } finally {
      setRecoveryBusy(false);
    }
  };

  const resumeRun = async () => {
    if (recoveryBusy) {
      return;
    }
    setRecoveryBusy(true);
    try {
      await api.resumeRun();
    } finally {
      setRecoveryBusy(false);
    }
  };

  const getFramePoint = (
    event:
      | React.MouseEvent<HTMLImageElement>
      | React.WheelEvent<HTMLImageElement>,
  ) => {
    if (!takeoverEnabled || !activeFrameSize) {
      return null;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.round(
      ((event.clientX - rect.left) / rect.width) * activeFrameSize.width,
    );
    const y = Math.round(
      ((event.clientY - rect.top) / rect.height) * activeFrameSize.height,
    );
    return { x, y };
  };

  const forwardFrameClick = async (
    event: React.MouseEvent<HTMLImageElement>,
  ) => {
    const point = getFramePoint(event);
    if (!point) {
      return;
    }
    frameRef.current?.focus();
    event.preventDefault();
    event.stopPropagation();
    await api.computerTakeoverInput({ type: 'click', ...point });
  };

  const forwardFrameDoubleClick = async (
    event: React.MouseEvent<HTMLImageElement>,
  ) => {
    const point = getFramePoint(event);
    if (!point) {
      return;
    }
    frameRef.current?.focus();
    event.preventDefault();
    event.stopPropagation();
    await api.computerTakeoverInput({ type: 'double_click', ...point });
  };

  const forwardFrameContextMenu = async (
    event: React.MouseEvent<HTMLImageElement>,
  ) => {
    const point = getFramePoint(event);
    if (!point) {
      return;
    }
    frameRef.current?.focus();
    event.preventDefault();
    event.stopPropagation();
    await api.computerTakeoverInput({ type: 'right_click', ...point });
  };

  const forwardFrameWheel = async (
    event: React.WheelEvent<HTMLImageElement>,
  ) => {
    const point = getFramePoint(event);
    if (!point) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    await api.computerTakeoverInput({
      type: 'scroll',
      ...point,
      direction: event.deltaY < 0 ? 'up' : 'down',
    });
  };

  const forwardTakeoverKey = async (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => {
    if (!takeoverEnabled) {
      return;
    }

    const modifierParts = [
      event.ctrlKey ? 'ctrl' : '',
      event.metaKey ? 'meta' : '',
      event.altKey ? 'alt' : '',
      event.shiftKey ? 'shift' : '',
    ].filter(Boolean);
    if (
      modifierParts.length > 0 &&
      !['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)
    ) {
      event.preventDefault();
      const key = event.key === ' ' ? 'space' : event.key.toLowerCase();
      await api.computerTakeoverInput({
        type: 'hotkey',
        key: [...modifierParts, key].join('+'),
      });
      return;
    }

    if (event.key.length === 1) {
      event.preventDefault();
      await api.computerTakeoverInput({ type: 'text', text: event.key });
      return;
    }

    if (
      [
        'Enter',
        'Backspace',
        'Delete',
        'Tab',
        'Escape',
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
      ].includes(event.key)
    ) {
      event.preventDefault();
      await api.computerTakeoverInput({ type: 'key', key: event.key });
    }
  };

  const forwardTakeoverPaste = async (
    event: React.ClipboardEvent<HTMLDivElement>,
  ) => {
    if (!takeoverEnabled) {
      return;
    }
    const text = event.clipboardData.getData('text');
    if (!text) {
      return;
    }
    event.preventDefault();
    await api.computerTakeoverInput({ type: 'text', text });
  };

  const renderSlider = () => (
    <div className="flex items-center gap-2 px-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={handlePrevious}
        disabled={imageEntries.length <= 1 || currentIndex === 0}
      >
        <SkipBack className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={handleNext}
        disabled={
          imageEntries.length <= 1 || currentIndex === imageEntries.length - 1
        }
      >
        <SkipForward className="h-4 w-4" />
      </Button>
      <Slider
        value={[currentIndex]}
        min={0}
        max={Math.max(imageEntries.length - 1, 0)}
        step={1}
        onValueChange={handleSliderChange}
        disabled={imageEntries.length <= 1}
      />
    </div>
  );

  return (
    <MotionPanel
      {...panelMotion}
      className={cn(
        'neura-surface flex min-h-0 flex-col overflow-hidden rounded-xl',
        isExpanded
          ? 'fixed inset-4 z-50 h-auto rounded-2xl bg-[#050505] shadow-[0_40px_120px_rgba(0,0,0,0.75)]'
          : 'h-full',
      )}
    >
      <div className="flex items-start justify-between border-b border-white/10 px-5 py-4">
        <div>
          <div className="text-lg font-semibold text-white">
            Neura&apos;s Computer
          </div>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/10 bg-white/5">
              {mode === 'Browser' ? (
                <PanelTop className="h-3 w-3" />
              ) : (
                <Terminal className="h-3 w-3" />
              )}
            </span>
            <span>Neura is using {mode}</span>
            {activityText ? <span>|</span> : null}
            {activityText ? (
              <span className="truncate">{activityText}</span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <Button
            variant="ghost"
            size="sm"
            className={
              takeoverEnabled
                ? 'h-8 rounded-lg bg-emerald-400/15 px-3 text-emerald-100 hover:bg-emerald-400/20'
                : 'h-8 rounded-lg px-3 hover:bg-white/10'
            }
            onClick={toggleTakeover}
            disabled={!computerRuntime || takeoverBusy}
          >
            {takeoverEnabled ? 'Takeover on' : 'Take over'}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg hover:bg-white/10"
          >
            <Monitor className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg hover:bg-white/10"
            onClick={() => setIsExpanded((value) => !value)}
            aria-label={
              isExpanded ? "Collapse Neura's Computer" : "Expand Neura's Computer"
            }
          >
            {isExpanded ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg hover:bg-white/10"
            onClick={onClose}
            disabled={!onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-[#2a2a2a] scrollbar-track-transparent">
        {needsRecovery ? (
          <div className="mb-4 rounded-lg border border-amber-300/20 bg-amber-300/[0.055] p-3">
            <div className="flex flex-wrap items-center gap-3">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-200" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-amber-100">
                  Recovery needed
                </div>
                <div className="mt-1 line-clamp-2 text-xs text-amber-50/58">
                  {publicProgressLabel(recoveryMessage)}
                </div>
              </div>
              {computerRuntime?.status === 'paused' ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 rounded-lg px-3 text-xs text-amber-50/78 hover:bg-white/10 hover:text-white"
                  disabled={recoveryBusy}
                  onClick={resumeRun}
                >
                  Resume
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                className="h-8 rounded-lg px-3 text-xs text-amber-50/78 hover:bg-white/10 hover:text-white"
                disabled={!taskState || recoveryBusy}
                onClick={recoverRun}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 rounded-lg px-3 text-xs text-amber-50/78 hover:bg-white/10 hover:text-white"
                disabled={!computerRuntime || takeoverBusy}
                onClick={toggleTakeover}
              >
                Take over
              </Button>
            </div>
          </div>
        ) : null}

        <div
          className={cn(
            'flex shrink-0 flex-col overflow-hidden rounded-lg border border-white/10 bg-black',
            isExpanded
              ? 'h-[calc(100vh-220px)] min-h-[420px]'
              : 'h-[min(52vh,560px)] min-h-[340px]',
          )}
        >
          <div className="flex h-11 items-center justify-center border-b border-white/10 bg-[#050505] px-4 text-sm font-medium text-muted-foreground">
            <span className="max-w-[78%] truncate">
              {pageUrl ||
                computerRuntime?.display ||
                (shouldShowCommandFrame ? commandFrame?.cwd : undefined) ||
                (taskState?.status === 'running'
                  ? "Neura's Computer active"
                  : mode === 'Browser'
                    ? 'Waiting for browser state'
                    : 'Local computer')}
            </span>
          </div>
          <div
            ref={frameRef}
            className={cn(
              'relative flex min-h-0 flex-1 items-center justify-center bg-black outline-none',
            )}
            tabIndex={takeoverEnabled ? 0 : -1}
            onKeyDown={forwardTakeoverKey}
            onPaste={forwardTakeoverPaste}
            onMouseDown={() => frameRef.current?.focus()}
          >
            {isNativeBrowserSurface ? (
              <div
                ref={nativeBrowserSurfaceRef}
                className="relative h-full min-h-[320px] w-full bg-black"
              >
                {!computerRuntime?.browser?.url ? renderEmptyState() : null}
              </div>
            ) : shouldShowCommandFrame && commandFrame ? (
              renderCommandFrame(commandFrame)
            ) : frameImageSrc ? (
              <div className="relative h-full w-full">
                <motion.img
                  key={
                    liveFrameSrc
                      ? 'live-desktop-frame'
                      : `replay-${currentEntry?.originalIndex || 0}`
                  }
                  src={frameImageSrc}
                  alt="Neura computer live stream"
                  className="h-full w-full select-none object-contain"
                  onClick={forwardFrameClick}
                  onDoubleClick={forwardFrameDoubleClick}
                  onContextMenu={forwardFrameContextMenu}
                  onWheel={forwardFrameWheel}
                  draggable={false}
                  initial={{ opacity: 0, scale: 0.985 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.12 }}
                />
                {renderLiveOverlays()}
              </div>
            ) : (
              renderEmptyState()
            )}
          </div>
        </div>

        {imageEntries.length > 1 ? (
          <div className="mt-3">{renderSlider()}</div>
        ) : null}

        {shouldShowFinalAnswer ? (
          <div className="mt-4 min-h-[180px] rounded-lg border border-emerald-400/20 bg-emerald-400/[0.045] p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-100">
              <Check className="h-4 w-4 text-emerald-400" />
              Final answer
            </div>
            <div className="break-words text-sm leading-6 text-white/85 [&_li]:my-1 [&_ol]:pl-5 [&_p]:my-2 [&_ul]:pl-5">
              <Markdown>{finalAnswer}</Markdown>
            </div>
          </div>
        ) : null}
      </div>
    </MotionPanel>
  );
};

export default ImageGallery;
