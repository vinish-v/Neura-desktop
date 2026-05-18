import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { validateArtifactFile } from './artifactValidation';

let tempDir = '';

const artifact = (filePath: string, kind: 'document' | 'presentation' | 'spreadsheet' | 'website' | 'archive' | 'image' | 'report') => ({
  path: filePath,
  kind,
  title: path.basename(filePath),
});

describe('artifact validation', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neura-artifact-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('rejects missing and empty artifacts', async () => {
    const missing = await validateArtifactFile(
      artifact(path.join(tempDir, 'missing.pdf'), 'document'),
    );
    expect(missing.ok).toBe(false);
    expect(missing.errors[0]).toContain('Artifact is missing');

    const emptyPath = path.join(tempDir, 'empty.pdf');
    await fs.writeFile(emptyPath, Buffer.alloc(0));
    const empty = await validateArtifactFile(artifact(emptyPath, 'document'));
    expect(empty.ok).toBe(false);
    expect(empty.errors.join(' ')).toContain('empty');
  });

  it('validates PDFs, office zip containers, images, and websites by format', async () => {
    const pdfPath = path.join(tempDir, 'report.pdf');
    await fs.writeFile(pdfPath, Buffer.from('%PDF-1.7\nbody'));
    await expect(validateArtifactFile(artifact(pdfPath, 'document'))).resolves.toEqual(
      expect.objectContaining({ ok: true, expectedFormat: 'PDF' }),
    );

    const pptxPath = path.join(tempDir, 'deck.pptx');
    const pptxZip = new JSZip();
    pptxZip.file('ppt/presentation.xml', '<presentation />');
    await fs.writeFile(pptxPath, await pptxZip.generateAsync({ type: 'nodebuffer' }));
    await expect(validateArtifactFile(artifact(pptxPath, 'presentation'))).resolves.toEqual(
      expect.objectContaining({ ok: true, expectedFormat: 'PPTX' }),
    );

    const pngPath = path.join(tempDir, 'image.png');
    await fs.writeFile(
      pngPath,
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]),
    );
    await expect(validateArtifactFile(artifact(pngPath, 'image'))).resolves.toEqual(
      expect.objectContaining({ ok: true, expectedFormat: 'image' }),
    );

    const siteDir = path.join(tempDir, 'site');
    await fs.mkdir(siteDir);
    await fs.writeFile(path.join(siteDir, 'index.html'), '<!doctype html><html></html>');
    await expect(validateArtifactFile(artifact(siteDir, 'website'))).resolves.toEqual(
      expect.objectContaining({ ok: true, expectedFormat: 'website project directory' }),
    );
  });

  it('rejects files with the wrong bytes for their claimed format', async () => {
    const badPptx = path.join(tempDir, 'bad.pptx');
    await fs.writeFile(badPptx, 'not a zip');

    const result = await validateArtifactFile(artifact(badPptx, 'presentation'));

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('could not be read as PPTX');
  });
});
