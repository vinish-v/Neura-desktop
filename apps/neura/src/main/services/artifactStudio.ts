/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { TaskArtifact, ArtifactKind } from '@main/store/types';

const artifactRoot = () =>
  path.join(os.homedir(), 'Documents', 'Neura Artifacts');

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'artifact';

const artifact = ({
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
}): Omit<TaskArtifact, 'sourceRunId'> => ({
  id: `artifact_${Date.now()}_${randomUUID().slice(0, 8)}`,
  title,
  kind,
  mimeType,
  path: filePath,
  previewPath,
  createdAt: Date.now(),
});

export async function ensureRunArtifactDir(runId: string) {
  const dir = path.join(artifactRoot(), runId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function createMarkdownArtifact(
  runId: string,
  title: string,
  content: string,
  kind: ArtifactKind = 'report',
) {
  const dir = await ensureRunArtifactDir(runId);
  const filePath = path.join(dir, `${slugify(title)}.md`);
  await fs.writeFile(filePath, content, 'utf8');
  return artifact({
    title,
    kind,
    filePath,
    mimeType: 'text/markdown',
  });
}

export async function createCsvArtifact(
  runId: string,
  title: string,
  rows: Array<Record<string, string>>,
) {
  const dir = await ensureRunArtifactDir(runId);
  const filePath = path.join(dir, `${slugify(title)}.csv`);
  const headers = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()),
  );
  const escape = (value: string) =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  const content = [
    headers.join(','),
    ...rows.map((row) =>
      headers.map((header) => escape(row[header] || '')).join(','),
    ),
  ].join('\n');
  await fs.writeFile(filePath, content, 'utf8');
  return artifact({
    title,
    kind: 'data',
    filePath,
    mimeType: 'text/csv',
  });
}

export async function createFormattedWorkbookArtifact(
  runId: string,
  title: string,
  rows: Array<Record<string, string>>,
) {
  const ExcelJS = await import('exceljs');
  const dir = await ensureRunArtifactDir(runId);
  const filePath = path.join(dir, `${slugify(title)}.xlsx`);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Results');
  const summary = workbook.addWorksheet('Summary');
  const headers = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()),
  );

  sheet.columns = headers.map((header) => ({
    header,
    key: header,
    width: Math.min(Math.max(header.length + 8, 16), 42),
  }));
  rows.forEach((row) => sheet.addRow(row));
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F2937' },
  };
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: {
      row: Math.max(1, rows.length + 1),
      column: Math.max(1, headers.length),
    },
  };
  summary.addRows([
    ['Metric', 'Value'],
    ['Rows', String(rows.length)],
    ['Generated', new Date().toISOString()],
  ]);
  summary.getRow(1).font = { bold: true };

  await workbook.xlsx.writeFile(filePath);
  return artifact({
    title,
    kind: 'spreadsheet',
    filePath,
    mimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export async function createDocxArtifact(
  runId: string,
  title: string,
  content: string,
) {
  const docx = await import('docx');
  const dir = await ensureRunArtifactDir(runId);
  const filePath = path.join(dir, `${slugify(title)}.docx`);
  const paragraphs = content.split(/\r?\n/).map((line) => {
    const text = line.replace(/^#+\s*/, '') || ' ';
    return new docx.Paragraph({
      text,
      heading: line.startsWith('# ')
        ? docx.HeadingLevel.HEADING_1
        : line.startsWith('## ')
          ? docx.HeadingLevel.HEADING_2
          : undefined,
    });
  });
  const document = new docx.Document({
    sections: [{ children: paragraphs }],
  });
  await fs.writeFile(filePath, await docx.Packer.toBuffer(document));
  return artifact({
    title,
    kind: 'document',
    filePath,
    mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

export async function createPdfArtifact(
  runId: string,
  title: string,
  content: string,
) {
  const PDFDocument = (await import('pdfkit')).default;
  const dir = await ensureRunArtifactDir(runId);
  const filePath = path.join(dir, `${slugify(title)}.pdf`);
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 56 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', async () => {
      try {
        await fs.writeFile(filePath, Buffer.concat(chunks));
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    doc.on('error', reject);
    for (const paragraph of content.split(/\n{2,}/)) {
      doc.fontSize(12).text(paragraph.trim() || ' ', { lineGap: 4 });
      doc.moveDown();
    }
    doc.end();
  });
  return artifact({
    title,
    kind: 'document',
    filePath,
    mimeType: 'application/pdf',
  });
}

export async function createPresentationArtifact(
  runId: string,
  title: string,
  slides: Array<{ title: string; body: string; notes?: string }>,
) {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const dir = await ensureRunArtifactDir(runId);
  const filePath = path.join(dir, `${slugify(title)}.pptx`);
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Neura';
  pptx.subject = title;
  pptx.title = title;
  pptx.company = 'Neura';
  pptx.theme = {
    headFontFace: 'Aptos Display',
    bodyFontFace: 'Aptos',
  };

  for (const item of slides) {
    const slide = pptx.addSlide();
    slide.background = { color: 'F8FAFC' };
    slide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: 13.333,
      h: 0.18,
      fill: { color: '2563EB' },
      line: { color: '2563EB' },
    });
    slide.addText(item.title, {
      x: 0.65,
      y: 0.55,
      w: 11.9,
      h: 0.7,
      fontFace: 'Aptos Display',
      fontSize: 30,
      bold: true,
      color: '0F172A',
      fit: 'shrink',
    });
    slide.addText(item.body, {
      x: 0.75,
      y: 1.55,
      w: 11.7,
      h: 4.7,
      fontFace: 'Aptos',
      fontSize: 17,
      color: '334155',
      breakLine: false,
      fit: 'shrink',
    });
    if (item.notes) {
      slide.addNotes(item.notes);
    }
  }

  if (slides.length > 1) {
    const chartSlide = pptx.addSlide();
    chartSlide.background = { color: 'F8FAFC' };
    chartSlide.addText('Content Structure', {
      x: 0.65,
      y: 0.45,
      w: 11.9,
      h: 0.5,
      fontFace: 'Aptos Display',
      fontSize: 26,
      bold: true,
      color: '0F172A',
    });
    chartSlide.addChart(
      pptx.ChartType.bar,
      [
        {
          name: 'Slide weight',
          labels: slides.map((item) => item.title.slice(0, 24)),
          values: slides.map((item) => Math.max(1, item.body.length)),
        },
      ],
      {
        x: 0.8,
        y: 1.25,
        w: 11.4,
        h: 4.8,
        showLegend: false,
        showValue: false,
        catAxisLabelFontFace: 'Aptos',
        valAxisLabelFontFace: 'Aptos',
      },
    );
    chartSlide.addNotes(
      'Auto-generated chart showing relative section length.',
    );
  }

  await pptx.writeFile({ fileName: filePath });
  return artifact({
    title,
    kind: 'presentation',
    filePath,
    mimeType:
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });
}

export async function createWebsiteProjectArtifact(
  runId: string,
  title: string,
  prompt: string,
) {
  const dir = await ensureRunArtifactDir(runId);
  const projectDir = path.join(dir, slugify(title));
  await fs.mkdir(path.join(projectDir, 'src'), { recursive: true });
  await fs.writeFile(
    path.join(projectDir, 'package.json'),
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
        devDependencies: {},
      },
      null,
      2,
    ),
    'utf8',
  );
  await fs.writeFile(
    path.join(projectDir, 'index.html'),
    '<!doctype html><html><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Neura App</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
    'utf8',
  );
  await fs.writeFile(
    path.join(projectDir, 'src', 'main.tsx'),
    "import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport './styles.css';\nimport App from './App';\n\ncreateRoot(document.getElementById('root')!).render(<App />);\n",
    'utf8',
  );
  await fs.writeFile(
    path.join(projectDir, 'src', 'App.tsx'),
    `const brief = ${JSON.stringify(prompt)};\n\nexport default function App() {\n  return (\n    <main className="shell">\n      <section className="hero">\n        <p className="eyebrow">Generated by Neura</p>\n        <h1>${title.replace(/`/g, '')}</h1>\n        <p className="summary">{brief}</p>\n        <div className="actions">\n          <a href="#details">Explore</a>\n          <a href="mailto:hello@example.com">Contact</a>\n        </div>\n      </section>\n      <section id="details" className="grid">\n        {['Fast to adapt', 'Local-first', 'Ready to extend'].map((item) => (\n          <article key={item}>\n            <h2>{item}</h2>\n            <p>This starter app is intentionally simple so the agent can iterate on real code quickly.</p>\n          </article>\n        ))}\n      </section>\n    </main>\n  );\n}\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(projectDir, 'src', 'styles.css'),
    'body{margin:0;font-family:Inter,Arial,sans-serif;background:#f7f8fb;color:#172033}.shell{min-height:100vh}.hero{padding:72px 8vw 48px;background:#101828;color:white}.eyebrow{color:#93c5fd;text-transform:uppercase;letter-spacing:.08em;font-size:12px}.hero h1{max-width:900px;font-size:clamp(40px,6vw,76px);line-height:1;margin:16px 0}.summary{max-width:760px;font-size:18px;color:#dbe4f0}.actions{display:flex;gap:12px;margin-top:28px}.actions a{background:#fff;color:#101828;padding:12px 16px;border-radius:8px;text-decoration:none;font-weight:700}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;padding:32px 8vw}.grid article{background:white;border:1px solid #e5e7eb;border-radius:8px;padding:20px;box-shadow:0 8px 24px rgba(15,23,42,.06)}',
    'utf8',
  );

  return artifact({
    title,
    kind: 'website',
    filePath: projectDir,
    mimeType: 'inode/directory',
  });
}

export async function createWebsiteZipArtifact(
  runId: string,
  title: string,
  projectDir: string,
) {
  const JSZip = (await import('jszip')).default;
  const dir = await ensureRunArtifactDir(runId);
  const zipPath = path.join(dir, `${slugify(title)}.zip`);
  const zip = new JSZip();

  const addPath = async (sourcePath: string, archiveName: string) => {
    const stats = await fs.stat(sourcePath);
    if (stats.isDirectory()) {
      const entries = await fs.readdir(sourcePath);
      for (const entry of entries) {
        if (entry === 'node_modules' || entry === 'dist') {
          continue;
        }
        await addPath(
          path.join(sourcePath, entry),
          path.join(archiveName, entry),
        );
      }
      return;
    }
    zip.file(archiveName.replace(/\\/g, '/'), await fs.readFile(sourcePath));
  };

  await addPath(projectDir, path.basename(projectDir));
  await fs.writeFile(zipPath, await zip.generateAsync({ type: 'nodebuffer' }));
  return artifact({
    title,
    kind: 'archive',
    filePath: zipPath,
    mimeType: 'application/zip',
  });
}

export async function createPlaceholderImageArtifact(
  runId: string,
  title: string,
  prompt: string,
) {
  const dir = await ensureRunArtifactDir(runId);
  const filePath = path.join(dir, `${slugify(title)}.svg`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="#0f172a"/><rect x="80" y="80" width="1040" height="640" rx="32" fill="#f8fafc"/><text x="120" y="180" font-family="Arial" font-size="44" font-weight="700" fill="#0f172a">${title.replace(/&/g, '&amp;')}</text><foreignObject x="120" y="240" width="960" height="360"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Arial;font-size:28px;line-height:1.4;color:#334155">${prompt.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div></foreignObject><text x="120" y="660" font-family="Arial" font-size="20" fill="#2563eb">Provider-backed generation can replace this placeholder when configured.</text></svg>`;
  await fs.writeFile(filePath, svg, 'utf8');
  return artifact({
    title,
    kind: 'image',
    filePath,
    mimeType: 'image/svg+xml',
    previewPath: filePath,
  });
}
