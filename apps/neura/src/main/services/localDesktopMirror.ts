/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { desktopCapturer } from 'electron';
import { mouse } from '@computer-use/nut-js';

import { logger } from '@main/logger';
import { getScreenSize } from '@main/utils/screen';
import type { ComputerRuntimeFrame } from '@main/store/types';

type FrameHandler = (frame: Omit<ComputerRuntimeFrame, 'updatedAt'>) => void;

const DEFAULT_INTERVAL_MS = 125;
const JPEG_QUALITY = 52;

class LocalDesktopMirrorService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private capturing = false;
  private onFrame: FrameHandler | null = null;
  private intervalMs = DEFAULT_INTERVAL_MS;
  private frameIndex = 0;

  start(onFrame: FrameHandler, intervalMs = DEFAULT_INTERVAL_MS) {
    this.onFrame = onFrame;
    this.intervalMs = intervalMs;
    if (this.running) {
      return;
    }

    this.running = true;
    this.frameIndex = 0;
    void this.capture();
    this.timer = setInterval(() => {
      void this.capture();
    }, this.intervalMs);
  }

  stop() {
    this.running = false;
    this.onFrame = null;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isRunning() {
    return this.running;
  }

  private async capture() {
    if (!this.running || this.capturing || !this.onFrame) {
      return;
    }

    this.capturing = true;
    try {
      const {
        physicalSize,
        logicalSize,
        id: primaryDisplayId,
        scaleFactor,
      } = getScreenSize();
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.round(logicalSize.width),
          height: Math.round(logicalSize.height),
        },
      });
      const source =
        sources.find(
          (item) => item.display_id === primaryDisplayId.toString(),
        ) || sources[0];

      if (!source) {
        return;
      }

      const frame = source.thumbnail.resize({
        width: physicalSize.width,
        height: physicalSize.height,
      });
      let cursor: { x: number; y: number } | undefined;
      try {
        const position = await mouse.getPosition();
        cursor = { x: position.x, y: position.y };
      } catch {
        cursor = undefined;
      }
      const dataUrl = `data:image/jpeg;base64,${frame
        .toJPEG(JPEG_QUALITY)
        .toString('base64')}`;

      this.onFrame({
        dataUrl,
        mime: 'image/jpeg',
        width: physicalSize.width,
        height: physicalSize.height,
        scaleFactor,
        frameIndex: ++this.frameIndex,
        capturedAt: Date.now(),
        streamIntervalMs: this.intervalMs,
        cursor,
        sourceId: source.id,
        sourceName: source.name,
      });
    } catch (error) {
      logger.warn('[LocalDesktopMirror] capture failed', error);
    } finally {
      this.capturing = false;
    }
  }
}

export const localDesktopMirror = new LocalDesktopMirrorService();
