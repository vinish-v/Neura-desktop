/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Key, keyboard } from '@computer-use/nut-js';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import {
  type ScreenshotOutput,
  type ExecuteParams,
  type ExecuteOutput,
  StatusEnum,
} from '@neura-desktop/sdk/core';
import { NutJSOperator } from '@neura-desktop/operator-nut-js';
import { clipboard } from 'electron';
import { desktopCapturer } from 'electron';

import * as env from '@main/env';
import { logger } from '@main/logger';
import { sleep } from '@neura-desktop/shared/utils';
import { getScreenSize } from '@main/utils/screen';
import {
  executeNativeComputerTool,
  isNativeComputerTool,
} from '@main/services/nativeComputerTools';
import { requestUserApproval } from '@main/services/approvalGate';
import { ComputerRuntimeController } from '@main/services/computerRuntimeController';
import {
  NATIVE_COMPUTER_TOOLS,
  nativeToolPrompt,
} from '@main/shared/toolRegistry';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const MAX_COMMAND_OUTPUT_LENGTH = 12_000;

const isDangerousCommand = (command: string) => {
  const normalized = command.replace(/\s+/g, ' ').trim().toLowerCase();

  return [
    /\brm\s+-rf\b/,
    /\brmdir\s+\/s\b/,
    /\bdel\s+\/[sq]\b/,
    /\bformat\b/,
    /\bshutdown\b/,
    /\brestart-computer\b/,
    /\bstop-computer\b/,
    /\bgit\s+reset\s+--hard\b/,
    /\bremove-item\b.*\b-recurse\b/,
  ].some((pattern) => pattern.test(normalized));
};

const truncateOutput = (value: string) =>
  value.length > MAX_COMMAND_OUTPUT_LENGTH
    ? `${value.slice(0, MAX_COMMAND_OUTPUT_LENGTH)}\n\n[Output truncated after ${MAX_COMMAND_OUTPUT_LENGTH} characters.]`
    : value;

export class NutJSElectronOperator extends NutJSOperator {
  static MANUAL = {
    ACTION_SPACES: [
      `click(start_box='[x1, y1, x2, y2]')`,
      `left_double(start_box='[x1, y1, x2, y2]')`,
      `right_single(start_box='[x1, y1, x2, y2]')`,
      `drag(start_box='[x1, y1, x2, y2]', end_box='[x3, y3, x4, y4]')`,
      `hotkey(key='')`,
      `type(content='') #If you want to submit your input, use "\\n" at the end of \`content\`.`,
      nativeToolPrompt(NATIVE_COMPUTER_TOOLS),
      `run_command(command='', cwd='') # Run an explicit local shell command and return stdout/stderr. Use only when the user asks to run a command or terminal task.`,
      `scroll(start_box='[x1, y1, x2, y2]', direction='down or up or right or left')`,
      `wait() #Sleep for 5s and take a screenshot to check for any changes.`,
      `finished(content='') # Submit the final answer to the user when the task is complete.`,
      `call_user() # Submit the task and call the user when the task is unsolvable, or when you need the user's help.`,
    ],
  };

  public async screenshot(): Promise<ScreenshotOutput> {
    const {
      physicalSize,
      logicalSize,
      scaleFactor,
      id: primaryDisplayId,
    } = getScreenSize(); // Logical = Physical / scaleX

    logger.info(
      '[screenshot] [primaryDisplay]',
      'logicalSize:',
      logicalSize,
      'scaleFactor:',
      scaleFactor,
    );

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(logicalSize.width),
        height: Math.round(logicalSize.height),
      },
    });
    const primarySource =
      sources.find(
        (source) => source.display_id === primaryDisplayId.toString(),
      ) || sources[0];

    if (!primarySource) {
      logger.error('[screenshot] Primary display source not found', {
        primaryDisplayId,
        availableSources: sources.map((s) => s.display_id),
      });
      // fallback to default screenshot
      return await super.screenshot();
    }

    const screenshot = primarySource.thumbnail;

    const resized = screenshot.resize({
      width: physicalSize.width,
      height: physicalSize.height,
    });

    ComputerRuntimeController.frame({
      mime: 'image/jpeg',
      width: physicalSize.width,
      height: physicalSize.height,
      scaleFactor,
    });

    return {
      base64: resized.toJPEG(75).toString('base64'),
      scaleFactor,
    };
  }

  async execute(params: ExecuteParams): Promise<ExecuteOutput> {
    const { action_type, action_inputs } = params.parsedPrediction;

    if (isNativeComputerTool(action_type)) {
      return executeNativeComputerTool(action_type, action_inputs);
    }

    if (action_type === 'run_command') {
      return this.runCommand(action_inputs?.command, action_inputs?.cwd);
    }

    if (action_type === 'type' && env.isWindows && action_inputs?.content) {
      const content = action_inputs.content?.trim();

      logger.info('[device] type', content);
      const stripContent = content.replace(/\\n$/, '').replace(/\n$/, '');
      const originalClipboard = clipboard.readText();
      clipboard.writeText(stripContent);
      await keyboard.pressKey(Key.LeftControl, Key.V);
      await sleep(50);
      await keyboard.releaseKey(Key.LeftControl, Key.V);
      await sleep(50);
      clipboard.writeText(originalClipboard);
    } else {
      return await super.execute(params);
    }
  }

  private async runCommand(
    command: string | undefined,
    cwd: string | undefined,
  ): Promise<ExecuteOutput> {
    const trimmedCommand = command?.trim();
    if (!trimmedCommand) {
      return {
        status: StatusEnum.END,
        message:
          'No command was provided. Ask me to run a specific command, for example `run command: npm test`.',
      };
    }

    if (isDangerousCommand(trimmedCommand)) {
      const approved = await requestUserApproval({
        action: 'run_command_destructive_command',
        target: trimmedCommand,
        risk: 'high',
      });
      if (!approved) {
        return {
          status: StatusEnum.USER_STOPPED,
          message: `Command was denied by the user:\n\n\`${trimmedCommand}\``,
        };
      }
    }

    const start = Date.now();
    logger.info('[command] run', {
      command: trimmedCommand,
      cwd: cwd || process.cwd(),
    });

    try {
      const execOptions = {
        cwd: cwd?.trim() || process.cwd(),
        timeout: 120_000,
        maxBuffer: 1024 * 1024 * 4,
        windowsHide: true,
      };
      const { stdout, stderr } = env.isWindows
        ? await execFileAsync(
            'powershell.exe',
            [
              '-NoProfile',
              '-NonInteractive',
              '-ExecutionPolicy',
              'Bypass',
              '-Command',
              trimmedCommand,
            ],
            execOptions,
          )
        : await execAsync(trimmedCommand, execOptions);
      const duration = Date.now() - start;
      ComputerRuntimeController.output({
        command: trimmedCommand,
        cwd: execOptions.cwd,
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
        failed: false,
      });
      const output = [
        `Command completed in ${duration}ms:`,
        `\`${trimmedCommand}\``,
        stdout ? `\nstdout:\n${truncateOutput(stdout.trimEnd())}` : '',
        stderr ? `\nstderr:\n${truncateOutput(stderr.trimEnd())}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      return {
        status: StatusEnum.END,
        message: output || `Command completed: \`${trimmedCommand}\``,
      };
    } catch (error) {
      const err = error as {
        message?: string;
        stdout?: string;
        stderr?: string;
        code?: number | string;
      };
      ComputerRuntimeController.output({
        command: trimmedCommand,
        cwd: cwd?.trim() || process.cwd(),
        stdout: err.stdout?.trimEnd(),
        stderr: err.stderr?.trimEnd() || err.message,
        failed: true,
      });
      return {
        status: StatusEnum.ERROR,
        message: [
          `Command failed${err.code !== undefined ? ` with exit code ${err.code}` : ''}:`,
          `\`${trimmedCommand}\``,
          err.stdout
            ? `\nstdout:\n${truncateOutput(err.stdout.trimEnd())}`
            : '',
          err.stderr
            ? `\nstderr:\n${truncateOutput(err.stderr.trimEnd())}`
            : '',
          !err.stdout && !err.stderr && err.message
            ? `\nerror:\n${err.message}`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
      };
    }
  }
}
