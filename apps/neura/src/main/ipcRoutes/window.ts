/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { app, shell } from 'electron';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { initIpc } from '@neura-desktop/electron-ipc/main';
import { appUpdater } from '@main/window/createWindow';
import { logger } from '../logger';
import { showWindow } from '@main/window/index';

const t = initIpc.create();

const TEXT_ARTIFACT_EXTENSIONS = new Set([
  '.csv',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.log',
  '.md',
  '.mdx',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

const IMAGE_ARTIFACT_EXTENSIONS = new Set([
  '.avif',
  '.bmp',
  '.gif',
  '.ico',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.webp',
]);

const PDF_ARTIFACT_EXTENSIONS = new Set(['.pdf']);
const AUDIO_ARTIFACT_EXTENSIONS = new Set(['.aac', '.flac', '.m4a', '.mp3', '.ogg', '.wav']);
const VIDEO_ARTIFACT_EXTENSIONS = new Set(['.mov', '.mp4', '.mpeg', '.mpg', '.webm']);
const OFFICE_ARTIFACT_EXTENSIONS = new Set(['.docx', '.pptx', '.xlsx']);
const ARCHIVE_ARTIFACT_EXTENSIONS = new Set(['.zip']);

type ArtifactPreview =
  | {
      kind: 'text';
      readable: true;
      text: string;
      mimeType: string;
      reason: '';
    }
  | {
      kind: 'binary';
      readable: true;
      dataUrl: string;
      mimeType: string;
      reason: '';
    }
  | {
      kind: 'unsupported';
      readable: false;
      reason: string;
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

const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024;
const MAX_BINARY_PREVIEW_BYTES = 8 * 1024 * 1024;
const MAX_ZIP_PREVIEW_BYTES = 16 * 1024 * 1024;
const MAX_WORKSPACE_ENTRIES = 200;

const EXTENSION_MIME_OVERRIDES: Record<string, string> = {
  '.md': 'text/markdown',
  '.mdx': 'text/markdown',
  '.tsx': 'text/typescript',
  '.ts': 'text/typescript',
  '.jsx': 'text/javascript',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.yml': 'text/yaml',
  '.yaml': 'text/yaml',
  '.csv': 'text/csv',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.mpeg': 'video/mpeg',
  '.mpg': 'video/mpeg',
  '.webm': 'video/webm',
};

const resolveMimeType = (extension: string) =>
  EXTENSION_MIME_OVERRIDES[extension] ||
  (TEXT_ARTIFACT_EXTENSIONS.has(extension)
    ? 'text/plain'
    : IMAGE_ARTIFACT_EXTENSIONS.has(extension)
      ? `image/${extension.replace(/^\./, '')}`
      : AUDIO_ARTIFACT_EXTENSIONS.has(extension)
        ? `audio/${extension.replace(/^\./, '')}`
        : VIDEO_ARTIFACT_EXTENSIONS.has(extension)
          ? `video/${extension.replace(/^\./, '')}`
      : 'application/octet-stream');

const stripXmlText = (value: string) =>
  value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const readZipTextPreview = async (artifactPath: string, extension: string) => {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await fs.readFile(artifactPath));
  const entries = Object.keys(zip.files).filter((entry) => !zip.files[entry].dir);
  if (extension === '.zip') {
    return `Archive entries:\n${entries.slice(0, 80).join('\n')}`;
  }
  const patterns =
    extension === '.docx'
      ? [/^word\/document\.xml$/u]
      : extension === '.pptx'
        ? [/^ppt\/slides\/slide\d+\.xml$/u]
        : [/^xl\/workbook\.xml$/u, /^xl\/worksheets\/sheet\d+\.xml$/u];
  const chunks: string[] = [];
  for (const entry of entries) {
    if (!patterns.some((pattern) => pattern.test(entry))) {
      continue;
    }
    const text = stripXmlText(await zip.files[entry].async('text'));
    if (text) {
      chunks.push(`${entry}\n${text}`);
    }
    if (chunks.join('\n\n').length > 12_000) {
      break;
    }
  }
  return chunks.length
    ? chunks.join('\n\n').slice(0, 16_000)
    : `Readable ${extension.toUpperCase().slice(1)} container with entries:\n${entries
        .slice(0, 40)
        .join('\n')}`;
};

const readArtifactPreview = async (
  artifactPath: string,
): Promise<ArtifactPreview> => {
  const extension = path.extname(artifactPath).toLowerCase();

  if (TEXT_ARTIFACT_EXTENSIONS.has(extension)) {
    const stat = await fs.stat(artifactPath);
    if (stat.size > MAX_TEXT_PREVIEW_BYTES) {
      return {
        kind: 'unsupported',
        readable: false,
        reason: 'Preview is limited to 1 MB text artifacts.',
      };
    }

    return {
      kind: 'text',
      readable: true,
      text: await fs.readFile(artifactPath, 'utf8'),
      mimeType: resolveMimeType(extension),
      reason: '',
    };
  }

  if (
    IMAGE_ARTIFACT_EXTENSIONS.has(extension) ||
    PDF_ARTIFACT_EXTENSIONS.has(extension) ||
    AUDIO_ARTIFACT_EXTENSIONS.has(extension) ||
    VIDEO_ARTIFACT_EXTENSIONS.has(extension)
  ) {
    const stat = await fs.stat(artifactPath);
    if (stat.size > MAX_BINARY_PREVIEW_BYTES) {
      return {
        kind: 'unsupported',
        readable: false,
        reason: 'Preview is limited to 8 MB binary artifacts.',
      };
    }

    const binary = await fs.readFile(artifactPath);
    const mimeType = resolveMimeType(extension);
    return {
      kind: 'binary',
      readable: true,
      dataUrl: `data:${mimeType};base64,${binary.toString('base64')}`,
      mimeType,
      reason: '',
    };
  }

  if (
    OFFICE_ARTIFACT_EXTENSIONS.has(extension) ||
    ARCHIVE_ARTIFACT_EXTENSIONS.has(extension)
  ) {
    const stat = await fs.stat(artifactPath);
    if (stat.size > MAX_ZIP_PREVIEW_BYTES) {
      return {
        kind: 'unsupported',
        readable: false,
        reason: 'Preview is limited to 16 MB office/archive artifacts.',
      };
    }

    return {
      kind: 'text',
      readable: true,
      text: await readZipTextPreview(artifactPath, extension),
      mimeType: resolveMimeType(extension),
      reason: '',
    };
  }

  return {
    kind: 'unsupported',
    readable: false,
    reason: `Preview is not available for ${extension || 'this file type'}.`,
  };
};

const normalizeWorkspaceRoots = async (
  inputPaths: string[],
): Promise<string[]> => {
  const roots = new Set<string>();
  for (const candidate of inputPaths) {
    if (!candidate) {
      continue;
    }

    try {
      const stat = await fs.stat(candidate);
      const rootPath = stat.isDirectory() ? candidate : path.dirname(candidate);
      roots.add(path.resolve(rootPath));
    } catch {
      // Skip nonexistent paths.
    }
  }

  return [...roots];
};

const listWorkspace = async (inputPaths: string[]): Promise<WorkspaceRoot[]> => {
  const roots = await normalizeWorkspaceRoots(inputPaths);
  const payload: WorkspaceRoot[] = [];

  for (const rootPath of roots) {
    let entries = await fs.readdir(rootPath, { withFileTypes: true });
    entries = entries
      .sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) {
          return left.isDirectory() ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      })
      .slice(0, MAX_WORKSPACE_ENTRIES);

    const mappedEntries: WorkspaceEntry[] = [];
    for (const entry of entries) {
      const entryPath = path.join(rootPath, entry.name);
      try {
        const stat = await fs.stat(entryPath);
        mappedEntries.push({
          path: entryPath,
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
          sizeBytes: stat.size,
          modifiedAt: stat.mtimeMs,
        });
      } catch {
        // Skip inaccessible files.
      }
    }

    payload.push({
      rootPath,
      entries: mappedEntries,
    });
  }

  return payload;
};

type ElectronProcessMetrics = NodeJS.Process & {
  getCPUUsage?: () => {
    percentCPUUsage?: number;
    idleWakeupsPerSecond?: number;
  };
  getSystemMemoryInfo?: () => {
    free?: number;
    total?: number;
  };
};

export const windowRoute = t.router({
  showMainWindow: t.procedure.input<void>().handle(async () => {
    showWindow();
  }),
  checkForUpdatesDetail: t.procedure.input<void>().handle(async () => {
    if (appUpdater) {
      logger.info('checkForUpdatesDetail');

      const detail = await appUpdater.checkForUpdatesDetail();
      return {
        ...detail,
        isPackaged: app.isPackaged,
      };
    }
    return {
      currentVersion: app.getVersion(),
      isPackaged: app.isPackaged,
      updateInfo: null,
    };
  }),
  openPath: t.procedure.input<{ path: string }>().handle(async ({ input }) => {
    return shell.openPath(input.path);
  }),
  openExternal: t.procedure.input<{ url: string }>().handle(async ({ input }) => {
    return shell.openExternal(input.url);
  }),
  revealPath: t.procedure
    .input<{ path: string }>()
    .handle(async ({ input }) => {
      shell.showItemInFolder(input.path);
    }),
  readArtifactText: t.procedure
    .input<{ path: string }>()
    .handle(async ({ input }) => {
      const preview = await readArtifactPreview(input.path);
      if (preview.kind !== 'text') {
        return {
          text: '',
          readable: false,
          reason: preview.reason,
        };
      }

      return {
        text: preview.text,
        readable: true,
        reason: '',
      };
    }),
  readArtifactPreview: t.procedure
    .input<{ path: string }>()
    .handle(async ({ input }) => {
      return readArtifactPreview(input.path);
    }),
  listWorkspaceEntries: t.procedure
    .input<{ paths: string[] }>()
    .handle(async ({ input }) => {
      return listWorkspace(input.paths || []);
    }),
  getRuntimeTelemetry: t.procedure.input<void>().handle(async () => {
    const electronProcess = process as ElectronProcessMetrics;
    const cpu = electronProcess.getCPUUsage?.();
    const memoryInfo = electronProcess.getSystemMemoryInfo?.();
    const memory = process.memoryUsage();
    const networkInterfaces = os.networkInterfaces();
    const activeNetworkLinks = Object.values(networkInterfaces).filter(
      (items) =>
        items?.some((item) => !item.internal && item.family === 'IPv4'),
    ).length;
    const totalMemoryBytes =
      (memoryInfo?.total ? memoryInfo.total * 1024 : undefined) ||
      os.totalmem();
    const freeMemoryBytes =
      (memoryInfo?.free ? memoryInfo.free * 1024 : undefined) || os.freemem();

    return {
      cpuPercent: cpu?.percentCPUUsage ?? null,
      idleWakeupsPerSecond: cpu?.idleWakeupsPerSecond ?? null,
      processRssBytes: memory.rss,
      processHeapUsedBytes: memory.heapUsed,
      totalMemoryBytes,
      freeMemoryBytes,
      activeNetworkLinks,
      timestamp: Date.now(),
    };
  }),
});
