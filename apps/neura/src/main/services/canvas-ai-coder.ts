/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import OpenAI from 'openai';

import { SettingStore } from '@main/store/setting';
import {
  CanvasComposerStep,
  CanvasProject,
  CanvasProjectFile,
} from './canvas-service';

const MAX_CONTEXT_FILES = 18;
const MAX_FILE_CHARS = 12_000;

export type CanvasAiPlan = {
  summary: string;
  steps: Array<{
    title: string;
    detail: string;
    kind: CanvasComposerStep['kind'];
    filePaths?: string[];
    command?: string;
  }>;
};

export type CanvasAiEdit = {
  filePath: string;
  content: string;
  rationale?: string;
};

export type CanvasAiEdits = {
  summary: string;
  edits: CanvasAiEdit[];
  verificationCommand?: string;
};

export type CanvasAiAnswer = {
  summary: string;
  referencedFiles?: string[];
  followUps?: string[];
};

export type CanvasAiConfigStatus = {
  configured: boolean;
  baseURL: string | null;
  model: string | null;
};

const getNimConfig = () => {
  const settings = SettingStore.getStore();
  const baseURL = settings.plannerBaseUrl || settings.vlmBaseUrl;
  const apiKey = settings.plannerApiKey || settings.vlmApiKey;
  const model =
    settings.usePlannerModel !== false && settings.plannerModelName
      ? settings.plannerModelName
      : settings.vlmModelName;

  if (!baseURL || !apiKey || !model) {
    throw new Error(
      'NVIDIA NIM coding model is not configured. Add the NVIDIA NIM API key and planner model in Neura settings.',
    );
  }

  return {
    baseURL,
    apiKey,
    model,
    timeout: settings.plannerTimeoutInMs || settings.modelTimeoutInMs || 120_000,
  };
};

const getNimConfigStatus = (): CanvasAiConfigStatus => {
  const settings = SettingStore.getStore();
  const baseURL = settings.plannerBaseUrl || settings.vlmBaseUrl || null;
  const apiKey = settings.plannerApiKey || settings.vlmApiKey || '';
  const model =
    settings.usePlannerModel !== false && settings.plannerModelName
      ? settings.plannerModelName
      : settings.vlmModelName || null;

  return {
    configured: Boolean(baseURL && apiKey && model),
    baseURL,
    model,
  };
};

const importantFiles = (project: CanvasProject) => {
  const priority = [
    'package.json',
    'vite.config.ts',
    'next.config.js',
    'src/App.tsx',
    'src/app.tsx',
    'src/main.tsx',
    'index.html',
    'src/styles.css',
    'src/index.css',
  ];
  return [...project.files]
    .sort((left, right) => {
      const leftIndex = priority.indexOf(left.path);
      const rightIndex = priority.indexOf(right.path);
      if (leftIndex !== -1 || rightIndex !== -1) {
        return (
          (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) -
          (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex)
        );
      }
      return left.path.localeCompare(right.path);
    })
    .slice(0, MAX_CONTEXT_FILES);
};

const renderFile = (file: CanvasProjectFile) =>
  `<file path="${file.path}" language="${file.language}">\n${file.content.slice(
    0,
    MAX_FILE_CHARS,
  )}\n</file>`;

const renderProjectContext = (project: CanvasProject) =>
  [
    `Project: ${project.title}`,
    `Root: ${project.rootPath}`,
    `Entry file: ${project.entryFile}`,
    '',
    importantFiles(project).map(renderFile).join('\n\n'),
  ].join('\n');

const extractJson = <T>(content: string): T => {
  const trimmed = content.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced?.[1] || trimmed;
  const start = Math.min(
    ...[candidate.indexOf('{'), candidate.indexOf('[')].filter(
      (index) => index >= 0,
    ),
  );
  if (!Number.isFinite(start)) {
    throw new Error('NVIDIA NIM returned no JSON payload.');
  }
  const json = candidate.slice(start);
  return JSON.parse(json) as T;
};

const completeJson = async (system: string, user: string) => {
  const config = getNimConfig();
  const client = new OpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    maxRetries: 0,
    defaultHeaders: config.baseURL.includes('openrouter.ai')
      ? {
          'HTTP-Referer': 'https://neura.desktop',
          'X-Title': 'Neura Desktop',
        }
      : undefined,
  });
  const response = await client.chat.completions.create(
    {
      model: config.model,
      temperature: 0.15,
      max_tokens: 3200,
      stream: false,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    },
    { timeout: config.timeout },
  );
  const content = response.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('NVIDIA NIM returned an empty coding response.');
  }
  return content;
};

export class CanvasAiCoder {
  static getConfigStatus() {
    return getNimConfigStatus();
  }

  static async answer(project: CanvasProject, prompt: string) {
    const content = await completeJson(
      [
        'You are Neura IDE Ask Mode, an expert coding assistant.',
        'Answer using only the provided real project files and project metadata.',
        'Do not propose file edits, do not claim you ran commands, and do not invent missing implementation details.',
        'Return only valid JSON with shape: {"summary":"...","referencedFiles":["..."],"followUps":["..."]}.',
      ].join('\n'),
      [
        renderProjectContext(project),
        '',
        `User question: ${prompt}`,
      ].join('\n'),
    );
    return extractJson<CanvasAiAnswer>(content);
  }

  static async generatePlan(project: CanvasProject, prompt: string) {
    const content = await completeJson(
      [
        'You are Neura IDE Composer, an expert AI coding planner.',
        'Use the provided real project files only. Do not invent unavailable files unless the requested app needs new files.',
        'Return only valid JSON with shape: {"summary":"...","steps":[{"title":"...","detail":"...","kind":"plan|edit|terminal|verify","filePaths":["..."],"command":"optional"}]}.',
        'Keep plans practical for building production websites and apps. Include a verification command when the project has one.',
      ].join('\n'),
      [
        renderProjectContext(project),
        '',
        `User request: ${prompt}`,
      ].join('\n'),
    );
    return extractJson<CanvasAiPlan>(content);
  }

  static async generateEdits(project: CanvasProject, prompt: string) {
    const content = await completeJson(
      [
        'You are Neura IDE Agent Mode, an expert AI coding agent.',
        'Generate real file edits for the provided project. Do not use mock behavior, placeholder-only files, or fake hardcoded implementations.',
        'Return only valid JSON with shape: {"summary":"...","verificationCommand":"optional","edits":[{"filePath":"...","content":"full replacement file content","rationale":"..."}]}.',
        'Each edit content must be the complete final file content. Preserve unrelated code.',
      ].join('\n'),
      [
        renderProjectContext(project),
        '',
        `User request: ${prompt}`,
      ].join('\n'),
    );
    const edits = extractJson<CanvasAiEdits>(content);
    if (!Array.isArray(edits.edits) || edits.edits.length === 0) {
      throw new Error('NVIDIA NIM returned no file edits.');
    }
    return edits;
  }

  static async continueAfterTerminal(
    project: CanvasProject,
    prompt: string,
    terminalOutput: string,
  ) {
    const content = await completeJson(
      [
        'You are Neura IDE Agent Mode continuing after a verification command.',
        'Analyze the terminal result and propose the next real code edits if needed.',
        'Return only valid JSON with shape: {"summary":"...","verificationCommand":"optional","edits":[{"filePath":"...","content":"full replacement file content","rationale":"..."}]}.',
        'If no edits are needed, return an empty edits array and a concise summary.',
      ].join('\n'),
      [
        renderProjectContext(project),
        '',
        `Original user request: ${prompt}`,
        '',
        `<terminal>\n${terminalOutput.slice(-12_000)}\n</terminal>`,
      ].join('\n'),
    );
    return extractJson<CanvasAiEdits>(content);
  }
}
