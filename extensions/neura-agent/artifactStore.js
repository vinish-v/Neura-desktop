const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');
const { escapeHtml, nowIso } = require('./utils');

const groupArtifactsByRun = (artifacts = []) => {
  const groups = new Map();
  for (const artifact of artifacts) {
    const runId = artifact.runId || 'workspace';
    if (!groups.has(runId)) groups.set(runId, []);
    groups.get(runId).push(artifact);
  }
  return [...groups.entries()].map(([runId, items]) => ({
    runId,
    items: [...items].sort((a, b) => (a.sequence || 0) - (b.sequence || 0)),
  }));
};

const artifactPreviewPath = (artifact) =>
  artifact?.data?.screenshotPath ||
  artifact?.data?.beforeScreenshotPath ||
  artifact?.data?.afterScreenshotPath ||
  '';

const artifactMarkdown = (artifact) => [
  `### ${artifact.sequence || '?'}. ${artifact.title}`,
  `- Kind: ${artifact.kind}`,
  `- Time: ${artifact.createdAt}`,
  artifact.summary ? `- Summary: ${artifact.summary}` : '',
  artifactPreviewPath(artifact) ? `- Preview: ${artifactPreviewPath(artifact)}` : '',
  artifact.data?.mdPath ? `- Report: ${artifact.data.mdPath}` : '',
  artifact.data?.jsonPath ? `- JSON: ${artifact.data.jsonPath}` : '',
  artifact.comments?.length
    ? `- Comments:\n${artifact.comments.map((comment) => `  - ${comment.createdAt}: ${comment.text}`).join('\n')}`
    : '',
].filter(Boolean).join('\n');

const renderArtifactReportHtml = ({ bundle }) => {
  const groups = groupArtifactsByRun(bundle.artifacts);
  const rows = groups.map((group) => {
    const items = group.items.map((artifact) => {
      const image = artifactPreviewPath(artifact);
      const imageUrl = image ? pathToFileURL(image).href : '';
      const comments = (artifact.comments || [])
        .map((comment) => `<li><span>${escapeHtml(comment.createdAt)}</span>${escapeHtml(comment.text)}</li>`)
        .join('');
      const data = artifact.data || {};
      const beforeUrl = data.beforeScreenshotPath ? pathToFileURL(data.beforeScreenshotPath).href : '';
      const afterUrl = data.afterScreenshotPath ? pathToFileURL(data.afterScreenshotPath).href : '';
      const beforeAfter = data.beforeScreenshotPath || data.afterScreenshotPath
        ? `<div class="before-after">
            ${beforeUrl ? `<figure><img src="${escapeHtml(beforeUrl)}" /><figcaption>Before</figcaption></figure>` : ''}
            ${afterUrl ? `<figure><img src="${escapeHtml(afterUrl)}" /><figcaption>After</figcaption></figure>` : ''}
          </div>`
        : '';
      return `<article class="artifact ${escapeHtml(artifact.kind)}">
        <header><strong>${escapeHtml(artifact.sequence || '?')}. ${escapeHtml(artifact.title)}</strong><span>${escapeHtml(artifact.kind)} / ${escapeHtml(artifact.createdAt)}</span></header>
        <p>${escapeHtml(artifact.summary || '')}</p>
        ${imageUrl ? `<img class="preview" src="${escapeHtml(imageUrl)}" />` : ''}
        ${beforeAfter}
        ${data.domPath ? `<code>${escapeHtml(data.domPath)}</code>` : ''}
        ${data.recordingPath ? `<code>${escapeHtml(data.recordingPath)}</code>` : ''}
        ${comments ? `<h4>Comments</h4><ul>${comments}</ul>` : ''}
      </article>`;
    }).join('\n');
    return `<section><h2>Run ${escapeHtml(group.runId)}</h2>${items}</section>`;
  }).join('\n');
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Neura Run Report</title>
  <style>
    body { margin: 0; padding: 28px; background: #0f0f10; color: #f4f4f5; font: 14px/1.5 system-ui, sans-serif; }
    h1, h2, h3, h4 { margin: 0; }
    header.report { border-bottom: 1px solid #29292f; padding-bottom: 18px; margin-bottom: 22px; }
    .meta { color: #a6a6ad; margin-top: 6px; }
    section { margin: 22px 0; }
    .artifact { border: 1px solid #2b2b31; border-radius: 12px; background: #17171a; margin: 12px 0; padding: 14px; }
    .artifact header { display: flex; justify-content: space-between; gap: 16px; color: #f4f4f5; }
    .artifact header span { color: #a6a6ad; font-size: 12px; }
    .artifact p { color: #d9d9df; }
    code { display: block; white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid #313139; border-radius: 8px; padding: 7px; color: #d7e8ff; background: #101014; margin-top: 8px; }
    img.preview { display: block; max-width: 100%; border: 1px solid #303037; border-radius: 8px; margin-top: 10px; }
    .before-after { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; margin-top: 10px; }
    figure { margin: 0; }
    figure img { width: 100%; border: 1px solid #303037; border-radius: 8px; }
    figcaption, li span { color: #a6a6ad; font-size: 12px; }
  </style>
</head>
<body>
  <header class="report">
    <h1>Neura Run Report</h1>
    <div class="meta">${escapeHtml(bundle.project)} / ${escapeHtml(bundle.id)} / ${escapeHtml(bundle.createdAt)}</div>
    <div class="meta">${escapeHtml(bundle.rootPath)}</div>
  </header>
  ${rows || '<p>No artifacts recorded.</p>'}
</body>
</html>`;
};

const writeArtifactBundle = async ({ bundleDir, baseName, bundle, markdown }) => {
  await fs.mkdir(bundleDir, { recursive: true });
  const jsonPath = path.join(bundleDir, `${baseName}.json`);
  const mdPath = path.join(bundleDir, `${baseName}.md`);
  const htmlPath = path.join(bundleDir, `${baseName}.html`);
  await fs.writeFile(jsonPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
  await fs.writeFile(mdPath, markdown, 'utf8');
  await fs.writeFile(htmlPath, renderArtifactReportHtml({ bundle }), 'utf8');
  return { jsonPath, mdPath, htmlPath, createdAt: nowIso() };
};

module.exports = {
  groupArtifactsByRun,
  artifactPreviewPath,
  artifactMarkdown,
  renderArtifactReportHtml,
  writeArtifactBundle,
};
