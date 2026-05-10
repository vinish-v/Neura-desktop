/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs/promises';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type QuickLocalTaskResult = {
  handled: boolean;
  message?: string;
};

const CREATE_FOLDER_PATTERN =
  /\b(create|make|new|mkdir)\b.*\b(folder|directory|dir)\b|\bmkdir\b/i;

const VERSION_COMMANDS = [
  {
    name: 'Python',
    pattern: /\bpython\b/i,
    command: 'python',
    args: ['--version'],
  },
  {
    name: 'Node.js',
    pattern: /\bnode(?:\.js)?\b/i,
    command: 'node',
    args: ['--version'],
  },
  {
    name: 'npm',
    pattern: /\bnpm\b/i,
    command: 'npm',
    args: ['--version'],
  },
  {
    name: 'Git',
    pattern: /\bgit\b/i,
    command: 'git',
    args: ['--version'],
  },
  {
    name: 'Java',
    pattern: /\bjava\b/i,
    command: 'java',
    args: ['-version'],
  },
];

const VERSION_CHECK_PATTERN =
  /\b(check|get|show|tell me)\b.*\b(version|installed)\b|\bversion\b/i;

const cleanName = (value: string) =>
  value
    .replace(/\b(on|in|at)\s+(my\s+)?(desktop|downloads|documents)\b.*$/i, '')
    .replace(/^(called|named|name|names|as)\s+/i, '')
    .trim()
    .replace(/^["'`]|["'`]$/g, '');

const knownFolder = (instructions: string) => {
  const oneDriveRoots = [
    process.env.OneDrive,
    process.env.OneDriveConsumer,
    process.env.OneDriveCommercial,
    process.env.USERPROFILE
      ? path.join(process.env.USERPROFILE, 'OneDrive')
      : undefined,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .filter((value, index, values) => values.indexOf(value) === index);

  const knownPath = (folderName: 'Desktop' | 'Documents' | 'Downloads') => {
    if (process.platform === 'win32' && folderName !== 'Downloads') {
      for (const root of oneDriveRoots) {
        const candidate = path.join(root, folderName);
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
    return path.join(os.homedir(), folderName);
  };

  if (/\bdesktop\b/i.test(instructions)) {
    return knownPath('Desktop');
  }
  if (/\bdownloads?\b/i.test(instructions)) {
    return knownPath('Downloads');
  }
  if (/\bdocuments?\b/i.test(instructions)) {
    return knownPath('Documents');
  }

  return knownPath('Desktop');
};

const extractQuotedValue = (instructions: string) => {
  const match = instructions.match(/["'`]([^"'`]+)["'`]/);
  return match?.[1]?.trim();
};

const extractFolderName = (instructions: string) => {
  const quoted = extractQuotedValue(instructions);
  if (quoted) {
    return quoted;
  }

  const named = instructions.match(
    /\b(?:called|named|name|names|as)\s+([a-z0-9][\w .-]{0,120})/i,
  )?.[1];
  if (named) {
    return cleanName(named);
  }

  const afterFolder = instructions.match(
    /\b(?:folder|directory|dir)\s+(?:called|named|name|names|as)?\s*([a-z0-9][\w .-]{0,120})/i,
  )?.[1];
  if (afterFolder) {
    const name = cleanName(afterFolder);
    if (name && !/^(on|in|at|please)$/i.test(name)) {
      return name;
    }
  }

  return 'New Folder';
};

const resolveTargetPath = (instructions: string) => {
  const folderName = extractFolderName(instructions);
  if (path.isAbsolute(folderName)) {
    return folderName;
  }

  const baseDir = knownFolder(instructions);
  return path.join(baseDir, folderName.replace(/[<>:"/\\|?*]/g, '').trim());
};

const getAvailablePath = async (targetPath: string) => {
  let candidate = targetPath;
  const parent = path.dirname(targetPath);
  const ext = path.extname(targetPath);
  const base = path.basename(targetPath, ext);
  let index = 1;

  while (true) {
    try {
      await fs.access(candidate);
      candidate = path.join(parent, `${base} (${index})${ext}`);
      index += 1;
    } catch {
      return candidate;
    }
  }
};

const runVersionCheck = async (instructions: string) => {
  if (!VERSION_CHECK_PATTERN.test(instructions)) {
    return null;
  }

  const tool = VERSION_COMMANDS.find((item) => item.pattern.test(instructions));
  if (!tool) {
    return null;
  }

  try {
    const { stdout, stderr } = await execFileAsync(tool.command, tool.args, {
      timeout: 15_000,
      windowsHide: true,
    });
    const output = [stdout, stderr].filter(Boolean).join('\n').trim();

    return {
      handled: true,
      message: [
        'Command completed:',
        `\`${[tool.command, ...tool.args].join(' ')}\``,
        output ? `\nstdout:\n${output}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  } catch (error) {
    const err = error as {
      message?: string;
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };

    return {
      handled: true,
      message: [
        `Command failed${err.code !== undefined ? ` with exit code ${err.code}` : ''}:`,
        `\`${[tool.command, ...tool.args].join(' ')}\``,
        err.stdout ? `\nstdout:\n${err.stdout.trimEnd()}` : '',
        err.stderr ? `\nstderr:\n${err.stderr.trimEnd()}` : '',
        !err.stdout && !err.stderr && err.message
          ? `\nerror:\n${err.message}`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }
};

export async function runQuickLocalTask(
  instructions: string,
): Promise<QuickLocalTaskResult> {
  const trimmed = instructions.trim();

  const versionCheck = await runVersionCheck(trimmed);
  if (versionCheck) {
    return versionCheck;
  }

  if (!CREATE_FOLDER_PATTERN.test(trimmed)) {
    return { handled: false };
  }

  const targetPath = await getAvailablePath(resolveTargetPath(trimmed));
  await fs.mkdir(targetPath, { recursive: false });

  return {
    handled: true,
    message: `Created folder:\n\`${targetPath}\``,
  };
}
