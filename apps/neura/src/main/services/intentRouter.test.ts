import { describe, expect, it, vi } from 'vitest';

vi.mock('@main/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { Operator, type LocalStore } from '@main/store/types';
import { routeIntent } from './intentRouter';

const settings = {
  vlmBaseUrl: 'https://example.com/v1',
  vlmApiKey: '',
  vlmModelName: 'test-model',
  operator: Operator.LocalComputer,
} as LocalStore;

const route = (instructions: string) =>
  routeIntent({
    configuredOperator: Operator.LocalComputer,
    instructions,
    settings,
  });

describe('intent router run modes', () => {
  it('keeps greetings in direct chat', async () => {
    await expect(route('hi')).resolves.toMatchObject({
      runMode: 'direct',
      complexity: 'simple',
      requiresValidation: false,
    });
  });

  it('keeps stable knowledge questions in direct chat', async () => {
    await expect(route('what is photosynthesis?')).resolves.toMatchObject({
      runMode: 'direct',
      taskType: 'chat',
      operator: Operator.LocalComputer,
    });
  });

  it('routes current weather questions to the local live desktop browser', async () => {
    await expect(
      route("what's the weather today in Mumbai?"),
    ).resolves.toMatchObject({
      runMode: 'gui_computer',
      operator: Operator.LocalComputer,
      taskType: 'browser_research',
    });
  });

  it('routes local runtime checks to the computer operator', async () => {
    await expect(route('check python version')).resolves.toMatchObject({
      runMode: 'gui_computer',
      operator: Operator.LocalComputer,
    });
  });

  it('routes local folder creation to the computer operator', async () => {
    await expect(route('create a folder on desktop')).resolves.toMatchObject({
      runMode: 'gui_computer',
      operator: Operator.LocalComputer,
      taskType: 'local_file',
    });
  });

  it('routes local app typing to the computer operator', async () => {
    await expect(
      route('open Notepad and type the project checklist'),
    ).resolves.toMatchObject({
      runMode: 'gui_computer',
      operator: Operator.LocalComputer,
      taskType: 'local_app',
    });
  });

  it('routes short messaging app actions to the computer operator', async () => {
    await expect(
      route('open chatclient and send hi to Alex'),
    ).resolves.toMatchObject({
      runMode: 'gui_computer',
      operator: Operator.LocalComputer,
      taskType: 'local_app',
    });
  });

  it('routes send-message phrasing to the computer operator', async () => {
    await expect(route('send hi to Alex on chatclient')).resolves.toMatchObject(
      {
        runMode: 'gui_computer',
        operator: Operator.LocalComputer,
        taskType: 'local_app',
      },
    );
  });

  it('keeps messaging tasks with domain-like app names on local computer', async () => {
    await expect(
      route('open chatclient.com and send hi to Alex'),
    ).resolves.toMatchObject({
      runMode: 'gui_computer',
      operator: Operator.LocalComputer,
      taskType: 'local_app',
    });
  });

  it('routes research/news tasks to the local live desktop browser', async () => {
    await expect(
      route('latest AI news and summarize the top article'),
    ).resolves.toMatchObject({
      runMode: 'gui_computer',
      operator: Operator.LocalComputer,
      requiresValidation: true,
      complexity: 'research',
      taskType: 'browser_research',
      verificationRequired: true,
    });
  });

  it('routes structured webpage extraction to the local live desktop browser', async () => {
    await expect(
      route('extract table from this website https://example.com'),
    ).resolves.toMatchObject({
      runMode: 'gui_computer',
      operator: Operator.LocalComputer,
      requiresValidation: true,
    });
  });

  it('keeps simple browser open tasks on the local live desktop path', async () => {
    await expect(route('open YouTube')).resolves.toMatchObject({
      runMode: 'gui_computer',
      operator: Operator.LocalComputer,
    });
  });

  it('routes explicit wide research to the local parallel workflow', async () => {
    await expect(
      route('wide research these competitors: Acme, Globex, Initech'),
    ).resolves.toMatchObject({
      runMode: 'wide_research',
      requiresValidation: true,
      complexity: 'research',
    });
  });

  it('routes website generation to the website builder workflow', async () => {
    await expect(
      route('build a website for my design studio'),
    ).resolves.toMatchObject({
      runMode: 'website_builder',
      complexity: 'multi_step',
    });
  });

  it('routes deck/report generation to the artifact workflow', async () => {
    await expect(
      route('create a presentation deck and report'),
    ).resolves.toMatchObject({
      runMode: 'artifact_workflow',
      complexity: 'multi_step',
    });
  });

  it('routes media requests to the multimodal workflow', async () => {
    await expect(
      route('generate image concepts for the launch'),
    ).resolves.toMatchObject({
      runMode: 'multimodal_workflow',
      complexity: 'multi_step',
    });
  });
});
