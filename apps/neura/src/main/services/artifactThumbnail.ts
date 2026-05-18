/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const OFFICE_EXTENSIONS = new Set(['.docx', '.pptx', '.xlsx']);

export type ArtifactThumbnailResult =
  | {
      ok: true;
      path: string;
      mimeType: 'image/png';
      reason: '';
    }
  | {
      ok: false;
      path?: undefined;
      mimeType?: undefined;
      reason: string;
    };

type ThumbnailDependencies = {
  resolveTool?: (names: string[]) => Promise<string | null> | string | null;
  runCommand?: (
    executable: string,
    args: string[],
    options: { cwd?: string; timeoutMs: number },
  ) => Promise<void>;
};

const unique = <T>(items: T[]) => [...new Set(items.filter(Boolean))] as T[];

const candidateNames = (name: string) => {
  const ext = path.extname(name);
  if (ext) {
    return [name];
  }
  const pathext = (process.env.PATHEXT || '.EXE;.CMD;.BAT')
    .split(';')
    .map((item) => item.toLowerCase());
  return [name, ...pathext.map((suffix) => `${name}${suffix}`)];
};

const findOnPath = (names: string[]) => {
  const pathEntries = (process.env.PATH || '').split(path.delimiter);
  for (const name of names) {
    if (path.isAbsolute(name) && existsSync(name)) {
      return name;
    }
    for (const entry of pathEntries) {
      for (const candidateName of candidateNames(name)) {
        const candidate = path.join(entry, candidateName);
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }
  return null;
};

export const resolveOfficeThumbnailTool = (names: string[]) => {
  const withWindowsDefaults = unique([
    ...names,
    names.includes('soffice') || names.includes('soffice.exe')
      ? 'C:\\Program Files\\LibreOffice\\program\\soffice.exe'
      : '',
    names.includes('pdftoppm') || names.includes('pdftoppm.exe')
      ? 'C:\\Program Files\\poppler\\Library\\bin\\pdftoppm.exe'
      : '',
  ]);
  return findOnPath(withWindowsDefaults);
};

const runCommand = async (
  executable: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number },
) => {
  await execFileAsync(executable, args, {
    cwd: options.cwd,
    timeout: options.timeoutMs,
    windowsHide: true,
  });
};

export const renderOfficeArtifactThumbnail = async (
  artifactPath: string,
  dependencies: ThumbnailDependencies = {},
): Promise<ArtifactThumbnailResult> => {
  const extension = path.extname(artifactPath).toLowerCase();
  if (!OFFICE_EXTENSIONS.has(extension)) {
    return {
      ok: false,
      reason: 'Visual thumbnails are only supported for DOCX, PPTX, and XLSX artifacts.',
    };
  }

  const stat = await fs.stat(artifactPath).catch(() => null);
  if (!stat?.isFile()) {
    return {
      ok: false,
      reason: `Artifact is missing or not a regular file: ${artifactPath}`,
    };
  }

  const resolveTool =
    dependencies.resolveTool ||
    ((names: string[]) => resolveOfficeThumbnailTool(names));
  const soffice = await resolveTool(['soffice', 'soffice.exe']);
  if (!soffice) {
    return {
      ok: false,
      reason:
        'LibreOffice soffice was not found on PATH, so Neura cannot render an Office visual thumbnail locally.',
    };
  }
  const pdftoppm = await resolveTool(['pdftoppm', 'pdftoppm.exe']);
  if (!pdftoppm) {
    return {
      ok: false,
      reason:
        'Poppler pdftoppm was not found on PATH, so Neura cannot convert the Office PDF preview into a PNG thumbnail locally.',
    };
  }

  const tempDir = path.join(
    os.tmpdir(),
    `neura-office-thumb-${Date.now()}-${randomUUID().slice(0, 8)}`,
  );
  await fs.mkdir(tempDir, { recursive: true });
  const runner = dependencies.runCommand || runCommand;
  try {
    await runner(
      soffice,
      [
        '--headless',
        '--convert-to',
        'pdf',
        '--outdir',
        tempDir,
        artifactPath,
      ],
      { timeoutMs: 60_000 },
    );
    const pdfPath = path.join(
      tempDir,
      `${path.basename(artifactPath, extension)}.pdf`,
    );
    const pdfStat = await fs.stat(pdfPath).catch(() => null);
    if (!pdfStat?.isFile() || pdfStat.size === 0) {
      return {
        ok: false,
        reason:
          'LibreOffice did not produce a readable PDF preview for this Office artifact.',
      };
    }
    const outputPrefix = path.join(tempDir, 'thumbnail');
    await runner(
      pdftoppm,
      ['-png', '-singlefile', '-f', '1', '-l', '1', pdfPath, outputPrefix],
      { timeoutMs: 60_000 },
    );
    const thumbnailPath = `${outputPrefix}.png`;
    const thumbnailStat = await fs.stat(thumbnailPath).catch(() => null);
    if (!thumbnailStat?.isFile() || thumbnailStat.size === 0) {
      return {
        ok: false,
        reason:
          'Poppler did not produce a readable PNG thumbnail for this Office artifact.',
      };
    }
    return {
      ok: true,
      path: thumbnailPath,
      mimeType: 'image/png',
      reason: '',
    };
  } catch (error) {
    return {
      ok: false,
      reason: `Office thumbnail rendering failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
};
