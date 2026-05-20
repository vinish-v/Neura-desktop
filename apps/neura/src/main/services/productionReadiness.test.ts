import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  settings: {
    plannerBaseUrl: 'https://api.example.test/v1',
    plannerApiKey: 'planner-key',
    plannerModelName: 'planner-model',
    usePlannerModel: true,
    vlmBaseUrl: '',
    vlmApiKey: '',
    vlmModelName: '',
    multimodalProviders: {},
  },
  browserHealth: {
    executableExists: true,
    issues: [],
  },
  connectorHealth: [] as any[],
  displays: [{ id: 1 }],
}));

vi.mock('electron', () => ({
  screen: {
    getAllDisplays: () => mocks.displays,
  },
}));

vi.mock('@main/store/setting', () => ({
  SettingStore: {
    getStore: () => mocks.settings,
  },
}));

vi.mock('./hermesBrowserBridge', () => ({
  checkLocalBrowserHealth: vi.fn(async () => mocks.browserHealth),
}));

vi.mock('./connectors-service', () => ({
  ConnectorsService: {
    getInstance: () => ({
      getHealth: vi.fn(async () => mocks.connectorHealth),
    }),
  },
}));

import { assessProductionReadiness } from './productionReadiness';

describe('production readiness preflight', () => {
  it('blocks long tasks when the planner model is missing', async () => {
    mocks.settings = {
      ...mocks.settings,
      plannerBaseUrl: '',
      plannerApiKey: '',
      plannerModelName: '',
      vlmBaseUrl: '',
      vlmApiKey: '',
      vlmModelName: '',
    };

    const report = await assessProductionReadiness({
      goal: 'Do a complex browser research task',
      runMode: 'wide_research',
      taskMode: 'research',
      toolsets: ['browser'],
      browserBackend: 'local',
    });

    expect(report.status).toBe('blocked');
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'model',
          severity: 'blocker',
        }),
      ]),
    );
  });

  it('blocks requested connector work when the connector is not ready', async () => {
    mocks.settings = {
      ...mocks.settings,
      plannerBaseUrl: 'https://api.example.test/v1',
      plannerApiKey: 'planner-key',
      plannerModelName: 'planner-model',
    };
    mocks.connectorHealth = [
      {
        connectorId: 'github',
        displayName: 'GitHub',
        enabled: false,
        configured: false,
        setupGap: 'GitHub token is missing.',
      },
    ];

    const report = await assessProductionReadiness({
      goal: 'Use GitHub to create an issue from this report',
      runMode: 'mcp_autonomous',
      taskMode: 'general',
      toolsets: ['connectors'],
    });

    expect(report.status).toBe('blocked');
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'connector',
          title: 'GitHub connector is not ready',
        }),
      ]),
    );
  });

  it('warns, but does not block, for human-verification and resume risks', async () => {
    mocks.connectorHealth = [];
    mocks.browserHealth = {
      executableExists: true,
      issues: [],
    };

    const report = await assessProductionReadiness({
      goal: 'Do a long browser research task and create a report',
      runMode: 'wide_research',
      taskMode: 'research',
      toolsets: ['browser'],
      browserBackend: 'local',
    });

    expect(report.status).toBe('degraded');
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'browser', severity: 'warning' }),
        expect.objectContaining({
          category: 'resumability',
          severity: 'warning',
        }),
      ]),
    );
  });
});
