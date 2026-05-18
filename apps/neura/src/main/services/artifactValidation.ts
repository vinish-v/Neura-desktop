/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs/promises';
import path from 'path';

import type { ArtifactKind, TaskArtifact } from '@main/store/types';

export type ArtifactValidationResult = {
  ok: boolean;
  path: string;
  kind: ArtifactKind;
  sizeBytes: number;
  readablePreview: boolean;
  expectedFormat: string;
  checkedAt: number;
  errors: string[];
  warnings: string[];
};

type ArtifactLike = Pick<TaskArtifact, 'path' | 'kind' | 'mimeType' | 'title'>;

const readPrefix = async (filePath: string, bytes = 512) => {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
};

const hasZipEntry = async (filePath: string, pattern: RegExp) => {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await fs.readFile(filePath));
  return Object.keys(zip.files).some((entry) => pattern.test(entry));
};

const textIncludesHtml = async (filePath: string) => {
  const text = (await fs.readFile(filePath, 'utf8')).slice(0, 16_000);
  return /<(html|!doctype)\b/i.test(text);
};

const isImagePrefix = (extension: string, prefix: Buffer) => {
  if (extension === '.png') {
    return prefix.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  }
  if (extension === '.jpg' || extension === '.jpeg') {
    return prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff;
  }
  if (extension === '.gif') {
    return /^GIF8[79]a/u.test(prefix.toString('ascii', 0, 6));
  }
  if (extension === '.webp') {
    return (
      prefix.toString('ascii', 0, 4) === 'RIFF' &&
      prefix.toString('ascii', 8, 12) === 'WEBP'
    );
  }
  if (extension === '.svg') {
    return /<svg\b/i.test(prefix.toString('utf8'));
  }
  return false;
};

const isAudioPrefix = (extension: string, prefix: Buffer) => {
  if (extension === '.mp3') {
    return (
      prefix.toString('ascii', 0, 3) === 'ID3' ||
      (prefix[0] === 0xff && (prefix[1] & 0xe0) === 0xe0)
    );
  }
  if (extension === '.wav') {
    return (
      prefix.toString('ascii', 0, 4) === 'RIFF' &&
      prefix.toString('ascii', 8, 12) === 'WAVE'
    );
  }
  if (extension === '.ogg') {
    return prefix.toString('ascii', 0, 4) === 'OggS';
  }
  if (extension === '.flac') {
    return prefix.toString('ascii', 0, 4) === 'fLaC';
  }
  if (extension === '.m4a') {
    return prefix.toString('ascii', 4, 8) === 'ftyp';
  }
  if (extension === '.aac') {
    return prefix[0] === 0xff && (prefix[1] === 0xf1 || prefix[1] === 0xf9);
  }
  return false;
};

const isVideoPrefix = (extension: string, prefix: Buffer) => {
  if (['.mp4', '.mov', '.m4v'].includes(extension)) {
    return prefix.toString('ascii', 4, 8) === 'ftyp';
  }
  if (extension === '.webm') {
    return prefix.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  }
  if (['.mpg', '.mpeg'].includes(extension)) {
    return prefix[0] === 0x00 && prefix[1] === 0x00 && prefix[2] === 0x01;
  }
  return false;
};

const validateDirectoryArtifact = async (
  artifact: ArtifactLike,
): Promise<ArtifactValidationResult> => {
  const entries = await fs.readdir(artifact.path);
  const hasWebsiteEntry =
    entries.includes('index.html') ||
    entries.includes('package.json') ||
    entries.includes('src');
  const ok = artifact.kind === 'website' && hasWebsiteEntry;
  return {
    ok,
    path: artifact.path,
    kind: artifact.kind,
    sizeBytes: entries.length,
    readablePreview: ok,
    expectedFormat: artifact.kind === 'website' ? 'website project directory' : 'file',
    checkedAt: Date.now(),
    errors: ok
      ? []
      : [`${artifact.title || artifact.path} is a directory but not a readable website project.`],
    warnings: [],
  };
};

export const validateArtifactFile = async (
  artifact: ArtifactLike,
): Promise<ArtifactValidationResult> => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const checkedAt = Date.now();

  let stats;
  try {
    stats = await fs.stat(artifact.path);
  } catch (error) {
    return {
      ok: false,
      path: artifact.path,
      kind: artifact.kind,
      sizeBytes: 0,
      readablePreview: false,
      expectedFormat: artifact.kind,
      checkedAt,
      errors: [
        `Artifact is missing: ${artifact.path}. ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
      warnings,
    };
  }

  if (stats.isDirectory()) {
    return validateDirectoryArtifact(artifact);
  }

  if (!stats.isFile()) {
    return {
      ok: false,
      path: artifact.path,
      kind: artifact.kind,
      sizeBytes: stats.size,
      readablePreview: false,
      expectedFormat: artifact.kind,
      checkedAt,
      errors: [`Artifact is not a regular file: ${artifact.path}`],
      warnings,
    };
  }

  if (stats.size <= 0) {
    errors.push(`Artifact is empty: ${artifact.path}`);
  }

  const extension = path.extname(artifact.path).toLowerCase();
  let readablePreview = false;
  let expectedFormat = extension || artifact.kind;

  try {
    if (extension === '.pdf') {
      expectedFormat = 'PDF';
      readablePreview = (await readPrefix(artifact.path, 8)).toString('ascii').startsWith('%PDF');
    } else if (extension === '.docx') {
      expectedFormat = 'DOCX';
      readablePreview = await hasZipEntry(artifact.path, /^word\/document\.xml$/u);
    } else if (extension === '.pptx') {
      expectedFormat = 'PPTX';
      readablePreview = await hasZipEntry(artifact.path, /^ppt\/presentation\.xml$/u);
    } else if (extension === '.xlsx') {
      expectedFormat = 'XLSX';
      readablePreview = await hasZipEntry(artifact.path, /^xl\/workbook\.xml$/u);
    } else if (extension === '.zip') {
      expectedFormat = 'ZIP archive';
      readablePreview = await hasZipEntry(artifact.path, /./u);
    } else if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(extension)) {
      expectedFormat = 'image';
      readablePreview = isImagePrefix(extension, await readPrefix(artifact.path));
    } else if (['.aac', '.flac', '.m4a', '.mp3', '.ogg', '.wav'].includes(extension)) {
      expectedFormat = 'audio';
      readablePreview = isAudioPrefix(extension, await readPrefix(artifact.path, 16));
    } else if (['.mov', '.mp4', '.mpeg', '.mpg', '.webm'].includes(extension)) {
      expectedFormat = 'video';
      readablePreview = isVideoPrefix(extension, await readPrefix(artifact.path, 16));
    } else if (['.html', '.htm'].includes(extension)) {
      expectedFormat = 'HTML website';
      readablePreview = await textIncludesHtml(artifact.path);
    } else if (
      ['.md', '.txt', '.csv', '.json', '.ts', '.tsx', '.js', '.jsx', '.css'].includes(
        extension,
      )
    ) {
      expectedFormat = 'text/data';
      await fs.readFile(artifact.path, 'utf8');
      readablePreview = true;
    } else {
      warnings.push(`No artifact-specific validator exists for ${extension || artifact.kind}.`);
      readablePreview = stats.size > 0;
    }
  } catch (error) {
    errors.push(
      `Artifact could not be read as ${expectedFormat}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!readablePreview) {
    errors.push(`Artifact is not readable as ${expectedFormat}: ${artifact.path}`);
  }

  return {
    ok: errors.length === 0,
    path: artifact.path,
    kind: artifact.kind,
    sizeBytes: stats.size,
    readablePreview,
    expectedFormat,
    checkedAt,
    errors,
    warnings,
  };
};

export const refinementTemplateForArtifact = (
  artifact: ArtifactLike,
  originalGoal: string,
) => {
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
    templates[artifact.kind] ||
      'Inspect and improve this artifact, then save a real validated output file.',
    `Artifact path: ${artifact.path}`,
    `Original task: ${originalGoal}`,
    'Validate file existence, nonzero size, readable preview, and expected format before saying it is complete.',
  ].join('\n');
};
