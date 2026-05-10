/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'crypto';

import { store } from '@main/store/create';
import type {
  ComputerRuntimeEventType,
  ComputerRuntimeFrame,
  ComputerRuntimeMode,
  ComputerRuntimeOutput,
  ComputerRuntimeState,
  ComputerRuntimeStatus,
} from '@main/store/types';
import { localDesktopMirror } from './localDesktopMirror';
import {
  embeddedBrowserRuntime,
  type ComputerSurfaceBounds,
} from './embeddedBrowserRuntime';

type RuntimeStartInput = {
  mode: ComputerRuntimeMode;
  title?: string;
  subtitle?: string;
  display?: string;
  activity?: string;
  currentUrl?: string;
  cwd?: string;
};

type RuntimeUpdateInput = Partial<
  Pick<
    ComputerRuntimeState,
    | 'mode'
    | 'status'
    | 'surface'
    | 'subtitle'
    | 'display'
    | 'activity'
    | 'currentUrl'
    | 'cwd'
    | 'browser'
    | 'activeProcessId'
    | 'takeoverEnabled'
  >
>;

const modeSubtitle = (mode: ComputerRuntimeMode) => {
  switch (mode) {
    case 'browser':
      return 'Browser';
    case 'terminal':
      return 'Terminal';
    case 'desktop':
      return 'Desktop';
    case 'rdp':
      return 'Remote desktop';
    default:
      return 'Computer';
  }
};

const syncLiveMirror = (mode?: ComputerRuntimeMode, status?: ComputerRuntimeStatus) => {
  if (
    mode === 'desktop' &&
    status !== 'completed' &&
    status !== 'failed' &&
    status !== 'idle'
  ) {
    localDesktopMirror.start((frame) => {
      ComputerRuntimeController.frame(frame, { fromLiveMirror: true });
    });
    return;
  }

  if (mode && mode !== 'desktop') {
    localDesktopMirror.stop();
  }

  if (mode && mode !== 'browser') {
    embeddedBrowserRuntime.destroy();
  }

  if (status === 'completed' || status === 'failed' || status === 'idle') {
    localDesktopMirror.stop();
    embeddedBrowserRuntime.destroy();
  }
};

const eventForStatus = (
  status: ComputerRuntimeStatus,
): ComputerRuntimeEventType | null => {
  if (status === 'completed') {
    return 'runtime.completed';
  }
  if (status === 'failed') {
    return 'runtime.failed';
  }
  return null;
};

const appendEvent = (
  runtime: ComputerRuntimeState,
  type: ComputerRuntimeEventType,
  message?: string,
) => ({
  ...runtime,
  events: [
    ...(runtime.events || []),
    {
      id: randomUUID(),
      type,
      mode: runtime.mode,
      message,
      createdAt: Date.now(),
    },
  ].slice(-40),
});

const patchRuntime = (
  patch:
    | RuntimeUpdateInput
    | ((runtime: ComputerRuntimeState) => ComputerRuntimeState),
  eventType?: ComputerRuntimeEventType,
  eventMessage?: string,
) => {
  const current = store.getState();
  const existing = current.computerRuntime;
  if (!existing) {
    return null;
  }

  const updated =
    typeof patch === 'function'
      ? patch(existing)
      : (() => {
          const definedPatch = Object.fromEntries(
            Object.entries(patch).filter(([, value]) => value !== undefined),
          ) as RuntimeUpdateInput;
          return {
            ...existing,
            ...definedPatch,
            subtitle:
              definedPatch.subtitle ||
              existing.subtitle ||
              modeSubtitle(definedPatch.mode || existing.mode),
            updatedAt: Date.now(),
          };
        })();
  const withEvent = eventType
    ? appendEvent(updated, eventType, eventMessage)
    : updated;
  store.setState({ computerRuntime: withEvent });
  return withEvent;
};

export class ComputerRuntimeController {
  static start(input: RuntimeStartInput) {
    const runtime: ComputerRuntimeState = {
      mode: input.mode,
      status: 'starting',
      surface:
        input.mode === 'browser'
          ? 'native_browser'
          : input.mode === 'terminal'
            ? 'terminal'
            : 'frame_stream',
      title: input.title || "Neura's Computer",
      subtitle: input.subtitle || modeSubtitle(input.mode),
      display: input.display,
      activity: input.activity || 'Starting',
      currentUrl: input.currentUrl,
      cwd: input.cwd,
      takeoverEnabled: false,
      events: [],
      updatedAt: Date.now(),
    };
    store.setState({
      computerRuntime: appendEvent(
        runtime,
        'runtime.started',
        input.activity || runtime.subtitle,
      ),
    });
    syncLiveMirror(runtime.mode, runtime.status);
    if (runtime.mode === 'browser') {
      void embeddedBrowserRuntime.setInteractionBlocked(true);
    }
    return store.getState().computerRuntime;
  }

  static update(input: RuntimeUpdateInput) {
    const eventType =
      input.mode && input.mode !== store.getState().computerRuntime?.mode
        ? 'runtime.mode_changed'
        : input.takeoverEnabled !== undefined
          ? 'runtime.takeover_changed'
          : input.status
            ? eventForStatus(input.status)
            : null;
    const updated = patchRuntime(
      input,
      eventType || undefined,
      input.activity || input.display,
    );
    syncLiveMirror(updated?.mode || input.mode, updated?.status || input.status);
    return updated;
  }

  static frame(
    frame: Omit<ComputerRuntimeFrame, 'updatedAt'>,
    options: { fromLiveMirror?: boolean } = {},
  ) {
    return patchRuntime(
      (runtime) => {
        const nextFrame = {
          ...frame,
          updatedAt: Date.now(),
        };
        return {
          ...runtime,
          frame: nextFrame,
          latestFrame: nextFrame,
          status:
            options.fromLiveMirror &&
            (runtime.status === 'waiting' || runtime.status === 'paused')
              ? runtime.status
              : 'running',
          updatedAt: Date.now(),
        };
      },
      'runtime.frame',
      'Frame updated',
    );
  }

  static output(output: Omit<ComputerRuntimeOutput, 'kind' | 'updatedAt'>) {
    return patchRuntime(
      (runtime) =>
        appendEvent(
          {
            ...runtime,
            mode: 'terminal',
            surface: 'terminal',
            subtitle: 'Terminal',
            display: output.command || runtime.display,
            cwd: output.cwd || runtime.cwd,
            status: output.failed ? 'failed' : 'running',
            terminal: {
              kind: 'terminal',
              ...output,
              updatedAt: Date.now(),
            },
            latestOutput: {
              kind: 'terminal',
              ...output,
              updatedAt: Date.now(),
            },
            updatedAt: Date.now(),
          },
          'runtime.output',
          output.failed ? 'Command failed' : 'Command output updated',
        ),
    );
  }

  static complete(activity = 'Task completed') {
    return this.update({
      status: 'completed',
      activity,
      takeoverEnabled: false,
    });
  }

  static fail(activity = 'Task failed') {
    return this.update({
      status: 'failed',
      activity,
      takeoverEnabled: false,
    });
  }

  static setTakeover(enabled: boolean) {
    const updated = this.update({ takeoverEnabled: enabled });
    if (updated?.mode === 'browser') {
      void embeddedBrowserRuntime.setInteractionBlocked(!enabled);
      if (enabled) {
        embeddedBrowserRuntime.focus();
      }
    }
    return updated;
  }

  static updateBrowserState(
    browser: NonNullable<ComputerRuntimeState['browser']>,
  ) {
    return patchRuntime((runtime) => ({
      ...runtime,
      mode: 'browser',
      surface: 'native_browser',
      subtitle: 'Browser',
      display: browser.url || runtime.display,
      currentUrl: browser.url || runtime.currentUrl,
      browser,
      status: runtime.status === 'starting' ? 'running' : runtime.status,
      updatedAt: Date.now(),
    }));
  }

  static setSurfaceBounds(bounds: ComputerSurfaceBounds) {
    embeddedBrowserRuntime.setBounds(bounds);
  }

  static setSurfaceVisible(visible: boolean) {
    embeddedBrowserRuntime.setVisible(visible);
  }

  static reset() {
    localDesktopMirror.stop();
    void embeddedBrowserRuntime.setInteractionBlocked(true);
    embeddedBrowserRuntime.destroy();
    store.setState({ computerRuntime: null });
  }
}

embeddedBrowserRuntime.setHandlers({
  onBrowserState: (browser) => {
    ComputerRuntimeController.updateBrowserState(browser);
  },
  onFailure: (message) => {
    ComputerRuntimeController.fail(message);
  },
});
