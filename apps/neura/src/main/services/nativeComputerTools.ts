/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  exec,
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { createWriteStream, existsSync } from 'fs';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import { Notification } from 'electron';
import { type ActionInputs, StatusEnum } from '@neura-desktop/shared/types';
import type { ExecuteOutput } from '@neura-desktop/sdk/core';

import * as env from '@main/env';
import { logger } from '@main/logger';
import type { ApprovalEvent, ArtifactKind } from '@main/store/types';
import { SettingStore } from '@main/store/setting';
import { NATIVE_COMPUTER_TOOLS } from '@main/shared/toolRegistry';
import {
  createWebsiteProjectArtifact,
  createWebsiteZipArtifact,
} from './artifactStudio';
import { createRunId, TaskRunRegistry } from './taskRunRegistry';
import { requestUserApproval } from './approvalGate';
import { ComputerRuntimeController } from './computerRuntimeController';
import { store } from '@main/store/create';

const MAX_TEXT_OUTPUT = 12_000;
const MAX_PROCESS_BUFFER = 64_000;
const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

type NativeToolHandler = (inputs: ActionInputs) => Promise<string>;
type ExtendedActionInputs = ActionInputs & {
  title?: string;
  prompt?: string;
  text?: string;
  voice?: string;
  image_path?: string;
  asset_path?: string;
  repository?: string;
  target_path?: string;
  message?: string;
  tool?: string;
  payload?: string;
};

type StartedProcess = {
  id: string;
  command: string;
  cwd: string;
  startedAt: number;
  child: ChildProcessWithoutNullStreams;
  stdout: string;
  stderr: string;
  exitCode?: number | null;
};

type MonitorRecord = {
  id: string;
  url: string;
  intervalMinutes: number;
  watch: 'page' | 'selector' | 'text';
  query?: string;
  notifyOn: 'change';
  active: boolean;
  createdAt: number;
  lastDigest?: string;
  lastCheckedAt?: number;
  lastChangedAt?: number;
  lastStatus?: string;
};

const processes = new Map<string, StartedProcess>();
const monitorTimers = new Map<string, NodeJS.Timeout>();

export const writeProcessInput = (processId: string, input: string) => {
  const record = processes.get(processId);
  if (!record) {
    throw new Error(`No active terminal process found for id ${processId}.`);
  }
  if (record.exitCode !== undefined) {
    throw new Error(`Process ${processId} is no longer running.`);
  }
  record.child.stdin.write(input);
};

const nativeToolNames = new Set(NATIVE_COMPUTER_TOOLS.map((tool) => tool.name));

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

export const isNativeComputerTool = (actionType: string) =>
  nativeToolNames.has(actionType);

export const executeNativeComputerTool = async (
  actionType: string,
  inputs: ActionInputs,
): Promise<ExecuteOutput> => {
  const handler = handlers[actionType];
  if (!handler) {
    return {
      status: StatusEnum.END,
      message: `Unsupported native computer tool: ${actionType}`,
    };
  }

  try {
    syncRuntimeForNativeTool(actionType, inputs);
    const message = await handler(inputs);
    recordNativeToolOutput(actionType, inputs, message, false);
    return {
      status: StatusEnum.END,
      message,
    };
  } catch (error) {
    logger.error('[nativeComputerTool] failed', actionType, error);
    const message = error instanceof Error ? error.message : String(error);
    recordNativeToolOutput(actionType, inputs, message, true);
    const wasDenied = /denied by the user/i.test(message);
    return {
      status: wasDenied ? StatusEnum.USER_STOPPED : StatusEnum.ERROR,
      message: `Native tool failed: ${message}`,
    };
  }
};

const handlers: Record<string, NativeToolHandler> = {
  read_file: readFile,
  write_file: writeFile,
  edit_file: editFile,
  list_dir: listDir,
  file_info: fileInfo,
  create_folder: createFolder,
  copy_file: copyFile,
  move_file: moveFile,
  zip_files: zipFiles,
  unzip_file: unzipFile,
  create_docx: createDocx,
  create_pdf: createPdf,
  create_xlsx: createXlsx,
  create_pptx: createPptx,
  run_command: runCommand,
  start_process: startProcess,
  read_process: readProcess,
  stop_process: stopProcess,
  list_processes: listProcesses,
  create_monitor: createMonitor,
  list_monitors: listMonitors,
  stop_monitor: stopMonitor,
  create_website_project: createWebsiteProject,
  start_website_preview: startWebsitePreview,
  export_website_project: exportWebsiteProject,
  generate_image: generateImage,
  transcribe_audio: transcribeAudio,
  synthesize_speech: synthesizeSpeech,
  analyze_video: analyzeVideo,
  list_connectors: listConnectors,
  connector_github_issue: connectorGithubIssue,
  connector_github_export: connectorGithubExport,
  connector_slack_post: connectorSlackPost,
  connector_drive_export: connectorDriveExport,
  connector_mcp_call: connectorMcpCall,
};

const truncate = (value: string, max = MAX_TEXT_OUTPUT) =>
  value.length > max
    ? `${value.slice(0, max)}\n\n[Output truncated after ${max} characters.]`
    : value;

const terminalNativeTools = new Set([
  'run_command',
  'start_process',
  'read_process',
  'stop_process',
  'list_processes',
]);

const syncRuntimeForNativeTool = (
  actionType: string,
  inputs: ActionInputs,
) => {
  if (!terminalNativeTools.has(actionType)) {
    return;
  }
  if (isDesktopLaunchHelper(actionType, inputs)) {
    ComputerRuntimeController.update({
      status: 'running',
      activity: 'Opening local app',
    });
    return;
  }
  ComputerRuntimeController.start({
    mode: 'terminal',
    subtitle: 'Terminal',
    display: inputs.command || actionType.replace(/_/g, ' '),
    cwd: inputs.cwd,
    activity: getNativeToolActivity(actionType),
  });
};

const isDesktopLaunchHelper = (actionType: string, inputs: ActionInputs) => {
  const runtime = store.getState().computerRuntime;
  const command = inputs.command || '';
  return (
    actionType === 'run_command' &&
    runtime?.mode === 'desktop' &&
    /\bGet-StartApps\b|\bshell:AppsFolder\\|\bLaunch\/focus requested\b/i.test(
      command,
    )
  );
};

const getNativeToolActivity = (actionType: string) => {
  switch (actionType) {
    case 'run_command':
      return 'Running command';
    case 'start_process':
      return 'Starting process';
    case 'read_process':
      return 'Reading process output';
    case 'stop_process':
      return 'Stopping process';
    case 'list_processes':
      return 'Listing processes';
    default:
      return 'Running terminal task';
  }
};

const extractBlock = (message: string, label: 'stdout' | 'stderr') =>
  message
    .match(
      new RegExp(
        `\\n${label}:\\n([\\s\\S]*?)(?:\\n\\n(?:stdout|stderr):|$)`,
        'i',
      ),
    )?.[1]
    ?.trim();

const recordNativeToolOutput = (
  actionType: string,
  inputs: ActionInputs,
  message: string,
  failed: boolean,
) => {
  if (!terminalNativeTools.has(actionType)) {
    return;
  }
  if (isDesktopLaunchHelper(actionType, inputs)) {
    ComputerRuntimeController.update({
      status: failed ? 'failed' : 'running',
      activity: failed ? 'Could not open local app' : 'Local app launch requested',
    });
    return;
  }

  const command =
    inputs.command ||
    message.match(/^Command:\s*(.+)$/im)?.[1]?.trim() ||
    message.match(/^Process:\s*(.+)$/im)?.[1]?.trim() ||
    actionType.replace(/_/g, ' ');
  const cwd = inputs.cwd || message.match(/^CWD:\s*(.+)$/im)?.[1]?.trim();
  const stdout = extractBlock(message, 'stdout');
  const stderr = extractBlock(message, 'stderr');

  ComputerRuntimeController.output({
    command,
    cwd,
    stdout,
    stderr,
    raw: stdout || stderr ? undefined : message,
    failed,
  });
};

const POWERSHELL_ERROR_PATTERN =
  /\b(ParserError|ParameterBindingException|CommandNotFoundException|FullyQualifiedErrorId|CategoryInfo|Cannot bind parameter|CannotConvertArgument|not recognized as|is not recognized|At line:\d+ char:\d+)\b/i;

const assertNoCommandError = ({
  command,
  stdout,
  stderr,
}: {
  command: string;
  stdout: string;
  stderr: string;
}) => {
  const combined = `${stderr}\n${stdout}`;
  if (env.isWindows && POWERSHELL_ERROR_PATTERN.test(combined)) {
    throw new Error(
      [
        'Command failed:',
        `Command: ${command}`,
        stdout ? `stdout:\n${truncate(stdout.trimEnd())}` : '',
        stderr ? `stderr:\n${truncate(stderr.trimEnd())}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
};

const formatCommandFailure = (
  command: string,
  error: unknown,
  stdout = '',
  stderr = '',
) =>
  [
    'Command failed:',
    `Command: ${command}`,
    stdout ? `stdout:\n${truncate(stdout.trimEnd())}` : '',
    stderr ? `stderr:\n${truncate(stderr.trimEnd())}` : '',
    !stdout && !stderr
      ? error instanceof Error
        ? error.message
        : String(error)
      : '',
  ]
    .filter(Boolean)
    .join('\n');

const asBool = (value?: string) =>
  ['true', 'yes', '1'].includes((value || '').trim().toLowerCase());

const requireInput = (value: string | undefined, name: string) => {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${name} is required.`);
  }
  return trimmed;
};

const resolveLocalPath = (rawPath: string | undefined) => {
  const value = requireInput(rawPath, 'path');
  const expanded =
    value === '~' || value.startsWith(`~${path.sep}`)
      ? path.join(os.homedir(), value.slice(2))
      : value;
  return path.resolve(expanded);
};

const isSuspiciousWritePath = (targetPath: string) => {
  const parsed = path.parse(targetPath);
  const normalized = targetPath.toLowerCase();
  const protectedPrefixes = [
    path.resolve(os.homedir()).toLowerCase(),
    'c:\\windows',
    'c:\\program files',
    'c:\\program files (x86)',
    '/bin',
    '/sbin',
    '/usr',
    '/etc',
    '/system',
  ];

  return (
    targetPath === parsed.root ||
    protectedPrefixes.some((prefix) => normalized === prefix)
  );
};

const assertSafeWritePath = async (
  targetPath: string,
  overwrite = false,
  label = 'destination',
) => {
  if (isSuspiciousWritePath(targetPath)) {
    throw new Error(`Blocked suspicious ${label} path: ${targetPath}`);
  }
  if (!overwrite && existsSync(targetPath)) {
    throw new Error(
      `${label} already exists: ${targetPath}. Ask with overwrite=true or choose a new path.`,
    );
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
};

const requireApproval = async (
  action: string,
  target: string,
  risk: ApprovalEvent['risk'] = 'high',
) => {
  const approved = await requestUserApproval({ action, target, risk });
  if (!approved) {
    throw new Error(`${action} was denied by the user.`);
  }
};

const approveOverwrite = async (
  action: string,
  targetPath: string,
  overwrite: boolean,
) => {
  if (overwrite && existsSync(targetPath)) {
    await requireApproval(action, targetPath, 'high');
  }
};

const addActiveArtifact = ({
  title,
  kind,
  filePath,
  mimeType,
  previewPath,
}: {
  title: string;
  kind: ArtifactKind;
  filePath: string;
  mimeType?: string;
  previewPath?: string;
}) => {
  const runId = TaskRunRegistry.getActiveRunId();
  if (!runId) {
    return;
  }
  TaskRunRegistry.addArtifact(runId, {
    id: `artifact_${Date.now()}_${randomUUID().slice(0, 8)}`,
    title,
    kind,
    mimeType,
    path: filePath,
    previewPath,
    createdAt: Date.now(),
  });
};

const mimeTypeForPath = (filePath: string) => {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.csv': 'text/csv',
    '.docx':
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.html': 'text/html',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.json': 'application/json',
    '.md': 'text/markdown',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.pptx':
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.txt': 'text/plain',
    '.wav': 'audio/wav',
    '.xlsx':
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.zip': 'application/zip',
  };
  return map[ext];
};

const parsePathList = (rawPaths: string | undefined) => {
  const value = requireInput(rawPaths, 'paths');
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => resolveLocalPath(String(item)));
    }
  } catch {
    // Fall through to separator parsing.
  }
  return value
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => resolveLocalPath(item));
};

const splitArgs = (value = '') =>
  Array.from(value.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)).map(
    (match) => match[1] ?? match[2] ?? match[3] ?? '',
  );

const parseEnv = (value = '') => {
  if (!value.trim()) {
    return {};
  }
  const parsed = JSON.parse(value) as Record<string, string>;
  return Object.fromEntries(
    Object.entries(parsed).map(([key, item]) => [key, String(item)]),
  );
};

const currentEnv = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );

async function readFile(inputs: ActionInputs) {
  const targetPath = resolveLocalPath(inputs.path);
  const ext = path.extname(targetPath).toLowerCase();

  if (ext === '.docx') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ path: targetPath });
    return `Read DOCX ${targetPath}:\n\n${truncate(result.value.trim())}`;
  }

  if (ext === '.pdf') {
    const pdfParseModule = await import('pdf-parse');
    const pdfParse =
      (
        pdfParseModule as {
          default?: (buffer: Buffer) => Promise<{ text: string }>;
        }
      ).default ||
      (pdfParseModule as unknown as (
        buffer: Buffer,
      ) => Promise<{ text: string }>);
    const buffer = await fs.readFile(targetPath);
    const result = await pdfParse(buffer);
    return `Read PDF ${targetPath}:\n\n${truncate(result.text.trim())}`;
  }

  const content = await fs.readFile(targetPath, 'utf8');
  return `Read file ${targetPath}:\n\n${truncate(content)}`;
}

async function writeFile(inputs: ActionInputs) {
  const targetPath = resolveLocalPath(inputs.path);
  const overwrite = asBool(inputs.overwrite);
  await approveOverwrite('write_file_overwrite', targetPath, overwrite);
  await assertSafeWritePath(targetPath, overwrite);
  await fs.writeFile(targetPath, inputs.content || '', 'utf8');
  addActiveArtifact({
    title: path.basename(targetPath),
    kind: 'document',
    filePath: targetPath,
    mimeType: mimeTypeForPath(targetPath),
  });
  return `Created file: ${targetPath}`;
}

async function editFile(inputs: ActionInputs) {
  const targetPath = resolveLocalPath(inputs.path);
  const query = requireInput(inputs.query, 'query');
  const replacement = inputs.content || '';
  const original = await fs.readFile(targetPath, 'utf8');
  const count = original.split(query).length - 1;
  if (count < 1) {
    throw new Error(`Exact text was not found in ${targetPath}.`);
  }
  await requireApproval('edit_file', targetPath, 'high');
  await fs.writeFile(
    targetPath,
    original.split(query).join(replacement),
    'utf8',
  );
  return `Edited ${targetPath}. Replaced ${count} occurrence${count === 1 ? '' : 's'}.`;
}

async function listDir(inputs: ActionInputs) {
  const targetPath = resolveLocalPath(inputs.path || process.cwd());
  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  const rows = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(targetPath, entry.name);
      const stats = await fs.stat(entryPath);
      return `${entry.isDirectory() ? 'dir ' : 'file'}\t${stats.size}\t${stats.mtime.toISOString()}\t${entry.name}`;
    }),
  );
  return `Directory listing for ${targetPath}:\n\n${rows.join('\n') || '(empty)'}`;
}

async function fileInfo(inputs: ActionInputs) {
  const targetPath = resolveLocalPath(inputs.path);
  const stats = await fs.stat(targetPath);
  return [
    `Path: ${targetPath}`,
    `Type: ${stats.isDirectory() ? 'directory' : 'file'}`,
    `Size: ${stats.size} bytes`,
    `Modified: ${stats.mtime.toISOString()}`,
    `Created: ${stats.birthtime.toISOString()}`,
  ].join('\n');
}

async function createFolder(inputs: ActionInputs) {
  const targetPath = resolveLocalPath(inputs.path);
  if (isSuspiciousWritePath(targetPath)) {
    throw new Error(`Blocked suspicious folder path: ${targetPath}`);
  }
  await fs.mkdir(targetPath, { recursive: true });
  return `Created folder: ${targetPath}`;
}

async function copyFile(inputs: ActionInputs) {
  const sourcePath = resolveLocalPath(inputs.path);
  const outputPath = resolveLocalPath(inputs.output_path);
  const overwrite = asBool(inputs.overwrite);
  await approveOverwrite('copy_file_overwrite', outputPath, overwrite);
  await assertSafeWritePath(outputPath, overwrite, 'output_path');
  const stats = await fs.stat(sourcePath);
  if (stats.isDirectory()) {
    await fs.cp(sourcePath, outputPath, { recursive: true, force: overwrite });
  } else {
    await fs.copyFile(sourcePath, outputPath);
  }
  return `Copied ${sourcePath} to ${outputPath}`;
}

async function moveFile(inputs: ActionInputs) {
  const sourcePath = resolveLocalPath(inputs.path);
  const outputPath = resolveLocalPath(inputs.output_path);
  const overwrite = asBool(inputs.overwrite);
  await requireApproval('move_file', `${sourcePath} -> ${outputPath}`, 'high');
  await approveOverwrite('move_file_overwrite', outputPath, overwrite);
  await assertSafeWritePath(outputPath, overwrite, 'output_path');
  await fs.rename(sourcePath, outputPath);
  return `Moved ${sourcePath} to ${outputPath}`;
}

async function zipFiles(inputs: ActionInputs) {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const sourcePaths = parsePathList(inputs.paths);
  const outputPath = resolveLocalPath(inputs.output_path);
  const overwrite = asBool(inputs.overwrite);
  await approveOverwrite('zip_files_overwrite', outputPath, overwrite);
  await assertSafeWritePath(outputPath, overwrite, 'output_path');

  const addPath = async (sourcePath: string, archiveName: string) => {
    const stats = await fs.stat(sourcePath);
    if (stats.isDirectory()) {
      const entries = await fs.readdir(sourcePath);
      for (const entry of entries) {
        await addPath(
          path.join(sourcePath, entry),
          path.join(archiveName, entry),
        );
      }
      return;
    }
    zip.file(archiveName.replace(/\\/g, '/'), await fs.readFile(sourcePath));
  };

  for (const sourcePath of sourcePaths) {
    await addPath(sourcePath, path.basename(sourcePath));
  }

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  await fs.writeFile(outputPath, buffer);
  addActiveArtifact({
    title: path.basename(outputPath),
    kind: 'archive',
    filePath: outputPath,
    mimeType: 'application/zip',
  });
  return `Created zip archive: ${outputPath}`;
}

async function unzipFile(inputs: ActionInputs) {
  const JSZip = (await import('jszip')).default;
  const sourcePath = resolveLocalPath(inputs.path);
  const outputPath = resolveLocalPath(inputs.output_path);
  if (isSuspiciousWritePath(outputPath)) {
    throw new Error(`Blocked suspicious output_path: ${outputPath}`);
  }
  await fs.mkdir(outputPath, { recursive: true });

  const zip = await JSZip.loadAsync(await fs.readFile(sourcePath));
  const overwrite = asBool(inputs.overwrite);
  if (overwrite) {
    await requireApproval('unzip_file_overwrite', outputPath, 'high');
  }
  await Promise.all(
    Object.values(zip.files).map(async (entry) => {
      const entryPath = path.resolve(outputPath, entry.name);
      if (!entryPath.startsWith(outputPath)) {
        throw new Error(`Blocked unsafe zip entry path: ${entry.name}`);
      }
      if (entry.dir) {
        await fs.mkdir(entryPath, { recursive: true });
        return;
      }
      await assertSafeWritePath(entryPath, overwrite, 'zip entry');
      await fs.writeFile(entryPath, await entry.async('nodebuffer'));
    }),
  );
  return `Extracted ${sourcePath} to ${outputPath}`;
}

async function createDocx(inputs: ActionInputs) {
  const targetPath = resolveLocalPath(inputs.path);
  const overwrite = asBool(inputs.overwrite);
  await approveOverwrite('create_docx_overwrite', targetPath, overwrite);
  await assertSafeWritePath(targetPath, overwrite);
  const docx = await import('docx');
  const paragraphs = (inputs.content || ' ').split(/\r?\n/).map(
    (line) =>
      new docx.Paragraph({
        text: line.replace(/^#+\s*/, '') || ' ',
        heading: line.startsWith('# ')
          ? docx.HeadingLevel.HEADING_1
          : undefined,
      }),
  );
  const document = new docx.Document({
    sections: [{ children: paragraphs }],
  });
  await fs.writeFile(targetPath, await docx.Packer.toBuffer(document));
  addActiveArtifact({
    title: path.basename(targetPath),
    kind: 'document',
    filePath: targetPath,
    mimeType: mimeTypeForPath(targetPath),
  });
  return `Created Word document: ${targetPath}`;
}

async function createPdf(inputs: ActionInputs) {
  const targetPath = resolveLocalPath(inputs.path);
  const overwrite = asBool(inputs.overwrite);
  await approveOverwrite('create_pdf_overwrite', targetPath, overwrite);
  await assertSafeWritePath(targetPath, overwrite);
  const PDFDocument = (await import('pdfkit')).default;
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 56 });
    const stream = createWriteStream(targetPath);
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.on('error', reject);
    doc.pipe(stream);
    for (const paragraph of (inputs.content || '').split(/\n{2,}/)) {
      doc.fontSize(12).text(paragraph.trim() || ' ', { lineGap: 4 });
      doc.moveDown();
    }
    doc.end();
  });
  addActiveArtifact({
    title: path.basename(targetPath),
    kind: 'document',
    filePath: targetPath,
    mimeType: 'application/pdf',
  });
  return `Created PDF: ${targetPath}`;
}

async function createXlsx(inputs: ActionInputs) {
  const targetPath = resolveLocalPath(inputs.path);
  const overwrite = asBool(inputs.overwrite);
  await approveOverwrite('create_xlsx_overwrite', targetPath, overwrite);
  await assertSafeWritePath(targetPath, overwrite);
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Sheet1');
  const content = inputs.content || '';

  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      worksheet.addRows(
        parsed.map((row) =>
          Array.isArray(row)
            ? row
            : Object.values(row as Record<string, unknown>),
        ),
      );
      if (parsed[0] && !Array.isArray(parsed[0])) {
        worksheet.insertRow(1, Object.keys(parsed[0]));
      }
    }
  } catch {
    const separator = content.includes('\t') ? '\t' : ',';
    for (const line of content.split(/\r?\n/).filter(Boolean)) {
      worksheet.addRow(line.split(separator).map((cell) => cell.trim()));
    }
  }

  if (worksheet.rowCount === 0) {
    worksheet.addRow(['Content']);
    worksheet.addRow([content]);
  }

  await workbook.xlsx.writeFile(targetPath);
  addActiveArtifact({
    title: path.basename(targetPath),
    kind: 'spreadsheet',
    filePath: targetPath,
    mimeType: mimeTypeForPath(targetPath),
  });
  return `Created spreadsheet: ${targetPath}`;
}

async function createPptx(inputs: ActionInputs) {
  const extra = inputs as ExtendedActionInputs;
  const targetPath = resolveLocalPath(inputs.path);
  const overwrite = asBool(inputs.overwrite);
  await approveOverwrite('create_pptx_overwrite', targetPath, overwrite);
  await assertSafeWritePath(targetPath, overwrite);
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';

  const slides = (inputs.content || 'Untitled')
    .split(/\n---+\n/)
    .map((slide) => slide.trim())
    .filter(Boolean);
  const imagePath = extra.image_path?.trim()
    ? resolveLocalPath(extra.image_path)
    : undefined;

  for (const [index, slideText] of slides.entries()) {
    const [title, ...body] = slideText.split(/\r?\n/);
    const slide = pptx.addSlide();
    slide.background = { color: '111111' };
    slide.addText(title || 'Untitled', {
      x: 0.7,
      y: 0.5,
      w: 11.8,
      h: 0.6,
      color: 'FFFFFF',
      fontSize: 30,
      bold: true,
    });
    slide.addText(body.join('\n') || ' ', {
      x: 0.8,
      y: 1.4,
      w: imagePath && index === 0 ? 5.8 : 11,
      h: 5,
      color: 'D7D7D7',
      fontSize: 18,
      breakLine: false,
      fit: 'shrink',
    });
    if (imagePath && index === 0) {
      slide.addImage({
        path: imagePath,
        x: 7.1,
        y: 1.45,
        w: 5,
        h: 3.6,
      });
    }
  }

  await pptx.writeFile({ fileName: targetPath });
  addActiveArtifact({
    title: path.basename(targetPath),
    kind: 'presentation',
    filePath: targetPath,
    mimeType: mimeTypeForPath(targetPath),
  });
  return `Created PowerPoint deck: ${targetPath}`;
}

async function createWebsiteProject(inputs: ActionInputs) {
  const extra = inputs as ExtendedActionInputs;
  const title = extra.title?.trim() || 'Neura Website';
  const prompt = extra.prompt?.trim() || inputs.content || title;
  const assetPath = extra.asset_path?.trim()
    ? resolveLocalPath(extra.asset_path)
    : undefined;
  if (inputs.path?.trim()) {
    const targetPath = resolveLocalPath(inputs.path);
    const overwrite = asBool(inputs.overwrite);
    await approveOverwrite(
      'create_website_project_overwrite',
      targetPath,
      overwrite,
    );
    await assertSafeWritePath(targetPath, overwrite);
    await fs.mkdir(path.join(targetPath, 'src'), { recursive: true });
    let mediaImport = '';
    let mediaMarkup = '';
    if (assetPath) {
      const mediaDir = path.join(targetPath, 'public', 'media');
      await fs.mkdir(mediaDir, { recursive: true });
      const mediaName = path.basename(assetPath);
      await fs.copyFile(assetPath, path.join(mediaDir, mediaName));
      const mediaUrl = `/media/${mediaName.replace(/\\/g, '/')}`;
      const mediaType = mimeTypeForPath(assetPath) || '';
      if (mediaType.startsWith('image/')) {
        mediaMarkup = `<img className="media" src="${mediaUrl}" alt="Generated media artifact" />`;
      } else if (mediaType.startsWith('audio/')) {
        mediaMarkup = `<audio className="media" src="${mediaUrl}" controls />`;
      } else if (mediaType.startsWith('video/')) {
        mediaMarkup = `<video className="media" src="${mediaUrl}" controls />`;
      }
      if (mediaMarkup) {
        mediaImport =
          '\n      <section className="mediaPanel">\n        ' +
          mediaMarkup +
          '\n      </section>';
      }
    }
    await fs.writeFile(
      path.join(targetPath, 'package.json'),
      JSON.stringify(
        {
          scripts: {
            dev: 'vite --host 127.0.0.1',
            build: 'vite build',
            preview: 'vite preview --host 127.0.0.1',
          },
          dependencies: {
            '@vitejs/plugin-react': '^4.3.4',
            vite: '^6.1.0',
            react: '^18.3.1',
            'react-dom': '^18.3.1',
            typescript: '^5.7.2',
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    await fs.writeFile(
      path.join(targetPath, 'index.html'),
      '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
      'utf8',
    );
    await fs.writeFile(
      path.join(targetPath, 'src', 'main.tsx'),
      "import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport './styles.css';\nimport App from './App';\n\ncreateRoot(document.getElementById('root')!).render(<App />);\n",
      'utf8',
    );
    await fs.writeFile(
      path.join(targetPath, 'src', 'App.tsx'),
      `export default function App() {\n  return <main><h1>${title}</h1><p>${prompt}</p>${mediaImport}</main>;\n}\n`,
      'utf8',
    );
    await fs.writeFile(
      path.join(targetPath, 'src', 'styles.css'),
      'body{margin:0;font-family:Inter,Arial,sans-serif;background:#f8fafc;color:#0f172a}main{padding:64px 8vw}h1{font-size:56px;line-height:1}.mediaPanel{margin-top:32px;max-width:880px}.media{display:block;max-width:100%;border-radius:8px;border:1px solid #d7dee8;background:#fff}',
      'utf8',
    );
    addActiveArtifact({
      title,
      kind: 'website',
      filePath: targetPath,
      mimeType: 'application/vnd.neura.website-project',
    });
    return `Created website project: ${targetPath}`;
  }

  const artifact = await createWebsiteProjectArtifact(
    createRunId(),
    title,
    prompt,
  );
  return `Created website project artifact: ${artifact.path}`;
}

async function generateImage(inputs: ActionInputs) {
  const extra = inputs as ExtendedActionInputs;
  const prompt = requireInput(extra.prompt || inputs.content, 'prompt');
  const provider = SettingStore.get('multimodalProviders')?.image;
  if (!provider?.baseUrl || !provider.apiKey || !provider.model) {
    throw new Error(
      'Image provider is not configured. Add multimodalProviders.image settings before using generate_image.',
    );
  }
  if (inputs.path?.trim()) {
    const targetPath = resolveLocalPath(inputs.path);
    const overwrite = asBool(inputs.overwrite);
    await approveOverwrite('generate_image_overwrite', targetPath, overwrite);
    await assertSafeWritePath(targetPath, overwrite);
    const response = await fetch(
      `${provider.baseUrl.replace(/\/$/, '')}/images/generations`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${provider.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: provider.model,
          prompt,
          size: '1024x1024',
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`Image provider failed with HTTP ${response.status}.`);
    }
    const result = (await response.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };
    const image = result.data?.[0];
    if (image?.b64_json) {
      await fs.writeFile(targetPath, Buffer.from(image.b64_json, 'base64'));
      addActiveArtifact({
        title: extra.title?.trim() || path.basename(targetPath),
        kind: 'image',
        filePath: targetPath,
        mimeType: mimeTypeForPath(targetPath),
        previewPath: targetPath,
      });
      return `Generated image: ${targetPath}`;
    }
    if (image?.url) {
      const imageResponse = await fetch(image.url);
      if (!imageResponse.ok) {
        throw new Error(
          `Image download failed with HTTP ${imageResponse.status}.`,
        );
      }
      await fs.writeFile(
        targetPath,
        Buffer.from(await imageResponse.arrayBuffer()),
      );
      addActiveArtifact({
        title: extra.title?.trim() || path.basename(targetPath),
        kind: 'image',
        filePath: targetPath,
        mimeType: mimeTypeForPath(targetPath),
        previewPath: targetPath,
      });
      return `Generated image: ${targetPath}`;
    }
    throw new Error('Image provider returned no image data.');
  }

  throw new Error('path is required for generate_image.');
}

async function transcribeAudio(inputs: ActionInputs) {
  const extra = inputs as ExtendedActionInputs;
  const provider = SettingStore.get('multimodalProviders')?.speechToText;
  if (!provider?.baseUrl || !provider.apiKey || !provider.model) {
    throw new Error(
      'Speech-to-text provider is not configured. Add multimodalProviders.speechToText settings before using transcribe_audio.',
    );
  }
  const sourcePath = resolveLocalPath(inputs.path);
  const outputPath = resolveLocalPath(
    inputs.output_path || `${sourcePath}.transcript.md`,
  );
  const overwrite = asBool(inputs.overwrite);
  await approveOverwrite('transcribe_audio_overwrite', outputPath, overwrite);
  await assertSafeWritePath(outputPath, overwrite, 'output_path');
  const formData = new FormData();
  formData.append('model', provider.model);
  formData.append(
    'file',
    new Blob([await fs.readFile(sourcePath)]),
    path.basename(sourcePath),
  );
  const response = await fetch(
    `${provider.baseUrl.replace(/\/$/, '')}/audio/transcriptions`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${provider.apiKey}`,
      },
      body: formData,
    },
  );
  if (!response.ok) {
    throw new Error(
      `Speech-to-text provider failed with HTTP ${response.status}.`,
    );
  }
  const raw = await response.text();
  let transcript = raw;
  try {
    const parsed = JSON.parse(raw) as { text?: string };
    transcript = parsed.text || raw;
  } catch {
    // Some compatible providers return plain text.
  }
  await fs.writeFile(
    outputPath,
    [
      '# Audio Transcript',
      '',
      `Source: ${sourcePath}`,
      extra.prompt ? `Prompt: ${extra.prompt}` : '',
      '',
      transcript,
    ]
      .filter(Boolean)
      .join('\n'),
    'utf8',
  );
  addActiveArtifact({
    title: path.basename(outputPath),
    kind: 'document',
    filePath: outputPath,
    mimeType: 'text/markdown',
  });
  return `Transcribed audio to: ${outputPath}`;
}

async function synthesizeSpeech(inputs: ActionInputs) {
  const extra = inputs as ExtendedActionInputs;
  const text = requireInput(extra.text || inputs.content, 'text');
  const provider = SettingStore.get('multimodalProviders')?.textToSpeech;
  if (!provider?.baseUrl || !provider.apiKey || !provider.model) {
    throw new Error(
      'Text-to-speech provider is not configured. Add multimodalProviders.textToSpeech settings before using synthesize_speech.',
    );
  }
  const outputPath = resolveLocalPath(inputs.path || 'speech-output.mp3');
  const overwrite = asBool(inputs.overwrite);
  await approveOverwrite('synthesize_speech_overwrite', outputPath, overwrite);
  await assertSafeWritePath(outputPath, overwrite);
  const response = await fetch(
    `${provider.baseUrl.replace(/\/$/, '')}/audio/speech`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${provider.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: provider.model,
        input: text,
        voice: extra.voice || provider.voice || 'alloy',
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Text-to-speech provider failed with HTTP ${response.status}.`,
    );
  }
  await fs.writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
  addActiveArtifact({
    title: path.basename(outputPath),
    kind: 'audio',
    filePath: outputPath,
    mimeType: mimeTypeForPath(outputPath) || 'audio/mpeg',
  });
  return `Synthesized speech: ${outputPath}`;
}

async function analyzeVideo(inputs: ActionInputs) {
  const extra = inputs as ExtendedActionInputs;
  const provider = SettingStore.get('multimodalProviders')?.video;
  if (!provider?.baseUrl || !provider.apiKey || !provider.model) {
    throw new Error(
      'Video understanding provider is not configured. Add multimodalProviders.video settings before using analyze_video.',
    );
  }
  const sourcePath = resolveLocalPath(inputs.path);
  const outputPath = resolveLocalPath(
    inputs.output_path || `${sourcePath}.analysis.md`,
  );
  const overwrite = asBool(inputs.overwrite);
  await approveOverwrite('analyze_video_overwrite', outputPath, overwrite);
  await assertSafeWritePath(outputPath, overwrite, 'output_path');
  await fs.writeFile(
    outputPath,
    [
      '# Video Analysis',
      '',
      `Source: ${sourcePath}`,
      `Prompt: ${extra.prompt || 'Summarize video content'}`,
      '',
      'Provider credentials are configured. Video upload analysis is not implemented in this desktop build yet.',
    ].join('\n'),
    'utf8',
  );
  addActiveArtifact({
    title: path.basename(outputPath),
    kind: 'document',
    filePath: outputPath,
    mimeType: 'text/markdown',
  });
  return `Created video analysis request artifact: ${outputPath}`;
}

async function startWebsitePreview(inputs: ActionInputs) {
  const targetPath = resolveLocalPath(inputs.path);
  const install = asBool(
    (inputs as ExtendedActionInputs & { install?: string }).install,
  );
  return startProcess({
    command: install ? 'npm install && npm run dev' : 'npm run dev',
    cwd: targetPath,
  });
}

async function exportWebsiteProject(inputs: ActionInputs) {
  const sourcePath = resolveLocalPath(inputs.path);
  const outputPath = resolveLocalPath(inputs.output_path);
  const overwrite = asBool(inputs.overwrite);
  await approveOverwrite(
    'export_website_project_overwrite',
    outputPath,
    overwrite,
  );
  await assertSafeWritePath(outputPath, overwrite, 'output_path');
  const artifact = await createWebsiteZipArtifact(
    createRunId(),
    path.basename(outputPath),
    sourcePath,
  );
  await fs.copyFile(artifact.path, outputPath);
  addActiveArtifact({
    title: path.basename(outputPath),
    kind: 'archive',
    filePath: outputPath,
    mimeType: 'application/zip',
  });
  return `Exported website project: ${outputPath}`;
}

async function listConnectors() {
  const connectors = SettingStore.get('connectors') || [];
  if (!connectors.length) {
    return 'No connectors are configured.';
  }
  return connectors
    .map(
      (connector) =>
        `${connector.id}\t${connector.enabled ? 'enabled' : 'disabled'}\t${connector.authState}\ttools=${connector.tools.join(',')}`,
    )
    .join('\n');
}

const getConnector = (id: string) =>
  (SettingStore.get('connectors') || []).find(
    (connector) => connector.id === id,
  );

const requireGithubConnector = () => {
  const connector = getConnector('github');
  if (!connector?.enabled) {
    recordConnectorDenial('connector_github', 'github');
    throw new Error('GitHub connector is disabled.');
  }
  const token = connector.config?.token?.trim();
  if (!token) {
    recordConnectorDenial('connector_github', 'github');
    throw new Error('GitHub connector is missing config.token.');
  }
  return {
    token,
    apiBase: connector.config?.apiBase?.trim() || 'https://api.github.com',
    defaultRepository: connector.config?.repository?.trim(),
  };
};

const githubRequest = async <T>({
  apiBase,
  token,
  method,
  urlPath,
  body,
}: {
  apiBase: string;
  token: string;
  method: string;
  urlPath: string;
  body?: unknown;
}) => {
  const response = await fetch(`${apiBase.replace(/\/$/, '')}${urlPath}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(
      `GitHub API failed with HTTP ${response.status}: ${
        parsed?.message || text || response.statusText
      }`,
    );
  }
  return parsed as T;
};

const encodeRepoPath = (repository: string, targetPath = '') => {
  const repo = repository
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  const filePath = targetPath
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  return filePath ? `/repos/${repo}/${filePath}` : `/repos/${repo}`;
};

const recordConnectorDenial = (action: string, target: string | undefined) => {
  const runId = TaskRunRegistry.getActiveRunId();
  if (!runId) {
    return;
  }
  TaskRunRegistry.addApproval(runId, {
    action,
    target,
    risk: 'medium',
    status: 'denied',
  });
};

async function connectorSlackPost(inputs: ActionInputs) {
  const extra = inputs as ExtendedActionInputs;
  const connector = getConnector('slack_webhook');
  if (!connector?.enabled) {
    recordConnectorDenial('connector_slack_post', 'slack_webhook');
    throw new Error('Slack webhook connector is disabled.');
  }
  const webhookUrl = connector.config?.webhookUrl;
  if (!webhookUrl) {
    recordConnectorDenial('connector_slack_post', 'slack_webhook');
    throw new Error('Slack webhook connector is missing config.webhookUrl.');
  }
  const approved = await requestUserApproval({
    action: 'connector_slack_post',
    target: 'slack_webhook',
    risk: 'medium',
  });
  if (!approved) {
    throw new Error('Slack webhook post was denied by the user.');
  }
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: extra.message || inputs.content || '' }),
  });
  if (!response.ok) {
    throw new Error(`Slack webhook failed with HTTP ${response.status}.`);
  }
  return 'Posted message through Slack webhook connector.';
}

async function connectorGithubIssue(inputs: ActionInputs) {
  const extra = inputs as ExtendedActionInputs;
  const { token, apiBase, defaultRepository } = requireGithubConnector();
  const repository = requireInput(
    extra.repository || defaultRepository,
    'repository',
  );
  const title = requireInput(extra.title || inputs.content, 'title');
  const body = extra.message || inputs.content || '';
  const approved = await requestUserApproval({
    action: 'connector_github_issue',
    target: `${repository}: ${title}`,
    risk: 'medium',
  });
  if (!approved) {
    throw new Error('GitHub issue creation was denied by the user.');
  }
  const result = await githubRequest<{ html_url?: string; number?: number }>({
    apiBase,
    token,
    method: 'POST',
    urlPath: `${encodeRepoPath(repository)}/issues`,
    body: {
      title,
      body,
    },
  });
  return `Created GitHub issue #${result.number ?? '(unknown)'}: ${
    result.html_url || repository
  }`;
}

async function connectorGithubExport(inputs: ActionInputs) {
  const extra = inputs as ExtendedActionInputs;
  const { token, apiBase, defaultRepository } = requireGithubConnector();
  const repository = requireInput(
    extra.repository || defaultRepository,
    'repository',
  );
  const sourcePath = resolveLocalPath(inputs.path);
  const targetPath = requireInput(
    extra.target_path || inputs.output_path,
    'target_path',
  ).replace(/^\/+/, '');
  const approved = await requestUserApproval({
    action: 'connector_github_export',
    target: `${sourcePath} -> ${repository}/${targetPath}`,
    risk: 'medium',
  });
  if (!approved) {
    throw new Error('GitHub file export was denied by the user.');
  }
  const content = await fs.readFile(sourcePath);
  const result = await githubRequest<{
    content?: { html_url?: string };
    commit?: { html_url?: string };
  }>({
    apiBase,
    token,
    method: 'PUT',
    urlPath: `${encodeRepoPath(repository, `contents/${targetPath}`)}`,
    body: {
      message:
        extra.message ||
        `Export ${path.basename(sourcePath)} from Neura Desktop`,
      content: content.toString('base64'),
    },
  });
  return `Exported file to GitHub: ${
    result.content?.html_url || result.commit?.html_url || repository
  }`;
}

async function connectorDriveExport(inputs: ActionInputs) {
  const connector = getConnector('google_drive_export');
  if (!connector?.enabled) {
    recordConnectorDenial('connector_drive_export', 'google_drive_export');
    throw new Error('Google Drive export connector is disabled.');
  }
  const sourcePath = resolveLocalPath(inputs.path);
  const approved = await requestUserApproval({
    action: 'connector_drive_export',
    target: sourcePath,
    risk: 'medium',
  });
  if (!approved) {
    throw new Error('Google Drive export was denied by the user.');
  }
  return `Prepared Google Drive-compatible export placeholder for ${sourcePath}. Full OAuth upload is planned for the connector marketplace phase.`;
}

async function connectorMcpCall(inputs: ActionInputs) {
  const extra = inputs as ExtendedActionInputs;
  const connector = getConnector('custom_mcp');
  if (!connector?.enabled) {
    recordConnectorDenial('connector_mcp_call', 'custom_mcp');
    throw new Error('Custom MCP connector is disabled.');
  }
  const command = connector.config?.command?.trim();
  if (!command) {
    recordConnectorDenial('connector_mcp_call', 'custom_mcp');
    throw new Error('Custom MCP connector is missing config.command.');
  }
  const approved = await requestUserApproval({
    action: 'connector_mcp_call',
    target: extra.tool || connector.displayName,
    risk: 'medium',
  });
  if (!approved) {
    throw new Error('Custom MCP call was denied by the user.');
  }

  const toolName = requireInput(extra.tool, 'tool');
  const payload = extra.payload?.trim() ? JSON.parse(extra.payload) : {};
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/stdio.js'),
  ]);
  const transport = new StdioClientTransport({
    command,
    args: splitArgs(connector.config?.args),
    env: {
      ...currentEnv(),
      ...parseEnv(connector.config?.env),
    },
  });
  const client = new Client({
    name: 'neura-desktop',
    version: '0.2.10',
  });

  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: toolName,
      arguments: payload,
    });
    return `MCP tool ${toolName} returned:\n\n${truncate(JSON.stringify(result, null, 2))}`;
  } finally {
    await client.close().catch((error: unknown) => logger.warn(error));
  }
}

async function runCommand(inputs: ActionInputs) {
  const command = requireInput(inputs.command, 'command');
  if (isDangerousCommand(command)) {
    await requireApproval('run_command_destructive_command', command, 'high');
  }
  const cwd = inputs.cwd?.trim() ? path.resolve(inputs.cwd) : process.cwd();
  const start = Date.now();
  const execOptions = {
    cwd,
    timeout: 120_000,
    maxBuffer: 1024 * 1024 * 4,
    windowsHide: true,
  };
  const windowsCommand = `$ErrorActionPreference = 'Stop'; ${command}`;
  let stdout = '';
  let stderr = '';
  try {
    const output = env.isWindows
      ? await execFileAsync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            windowsCommand,
          ],
          execOptions,
        )
      : await execAsync(command, execOptions);
    stdout = output.stdout;
    stderr = output.stderr;
  } catch (error) {
    const outputError = error as { stdout?: string; stderr?: string };
    throw new Error(
      formatCommandFailure(
        command,
        error,
        outputError.stdout || '',
        outputError.stderr || '',
      ),
    );
  }
  assertNoCommandError({ command, stdout, stderr });
  return [
    `Command completed in ${Date.now() - start}ms:`,
    `Command: ${command}`,
    `CWD: ${cwd}`,
    stdout ? `\nstdout:\n${truncate(stdout.trimEnd())}` : '',
    stderr ? `\nstderr:\n${truncate(stderr.trimEnd())}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function startProcess(inputs: ActionInputs) {
  const command = requireInput(inputs.command, 'command');
  if (isDangerousCommand(command)) {
    await requireApproval('start_process_destructive_command', command, 'high');
  }
  const cwd = inputs.cwd?.trim() ? path.resolve(inputs.cwd) : process.cwd();
  const child = env.isWindows
    ? spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
        { cwd, windowsHide: true },
      )
    : spawn(command, { cwd, shell: true });
  const id = randomUUID();
  const record: StartedProcess = {
    id,
    command,
    cwd,
    startedAt: Date.now(),
    child,
    stdout: '',
    stderr: '',
  };
  processes.set(id, record);
  ComputerRuntimeController.update({
    mode: 'terminal',
    status: 'running',
    activeProcessId: id,
    display: command,
    cwd,
    activity: 'Process started',
  });

  const append = (key: 'stdout' | 'stderr', chunk: Buffer) => {
    record[key] = truncate(record[key] + chunk.toString(), MAX_PROCESS_BUFFER);
  };
  child.stdout.on('data', (chunk) => append('stdout', chunk));
  child.stderr.on('data', (chunk) => append('stderr', chunk));
  child.on('exit', (code) => {
    record.exitCode = code;
  });

  return `Started process ${id}:\n${command}\n\nUse read_process(process_id='${id}') to read output or stop_process(process_id='${id}') to stop it.`;
}

async function readProcess(inputs: ActionInputs) {
  const id = requireInput(inputs.process_id, 'process_id');
  const record = processes.get(id);
  if (!record) {
    throw new Error(`No Neura-started process found for id ${id}.`);
  }
  return [
    `Process: ${id}`,
    `Command: ${record.command}`,
    `CWD: ${record.cwd}`,
    `Status: ${record.exitCode === undefined ? 'running' : `exited (${record.exitCode})`}`,
    record.stdout ? `\nstdout:\n${record.stdout.trimEnd()}` : '',
    record.stderr ? `\nstderr:\n${record.stderr.trimEnd()}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function stopProcess(inputs: ActionInputs) {
  const id = requireInput(inputs.process_id, 'process_id');
  const record = processes.get(id);
  if (!record) {
    throw new Error(`No Neura-started process found for id ${id}.`);
  }
  record.child.kill();
  record.exitCode = record.exitCode ?? null;
  return `Stopped process ${id}.`;
}

async function listProcesses() {
  if (processes.size === 0) {
    return 'No Neura-started processes are currently tracked.';
  }
  return Array.from(processes.values())
    .map(
      (record) =>
        `${record.id}\t${record.exitCode === undefined ? 'running' : `exited (${record.exitCode})`}\t${record.command}`,
    )
    .join('\n');
}

const getStoredMonitors = (): MonitorRecord[] =>
  (SettingStore.get('monitors') || []) as MonitorRecord[];

const setStoredMonitors = (monitors: MonitorRecord[]) => {
  SettingStore.set('monitors', monitors);
};

const getWatchedContent = async (monitor: MonitorRecord) => {
  const response = await fetch(monitor.url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const html = await response.text();
  if (monitor.watch === 'selector' && monitor.query) {
    const escaped = monitor.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = html.match(
      new RegExp(`<[^>]*${escaped}[^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i'),
    );
    return (
      match?.[1]
        ?.replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || ''
    );
  }
  if (monitor.watch === 'text') {
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return monitor.query ? String(text.includes(monitor.query)) : text;
  }
  return html;
};

const tickMonitor = async (monitorId: string) => {
  const monitors = getStoredMonitors();
  const monitor = monitors.find((item) => item.id === monitorId);
  if (!monitor || !monitor.active) {
    return;
  }
  try {
    const content = await getWatchedContent(monitor);
    const digest = createHash('sha256').update(content).digest('hex');
    const changed = Boolean(
      monitor.lastDigest && monitor.lastDigest !== digest,
    );
    monitor.lastDigest = digest;
    monitor.lastCheckedAt = Date.now();
    monitor.lastStatus = changed ? 'changed' : 'unchanged';
    if (changed) {
      monitor.lastChangedAt = Date.now();
      if (Notification.isSupported()) {
        new Notification({
          title: 'Neura monitor changed',
          body: monitor.url,
        }).show();
      }
    }
  } catch (error) {
    monitor.lastCheckedAt = Date.now();
    monitor.lastStatus = `error: ${error instanceof Error ? error.message : String(error)}`;
  }
  setStoredMonitors(monitors);
};

const ensureMonitorRuntime = () => {
  for (const monitor of getStoredMonitors()) {
    if (!monitor.active || monitorTimers.has(monitor.id)) {
      continue;
    }
    const timer = setInterval(
      () => tickMonitor(monitor.id).catch((error) => logger.error(error)),
      monitor.intervalMinutes * 60_000,
    );
    monitorTimers.set(monitor.id, timer);
  }
};

async function createMonitor(inputs: ActionInputs) {
  const url = requireInput(inputs.url, 'url');
  const intervalMinutes = Math.max(
    1,
    Number.parseInt(inputs.interval_minutes || '5', 10) || 5,
  );
  const watch = ['page', 'selector', 'text'].includes(inputs.watch || '')
    ? (inputs.watch as MonitorRecord['watch'])
    : 'page';
  const monitor: MonitorRecord = {
    id: randomUUID(),
    url,
    intervalMinutes,
    watch,
    query: inputs.query || '',
    notifyOn: 'change',
    active: true,
    createdAt: Date.now(),
    lastStatus: 'created',
  };
  setStoredMonitors([...getStoredMonitors(), monitor]);
  ensureMonitorRuntime();
  await tickMonitor(monitor.id);
  return `Created monitor ${monitor.id} for ${url}. It checks every ${intervalMinutes} minute${intervalMinutes === 1 ? '' : 's'} while Neura is open.`;
}

async function listMonitors() {
  ensureMonitorRuntime();
  const monitors = getStoredMonitors();
  if (monitors.length === 0) {
    return 'No webpage monitors are configured.';
  }
  return monitors
    .map(
      (monitor) =>
        `${monitor.id}\t${monitor.active ? 'active' : 'stopped'}\t${monitor.lastStatus || 'unknown'}\t${monitor.url}`,
    )
    .join('\n');
}

async function stopMonitor(inputs: ActionInputs) {
  const id = requireInput(inputs.monitor_id, 'monitor_id');
  const monitors = getStoredMonitors();
  const monitor = monitors.find((item) => item.id === id);
  if (!monitor) {
    throw new Error(`No monitor found for id ${id}.`);
  }
  monitor.active = false;
  const timer = monitorTimers.get(id);
  if (timer) {
    clearInterval(timer);
    monitorTimers.delete(id);
  }
  setStoredMonitors(monitors);
  return `Stopped monitor ${id}.`;
}
