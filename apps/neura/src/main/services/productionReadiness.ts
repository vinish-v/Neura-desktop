/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen } from 'electron';

import {
  AgentRunMode,
  HermesBrowserBackend,
  HermesTaskMode,
  LocalStore,
  ProductionReadinessIssue,
  ProductionReadinessReport,
} from '@main/store/types';
import { SettingStore } from '@main/store/setting';
import { checkLocalBrowserHealth } from './hermesBrowserBridge';
import { ConnectorsService } from './connectors-service';
import { getMultimodalToolReadiness } from '@shared/multimodalReadiness';

type ProductionReadinessInput = {
  goal: string;
  runMode: AgentRunMode;
  taskMode?: HermesTaskMode;
  toolsets?: string[];
  browserBackend?: HermesBrowserBackend;
};

const issue = (
  input: Omit<ProductionReadinessIssue, 'id'>,
): ProductionReadinessIssue => ({
  ...input,
  id: `${input.category}-${input.severity}-${input.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`,
});

const modelConfig = (settings: LocalStore) => ({
  baseUrl: (settings.plannerBaseUrl || settings.vlmBaseUrl || '').trim(),
  apiKey: (settings.plannerApiKey || settings.vlmApiKey || '').trim(),
  model:
    settings.usePlannerModel !== false && settings.plannerModelName?.trim()
      ? settings.plannerModelName.trim()
      : (settings.vlmModelName || '').trim(),
});

const needsBrowser = (input: ProductionReadinessInput) =>
  input.runMode === 'gui_browser' ||
  input.runMode === 'executor_browser' ||
  input.runMode === 'wide_research' ||
  input.taskMode === 'research' ||
  input.taskMode === 'scrape' ||
  input.taskMode === 'browser_login' ||
  (input.toolsets || []).some((toolset) =>
    /browser|web|scrape|search/i.test(toolset),
  );

const needsDesktop = (input: ProductionReadinessInput) =>
  input.runMode === 'gui_computer' ||
  (input.toolsets || []).some((toolset) => /computer|desktop|local/i.test(toolset));

const goalMentions = (goal: string, pattern: RegExp) => pattern.test(goal);

const requestedConnectorIds = (goal: string) =>
  [
    goalMentions(goal, /\bgit(?:hub)?\b/i) ? 'github' : '',
    goalMentions(goal, /\bslack\b/i) ? 'slack' : '',
    goalMentions(goal, /\bgmail|mail\b/i) ? 'gmail' : '',
    goalMentions(goal, /\bdrive|google drive\b/i) ? 'google_drive_export' : '',
    goalMentions(goal, /\bmcp\b/i) ? 'custom_mcp' : '',
  ].filter(Boolean);

const requestedMultimodalTools = (goal: string) =>
  [
    goalMentions(goal, /\b(generate|create|make).{0,40}\b(image|picture|visual|logo)\b/i)
      ? 'generate_image'
      : '',
    goalMentions(goal, /\btranscrib(e|ing)|speech[- ]?to[- ]?text|audio transcript\b/i)
      ? 'transcribe_audio'
      : '',
    goalMentions(goal, /\b(text[- ]?to[- ]?speech|voiceover|synthesize speech|audio narration)\b/i)
      ? 'synthesize_speech'
      : '',
    goalMentions(goal, /\b(analy[sz]e|summari[sz]e).{0,40}\b(video|clip|mp4)\b/i)
      ? 'analyze_video'
      : '',
  ].filter(Boolean);

const isComplexLongTask = (input: ProductionReadinessInput) =>
  input.runMode === 'wide_research' ||
  input.runMode === 'multi_agent' ||
  input.runMode === 'mcp_autonomous' ||
  input.goal.length > 500 ||
  /\b(long|complex|multi[- ]step|continue|for hours|research and create|build and test)\b/i.test(
    input.goal,
  );

const summarize = (issues: ProductionReadinessIssue[]) => {
  const blockers = issues.filter((item) => item.severity === 'blocker').length;
  const warnings = issues.filter((item) => item.severity === 'warning').length;
  if (blockers > 0) {
    return `Blocked by ${blockers} setup issue${blockers === 1 ? '' : 's'} before a reliable long task can start.`;
  }
  if (warnings > 0) {
    return `Ready with ${warnings} warning${warnings === 1 ? '' : 's'}; Neura can start but may need takeover or setup during execution.`;
  }
  return 'Ready for production-style execution checks.';
};

export const assessProductionReadiness = async (
  input: ProductionReadinessInput,
): Promise<ProductionReadinessReport> => {
  const settings = SettingStore.getStore();
  const issues: ProductionReadinessIssue[] = [];
  const model = modelConfig(settings);

  if (!model.baseUrl || !model.apiKey || !model.model) {
    issues.push(
      issue({
        severity: 'blocker',
        category: 'model',
        title: 'Planner model is not fully configured',
        detail:
          'Hermes requires a real base URL, API key, and model before Neura can run autonomous tasks.',
        nextAction:
          'Configure the planner or NVIDIA NIM settings. Neura will not fake model output.',
      }),
    );
  }

  const localBrowserRequired =
    needsBrowser(input) &&
    (!input.browserBackend || input.browserBackend === 'local');
  if (localBrowserRequired) {
    const health = await checkLocalBrowserHealth();
    if (!health.executableExists) {
      issues.push(
        issue({
          severity: 'blocker',
          category: 'browser',
          title: 'Local browser automation is unavailable',
          detail: health.issues.join(' ') || 'No supported local browser was found.',
          nextAction:
            'Install Chrome, Edge, Brave, or Chromium, or choose a configured non-local browser backend.',
        }),
      );
    } else if (health.issues.length > 0) {
      issues.push(
        issue({
          severity: 'warning',
          category: 'browser',
          title: 'Browser automation has setup warnings',
          detail: health.issues.join(' '),
          nextAction:
            'Neura can start, but login, captcha, or profile-lock blockers should use Take over and Resume.',
        }),
      );
    }
  }

  if (needsBrowser(input)) {
    issues.push(
      issue({
        severity: 'warning',
        category: 'browser',
        title: 'Human verification may require takeover',
        detail:
          'Neura will not bypass CAPTCHA, login, paywall, or human-verification pages. It should switch source once, then pause for takeover/resume.',
        nextAction:
          'Use Take over in Neura Computer if a site asks for login or human verification.',
      }),
    );
  }

  if (needsDesktop(input)) {
    const displays = screen.getAllDisplays();
    if (displays.length > 1) {
      issues.push(
        issue({
          severity: 'warning',
          category: 'desktop',
          title: 'Multiple displays detected',
          detail:
            'Desktop automation is most reliable on a single primary display. Multi-monitor coordinates can be less predictable.',
          nextAction:
            'Keep the target app on the primary display and use the live Neura Computer view to verify actions.',
        }),
      );
    }
    issues.push(
      issue({
        severity: 'warning',
        category: 'desktop',
        title: 'Desktop state must remain stable',
        detail:
          'Local app automation depends on the active window, OS permissions, and visible UI state.',
        nextAction:
          'Avoid moving the target window during execution; use Take over/Resume if the app state changes.',
      }),
    );
  }

  const connectorIds = requestedConnectorIds(input.goal);
  if (connectorIds.length > 0) {
    const health = await ConnectorsService.getInstance().getHealth();
    for (const connectorId of connectorIds) {
      const record = health.find((item) => item.connectorId === connectorId);
      if (!record || !record.enabled || !record.configured || record.setupGap) {
        issues.push(
          issue({
            severity: 'blocker',
            category: 'connector',
            title: `${record?.displayName || connectorId} connector is not ready`,
            detail:
              record?.setupGap ||
              `${record?.displayName || connectorId} is not enabled and configured.`,
            nextAction:
              'Connect or configure the real connector before asking Neura to perform that external action.',
          }),
        );
      }
    }
  }

  for (const toolName of requestedMultimodalTools(input.goal)) {
    const readiness = getMultimodalToolReadiness(
      toolName,
      settings.multimodalProviders,
    );
    if (!readiness.configured) {
      issues.push(
        issue({
          severity: 'blocker',
          category: 'provider',
          title: `${toolName} provider is not configured`,
          detail: readiness.setupMessage,
          nextAction:
            'Configure a real provider in Settings > Multimodal before running this media task.',
        }),
      );
    }
  }

  if (isComplexLongTask(input)) {
    issues.push(
      issue({
        severity: 'warning',
        category: 'resumability',
        title: 'Long task checkpointing enabled',
        detail:
          'Neura will write checkpoints, evidence, artifacts, browser state, and recovery guidance so the run can be resumed instead of restarted blindly.',
        nextAction:
          'If execution pauses or fails, use Resume first. Use Retry only when the previous attempt should be replaced.',
      }),
    );
  }

  const status = issues.some((item) => item.severity === 'blocker')
    ? 'blocked'
    : issues.some((item) => item.severity === 'warning')
      ? 'degraded'
      : 'ready';

  return {
    status,
    summary: summarize(issues),
    issues,
    checkedAt: Date.now(),
  };
};

export const formatProductionReadinessForPrompt = (
  report?: ProductionReadinessReport,
) => {
  if (!report) {
    return '';
  }
  return [
    'Production readiness preflight:',
    `Status: ${report.status}`,
    `Summary: ${report.summary}`,
    ...report.issues.map(
      (item) =>
        `- [${item.severity}] ${item.category}: ${item.title}. ${item.detail}${
          item.nextAction ? ` Next: ${item.nextAction}` : ''
        }`,
    ),
  ].join('\n');
};
