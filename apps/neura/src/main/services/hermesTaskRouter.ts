/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  AgentRunMode,
  ArtifactKind,
  HermesBrowserBackend,
  HermesTaskMode,
} from '@main/store/types';
import { LocalStore } from '@main/store/validate';
import {
  classifyUserIntent,
  IntentRiskLevel,
  SemanticIntentContract,
} from '@shared/intentClassification';

export type HermesTaskRoute = {
  taskMode: HermesTaskMode;
  runMode: AgentRunMode;
  toolsets: string[];
  browserBackend: HermesBrowserBackend;
  requiredArtifactKinds: ArtifactKind[];
  requiresSource: boolean;
  requiresBrowser: boolean;
  semanticContract: SemanticIntentContract;
  riskLevel: IntentRiskLevel;
  validationHint: string;
  promptDirectives: string[];
  intentArbitration?: {
    status:
      | 'disabled'
      | 'not_configured'
      | 'skipped'
      | 'accepted'
      | 'rejected'
      | 'failed';
    usedModel: boolean;
    reason: string;
    proposedTaskType?: SemanticIntentContract['taskType'];
  };
};

const includesAny = (value: string, patterns: RegExp[]) =>
  patterns.some((pattern) => pattern.test(value));

const pickBrowserBackend = (
  settings: LocalStore,
  taskMode: HermesTaskMode,
): HermesBrowserBackend => {
  const configured = settings.hermesBrowserBackend || 'local';
  if (taskMode === 'browser_login') {
    return 'local';
  }
  return configured;
};

export const classifyHermesTask = (
  goal: string,
  settings: LocalStore,
  overrideRunMode?: AgentRunMode,
  overrideToolsets?: string[],
): HermesTaskRoute => {
  const text = goal.toLowerCase();
  const semantic = classifyUserIntent(goal);
  let taskMode: HermesTaskMode = 'general';

  if (
    semantic.contract.taskType === 'wide_research' ||
    semantic.kind === 'browser_research'
  ) {
    taskMode = 'research';
  } else if (
    semantic.kind === 'website' ||
    semantic.contract.taskType === 'app_development'
  ) {
    taskMode = 'code';
  } else if (
    semantic.kind === 'artifact' &&
    semantic.contract.expectedArtifacts.some((item) =>
      /spreadsheet|data/i.test(item),
    )
  ) {
    taskMode = 'spreadsheet';
  } else if (
    semantic.kind === 'connector' ||
    semantic.kind === 'automation'
  ) {
    taskMode = semantic.kind === 'automation' ? 'scheduled_job' : 'general';
  } else if (
    includesAny(text, [
      /\blog\s*in\b/,
      /\bsign\s*in\b/,
      /\bauthenticate\b/,
      /\bpassword\b/,
      /\botp\b/,
      /\b2fa\b/,
    ])
  ) {
    taskMode = 'browser_login';
  } else if (
    includesAny(text, [
      /\bscrap(e|ing)\b/,
      /\bextract\b/,
      /\bcrawl\b/,
      /\bleads?\b/,
      /\bjobs?\b/,
      /\blist\s+\d+\b/,
    ])
  ) {
    taskMode = 'scrape';
  } else if (
    includesAny(text, [
      /\bexcel\b/,
      /\bxlsx\b/,
      /\bcsv\b/,
      /\bspreadsheet\b/,
      /\btable\b/,
      /\bworksheet\b/,
    ])
  ) {
    taskMode = 'spreadsheet';
  } else if (
    includesAny(text, [
      /\bcode\b/,
      /\bbuild\b/,
      /\bfix\b/,
      /\bdebug\b/,
      /\bapp\b/,
      /\bwebsite\b/,
      /\brepo\b/,
      /\bcomponent\b/,
    ])
  ) {
    taskMode = 'code';
  } else if (
    includesAny(text, [
      /\bschedule\b/,
      /\bevery\b/,
      /\bdaily\b/,
      /\bweekly\b/,
      /\bcron\b/,
      /\bremind\b/,
    ])
  ) {
    taskMode = 'scheduled_job';
  } else if (
    includesAny(text, [
      /\bresearch\b/,
      /\bfind\b/,
      /\blatest\b/,
      /\bnews\b/,
      /\bcompare\b/,
      /\bprice\b/,
      /\bsource\b/,
    ])
  ) {
    taskMode = 'research';
  }

  const requiresSpreadsheet =
    taskMode === 'spreadsheet' || /\b(excel|xlsx|csv|sheet)\b/.test(text);
  const requiredArtifactKinds: ArtifactKind[] = [];
  if (requiresSpreadsheet) {
    requiredArtifactKinds.push('spreadsheet', 'data');
  }
  if (
    taskMode === 'code' &&
    /\b(create|build|make|generate|export|save|website|app|bundle)\b/.test(text)
  ) {
    requiredArtifactKinds.push('website', 'archive', 'report', 'other');
  }
  if (/\b(pdf|report|document|docx)\b/.test(text)) {
    requiredArtifactKinds.push('document', 'report');
  }
  if (semantic.contract.taskType === 'slide_creation') {
    requiredArtifactKinds.push('presentation');
  }

  const requiresSource =
    semantic.contract.completionProof === 'sources' ||
    semantic.contract.completionProof === 'mixed' ||
    taskMode === 'research' ||
    taskMode === 'scrape' ||
    taskMode === 'browser_login';
  const requiresBrowser =
    requiresSource ||
    includesAny(text, [/\bbrowser\b/, /\bwebsite\b/, /\bpage\b/, /\bchrome\b/]);
  const browserBackend = pickBrowserBackend(settings, taskMode);
  const toolsets = overrideToolsets?.length
    ? overrideToolsets
    : taskMode === 'scheduled_job'
      ? ['hermes-cron', 'hermes-cli']
      : ['hermes-cli'];

  return {
    taskMode,
    runMode:
      overrideRunMode ||
      (taskMode === 'research' ? 'wide_research' : 'multi_agent'),
    toolsets,
    browserBackend,
    requiredArtifactKinds: [...new Set(requiredArtifactKinds)],
    requiresSource,
    requiresBrowser,
    semanticContract: semantic.contract,
    riskLevel: semantic.contract.riskLevel,
    validationHint:
      taskMode === 'scrape'
        ? 'Verify extracted data and saved deliverables before completion.'
        : taskMode === 'spreadsheet'
          ? 'Verify the spreadsheet or data file exists and is non-empty before completion.'
          : taskMode === 'research'
            ? 'Verify the answer is grounded in at least one visited source.'
            : 'Verify the final answer is complete and supported by runtime evidence.',
    promptDirectives: [
      `Semantic task contract: ${semantic.contract.taskType}; risk: ${semantic.contract.riskLevel}; proof: ${semantic.contract.completionProof}.`,
      semantic.contract.requiredTools.length
        ? `Required tool families: ${semantic.contract.requiredTools.join(', ')}.`
        : 'No operating tools are required unless the task reveals a concrete need.',
      semantic.contract.expectedArtifacts.length
        ? `Expected user-facing outputs: ${semantic.contract.expectedArtifacts.join(', ')}.`
        : 'If no artifact is requested, return a concise final answer with evidence.',
      semantic.contract.needsApproval
        ? 'Request explicit approval before external writes, destructive local changes, or connector actions.'
        : 'Do not ask for approval unless a risky write or external action becomes necessary.',
      `Task mode: ${taskMode}.`,
      `Browser backend preference: ${browserBackend}.`,
      requiresSource
        ? 'Use browser or web tools and expose visited sources.'
        : 'Use browser tools only when they materially help.',
      requiredArtifactKinds.length
        ? `Save deliverables as first-class files when useful. Expected artifact kinds: ${requiredArtifactKinds.join(', ')}.`
        : 'Save user-facing deliverables into the workspace when the task creates files.',
    ],
  };
};
