import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renderOfficeArtifactThumbnail } from './artifactThumbnail';

describe('renderOfficeArtifactThumbnail', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neura-thumb-test-'));
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('reports setup gaps when local thumbnail tooling is missing', async () => {
    const artifactPath = path.join(tempDir, 'deck.pptx');
    await fs.writeFile(artifactPath, 'office-bytes');

    const result = await renderOfficeArtifactThumbnail(artifactPath, {
      resolveTool: () => null,
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        reason: expect.stringContaining('LibreOffice soffice was not found'),
      }),
    );
  });

  it('renders a PNG thumbnail when real conversion tools are available', async () => {
    const artifactPath = path.join(tempDir, 'deck.pptx');
    await fs.writeFile(artifactPath, 'office-bytes');
    const calls: Array<{ executable: string; args: string[] }> = [];

    const result = await renderOfficeArtifactThumbnail(artifactPath, {
      resolveTool: (names) =>
        names.includes('soffice') ? 'C:\\tools\\soffice.exe' : 'C:\\tools\\pdftoppm.exe',
      runCommand: async (executable, args) => {
        calls.push({ executable, args });
        if (executable.includes('soffice')) {
          const outDir = args[args.indexOf('--outdir') + 1];
          await fs.writeFile(path.join(outDir, 'deck.pdf'), '%PDF rendered');
        } else {
          const outputPrefix = args[args.length - 1];
          await fs.writeFile(`${outputPrefix}.png`, Buffer.from('png'));
        }
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        mimeType: 'image/png',
      }),
    );
    if (result.ok) {
      await expect(fs.readFile(result.path)).resolves.toEqual(Buffer.from('png'));
    }
    expect(calls.map((call) => call.executable)).toEqual([
      'C:\\tools\\soffice.exe',
      'C:\\tools\\pdftoppm.exe',
    ]);
  });
});
