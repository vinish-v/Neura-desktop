/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */

export type LauncherTaskId =
  | 'create_slides'
  | 'build_website'
  | 'develop_app'
  | 'design_asset'
  | 'wide_research'
  | 'browser_operator'
  | 'connectors_automations';

export type LauncherTask = {
  id: LauncherTaskId;
  title: string;
  detail: string;
  prompt: string;
  iconKey:
    | 'slides'
    | 'website'
    | 'code'
    | 'design'
    | 'research'
    | 'browser'
    | 'connectors';
  expectedOutcome: string;
};

export const MANUS_STYLE_LAUNCHER_TASKS: LauncherTask[] = [
  {
    id: 'create_slides',
    title: 'Create Slides',
    detail: 'Research, outline, deck, proof',
    iconKey: 'slides',
    expectedOutcome: 'presentation',
    prompt:
      'Create a polished presentation deck with a clear narrative, source-backed facts, speaker notes, and a local PPTX artifact.',
  },
  {
    id: 'build_website',
    title: 'Build Website',
    detail: 'Working local preview',
    iconKey: 'website',
    expectedOutcome: 'website',
    prompt:
      'Build a production-quality website from this brief, save it as a local project, run a preview, validate the output, and export the finished files.',
  },
  {
    id: 'develop_app',
    title: 'Develop App',
    detail: 'Plan, code, test',
    iconKey: 'code',
    expectedOutcome: 'app',
    prompt:
      'Develop the requested app feature locally: inspect the project, make the needed code changes, run focused tests or typecheck, and summarize the proof.',
  },
  {
    id: 'design_asset',
    title: 'Design',
    detail: 'Images and visual assets',
    iconKey: 'design',
    expectedOutcome: 'design',
    prompt:
      'Create a design asset or visual direction using configured local/provider tools only, save the real artifact, and explain any missing provider setup.',
  },
  {
    id: 'wide_research',
    title: 'Wide Research',
    detail: 'Multi-source validation',
    iconKey: 'research',
    expectedOutcome: 'report',
    prompt:
      '/multi-agent Run Wide Research on this topic. Use browser-grounded sources, score source quality, validate across multiple sources, and create a cited report.',
  },
  {
    id: 'browser_operator',
    title: 'Browser Operator',
    detail: 'Navigate and take over',
    iconKey: 'browser',
    expectedOutcome: 'browser task',
    prompt:
      'Use the browser operator to navigate the web task, keep the session recoverable, expose takeover when needed, and report the final state with source proof.',
  },
  {
    id: 'connectors_automations',
    title: 'Connectors',
    detail: 'Approved automations',
    iconKey: 'connectors',
    expectedOutcome: 'connector workflow',
    prompt:
      'Review available connectors and automations for this workflow, request approval before any external write, test enabled status, and record an audit trail.',
  },
];
