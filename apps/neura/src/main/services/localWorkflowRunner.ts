/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { StatusEnum } from '@neura-desktop/shared/types';
import OpenAI from 'openai';

import { AgentRunMode, AppState } from '@main/store/types';
import { SettingStore } from '@main/store/setting';
import { AgentOrchestrator } from './agentOrchestrator';
import {
  createCsvArtifact,
  createDocxArtifact,
  createFormattedWorkbookArtifact,
  createMarkdownArtifact,
  createPdfArtifact,
  createPlaceholderImageArtifact,
  createPresentationArtifact,
  createWebsiteProjectArtifact,
  createWebsiteZipArtifact,
} from './artifactStudio';

type RunnerArgs = {
  instructions: string;
  runMode: Extract<
    AgentRunMode,
    | 'wide_research'
    | 'website_builder'
    | 'artifact_workflow'
    | 'multimodal_workflow'
  >;
  setState: (state: AppState) => void;
  getState: () => AppState;
};

type ResearchRow = {
  item: string;
  worker: string;
  summary: string;
  sources: string;
  confidence: string;
  status: 'done' | 'failed';
  error?: string;
};

type ResearchWorkerConfig = {
  baseURL: string;
  apiKey: string;
  model: string;
  timeout: number;
};

export const parseResearchItems = (instructions: string) => {
  const lines = instructions
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const listItems = lines
    .map((line) => line.match(/^(?:[-*]|\d+[.)])\s+(.+)$/)?.[1]?.trim())
    .filter((item): item is string => Boolean(item));
  if (listItems.length > 1) {
    return listItems;
  }

  const afterColon = instructions.split(/items?:/i)[1];
  const commaItems = (afterColon || instructions)
    .split(/[,;]\s*/)
    .map((item) => item.trim())
    .filter((item) => item.length > 2 && item.length < 120);
  return commaItems.length > 1
    ? commaItems
    : ['Market', 'Competitors', 'Risks', 'Opportunities'];
};

const getResearchWorkerConfig = (): ResearchWorkerConfig | null => {
  const settings = SettingStore.getStore();
  const baseURL = settings.plannerBaseUrl || settings.vlmBaseUrl;
  const apiKey = settings.plannerApiKey || settings.vlmApiKey;
  const model =
    settings.usePlannerModel !== false && settings.plannerModelName
      ? settings.plannerModelName
      : settings.vlmModelName;

  if (!baseURL || !apiKey || !model) {
    return null;
  }

  return {
    baseURL,
    apiKey,
    model,
    timeout: settings.plannerTimeoutInMs || 90_000,
  };
};

export const extractResearchJsonObject = (value: string) => {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || value;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('Research worker returned no JSON object.');
  }
  return JSON.parse(candidate.slice(start, end + 1)) as {
    summary?: string;
    facts?: string[];
    sources?: string[];
    confidence?: number | string;
  };
};

const failedResearchRow = (
  item: string,
  worker: string,
  error?: string,
): ResearchRow => ({
  item,
  worker,
  summary: error
    ? `Worker could not complete live research for ${item}: ${error}`
    : `Worker could not complete live research for ${item}: planner/chat model is not configured.`,
  sources: '',
  confidence: '0.00',
  status: 'failed',
  error: error || 'Planner/chat model is not configured.',
});

export const runResearchWorker = async ({
  item,
  index,
  instructions,
  config,
}: {
  item: string;
  index: number;
  instructions: string;
  config: ResearchWorkerConfig | null;
}): Promise<ResearchRow> => {
  const worker = `worker-${(index % 4) + 1}`;
  if (!config) {
    return failedResearchRow(item, worker);
  }

  try {
    const client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      maxRetries: 0,
    });
    const completion = await client.chat.completions.create(
      {
        model: config.model,
        temperature: 0.2,
        stream: false,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You are one independent wide-research worker. Return only JSON with keys: summary, facts, sources, confidence. Sources must be URLs or source names actually used from the prompt/context; if you did not browse, leave sources empty. Do not fabricate citations.',
          },
          {
            role: 'user',
            content: [
              `Overall goal: ${instructions}`,
              `Assigned item: ${item}`,
              'Produce a concise research finding for this item. Include 2-5 concrete facts, confidence from 0 to 1, and sources only when grounded.',
            ].join('\n\n'),
          },
        ],
      },
      { timeout: config.timeout },
    );
    const content = completion.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('Empty model response.');
    }
    const parsed = extractResearchJsonObject(content);
    const facts = Array.isArray(parsed.facts)
      ? parsed.facts.filter(Boolean).join(' ')
      : '';
    const sources = Array.isArray(parsed.sources)
      ? parsed.sources.filter(Boolean).slice(0, 5)
      : [];
    const confidenceValue =
      typeof parsed.confidence === 'number'
        ? parsed.confidence
        : Number.parseFloat(String(parsed.confidence || '0.55'));

    return {
      item,
      worker,
      summary:
        parsed.summary?.trim() ||
        facts ||
        `Model worker returned limited findings for ${item}.`,
      sources: sources.join('; '),
      confidence: Number.isFinite(confidenceValue)
        ? confidenceValue.toFixed(2)
        : '0.55',
      status: 'done',
    };
  } catch (error) {
    return failedResearchRow(
      item,
      worker,
      error instanceof Error ? error.message : String(error),
    );
  }
};

const runBounded = async <T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
) => {
  const results: R[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        results[index] = await worker(items[index], index);
      }
    }),
  );
  return results;
};

async function runWideResearch(
  orchestrator: AgentOrchestrator,
  instructions: string,
) {
  const runId = orchestrator.getCurrentRunId();
  const items = parseResearchItems(instructions);
  const workerConfig = getResearchWorkerConfig();
  orchestrator.emit({
    type: 'plan.updated',
    title: `Wide Research plan: ${items.length} items`,
    detail: `${workerConfig ? 'Model-backed' : 'Model configuration required'} local concurrency: 4. Items: ${items.slice(0, 10).join(', ')}`,
    status: 'done',
  });

  const rows = await runBounded(items, 4, async (item, index) => {
    orchestrator.emit({
      type: 'step.started',
      title: `Research item ${index + 1}/${items.length}: ${item}`,
      detail: 'Running an independent local worker with fresh task context.',
      status: 'in_progress',
    });
    const row = await runResearchWorker({
      item,
      index,
      instructions,
      config: workerConfig,
    });
    orchestrator.addFact(`${item}: ${row.summary}`);
    row.sources
      .split(';')
      .map((source) => source.trim())
      .filter(Boolean)
      .forEach((source) => orchestrator.addSource(source));
    orchestrator.emit({
      type: row.status === 'done' ? 'step.completed' : 'step.failed',
      title: `${row.status === 'done' ? 'Completed' : 'Failed'} ${item}`,
      detail: row.error ? `${row.summary}\n${row.error}` : row.summary,
      status: row.status === 'done' ? 'done' : 'failed',
    });
    return row;
  });

  const markdown = [
    '# Wide Research Results',
    '',
    `Goal: ${instructions}`,
    '',
    '| Item | Status | Summary | Sources | Confidence |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map(
      (row) =>
        `| ${row.item.replace(/\|/g, '\\|')} | ${row.status} | ${row.summary.replace(/\|/g, '\\|')} | ${(row.sources || 'None').replace(/\|/g, '\\|')} | ${row.confidence} |`,
    ),
    '',
    workerConfig
      ? 'Workers used the configured planner/chat model. Sources are included only when returned by the worker.'
      : 'No fallback research was generated. Configure a planner/chat model to run independent workers.',
  ].join('\n');
  const reportArtifact = await createMarkdownArtifact(
    runId,
    'Wide Research Report',
    markdown,
  );
  const csvArtifact = await createCsvArtifact(
    runId,
    'Wide Research Data',
    rows,
  );
  const workbookArtifact = await createFormattedWorkbookArtifact(
    runId,
    'Wide Research Workbook',
    rows,
  );
  [reportArtifact, csvArtifact, workbookArtifact].forEach((artifact) =>
    orchestrator.addArtifact(artifact),
  );
  orchestrator.setCompletionProof({
    kind: 'artifact',
    summary: `Wide Research produced ${rows.length} worker records and synthesized artifacts.`,
    evidence: [
      reportArtifact.path,
      csvArtifact.path,
      workbookArtifact.path,
      ...rows.flatMap((row) =>
        row.sources
          .split(';')
          .map((source) => source.trim())
          .filter(Boolean),
      ),
    ].slice(0, 20),
    verifiedAt: Date.now(),
  });
  orchestrator.complete(
    `Wide Research completed for ${items.length} items with ${rows.filter((row) => row.status === 'done').length} completed and ${rows.filter((row) => row.status === 'failed').length} failed workers. I created a report, CSV, and formatted workbook.`,
  );
}

async function runArtifactWorkflow(
  orchestrator: AgentOrchestrator,
  instructions: string,
) {
  const runId = orchestrator.getCurrentRunId();
  orchestrator.emit({
    type: 'plan.updated',
    title: 'Artifact Studio plan',
    detail:
      'Create a report, presentation, and formatted workbook from the prompt.',
    status: 'done',
  });
  const rows = [
    { section: 'Objective', detail: instructions },
    {
      section: 'Approach',
      detail: 'Use local-first artifact generation with reusable metadata.',
    },
    {
      section: 'Next step',
      detail:
        'Replace scaffold content with model-assisted research and charts.',
    },
  ];
  const report = `# Artifact Workflow\n\n## Objective\n${instructions}\n\n## Generated Outputs\n- Report\n- Presentation\n- Workbook\n`;
  const reportArtifact = await createMarkdownArtifact(
    runId,
    'Artifact Report',
    report,
  );
  const docxArtifact = await createDocxArtifact(
    runId,
    'Artifact Report Document',
    report,
  );
  const pdfArtifact = await createPdfArtifact(
    runId,
    'Artifact Report PDF',
    report,
  );
  const presentationArtifact = await createPresentationArtifact(
    runId,
    'Artifact Presentation',
    [
      {
        title: 'Objective',
        body: instructions,
        notes: 'Open with the user goal.',
      },
      {
        title: 'Approach',
        body: 'Neura now tracks generated artifacts and can produce deck/workbook/report outputs from one workflow.',
        notes: 'Explain local-first artifact generation.',
      },
      {
        title: 'Next Steps',
        body: 'Add provider-backed research, richer charting, and template selection.',
        notes: 'Close with implementation roadmap.',
      },
    ],
  );
  const workbookArtifact = await createFormattedWorkbookArtifact(
    runId,
    'Artifact Workbook',
    rows,
  );
  [
    reportArtifact,
    docxArtifact,
    pdfArtifact,
    presentationArtifact,
    workbookArtifact,
  ].forEach((artifact) => orchestrator.addArtifact(artifact));
  orchestrator.setCompletionProof({
    kind: 'artifact',
    summary:
      'Artifact workflow produced report, document, PDF, deck, and workbook outputs.',
    evidence: [
      reportArtifact.path,
      docxArtifact.path,
      pdfArtifact.path,
      presentationArtifact.path,
      workbookArtifact.path,
    ],
    verifiedAt: Date.now(),
  });
  orchestrator.complete(
    'Artifact workflow completed. I created a report, presentation, and workbook.',
  );
}

async function runWebsiteBuilder(
  orchestrator: AgentOrchestrator,
  instructions: string,
) {
  const runId = orchestrator.getCurrentRunId();
  orchestrator.emit({
    type: 'plan.updated',
    title: 'Website Builder plan',
    detail:
      'Generate a Vite + React + TypeScript starter project and zip export as local artifacts.',
    status: 'done',
  });
  const projectArtifact = await createWebsiteProjectArtifact(
    runId,
    'Neura Generated Website',
    instructions,
  );
  orchestrator.addArtifact(projectArtifact);
  const zipArtifact = await createWebsiteZipArtifact(
    runId,
    'Neura Generated Website Export',
    projectArtifact.path,
  );
  orchestrator.addArtifact(zipArtifact);
  orchestrator.setCompletionProof({
    kind: 'artifact',
    summary: 'Website builder produced a local project and zip export.',
    evidence: [projectArtifact.path, zipArtifact.path],
    verifiedAt: Date.now(),
  });
  orchestrator.complete(
    'Website project and zip export generated. Use start_website_preview(path=...) to launch a local preview when dependencies are installed.',
  );
}

async function runMultimodalWorkflow(
  orchestrator: AgentOrchestrator,
  instructions: string,
) {
  const runId = orchestrator.getCurrentRunId();
  orchestrator.emit({
    type: 'plan.updated',
    title: 'Multimodal workflow plan',
    detail:
      'Create a media artifact placeholder and record provider-backed next steps.',
    status: 'done',
  });
  const imageArtifact = await createPlaceholderImageArtifact(
    runId,
    'Generated Image Placeholder',
    instructions,
  );
  const notesArtifact = await createMarkdownArtifact(
    runId,
    'Multimodal Provider Notes',
    `# Multimodal Workflow\n\nPrompt: ${instructions}\n\nProvider-backed image, audio, transcription, and video tools are now represented in settings/types and native action space. Configure providers to replace placeholders with live generation.`,
    'document',
  );
  [imageArtifact, notesArtifact].forEach((artifact) =>
    orchestrator.addArtifact(artifact),
  );
  orchestrator.setCompletionProof({
    kind: 'artifact',
    summary: 'Multimodal workflow produced media and provider-note artifacts.',
    evidence: [imageArtifact.path, notesArtifact.path],
    verifiedAt: Date.now(),
  });
  orchestrator.complete(
    'Multimodal workflow completed with placeholder media artifacts and provider notes.',
  );
}

export async function runLocalWorkflowAgent({
  instructions,
  runMode,
  setState,
  getState,
}: RunnerArgs) {
  const orchestrator = new AgentOrchestrator({ getState, setState });
  orchestrator.begin(instructions, runMode);

  try {
    if (runMode === 'wide_research') {
      await runWideResearch(orchestrator, instructions);
    } else if (runMode === 'website_builder') {
      await runWebsiteBuilder(orchestrator, instructions);
    } else if (runMode === 'artifact_workflow') {
      await runArtifactWorkflow(orchestrator, instructions);
    } else {
      await runMultimodalWorkflow(orchestrator, instructions);
    }
  } catch (error) {
    orchestrator.fail(error instanceof Error ? error.message : String(error));
    setState({
      ...getState(),
      status: StatusEnum.ERROR,
    });
  }
}
