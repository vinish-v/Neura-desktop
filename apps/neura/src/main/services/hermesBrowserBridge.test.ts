import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => 'C:\\Users\\HP\\AppData\\Roaming\\Neura',
  },
}));

vi.mock('@main/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@main/store/create', () => ({
  store: {
    getState: () => ({ computerRuntime: { takeoverEnabled: false } }),
  },
}));

vi.mock('./computerRuntimeController', () => ({
  ComputerRuntimeController: {
    update: vi.fn(),
    updateBrowserState: vi.fn(),
    frame: vi.fn(),
  },
}));

vi.mock('./taskRunRegistry', () => ({
  TaskRunRegistry: {
    getActiveRunId: vi.fn(),
    addEvidence: vi.fn(),
    addProgress: vi.fn(),
    setBrowserRestoreSnapshot: vi.fn(),
    addBrowserActionAudit: vi.fn(),
    recordBrowserTiming: vi.fn(),
  },
}));

import { buildBrowserHealthReport } from './hermesBrowserBridge';

describe('Hermes browser bridge health', () => {
  it('reports executable, profile, lock, and CDP port issues', () => {
    const report = buildBrowserHealthReport({
      executablePath: undefined,
      executableExists: false,
      profilePath: 'C:\\Users\\HP\\Neura\\browser-profile',
      profileExists: true,
      profileWritable: false,
      profileLockPresent: true,
      port: 9222,
      portReachable: false,
      bridgeStatus: 'connected',
      checkedAt: 1,
    });

    expect(report.executableExists).toBe(false);
    expect(report.profile.lockState).toBe('locked');
    expect(report.profile.writable).toBe(false);
    expect(report.portReachable).toBe(false);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        'No supported local browser executable was found.',
        'The local browser automation profile is not writable.',
        'The browser profile lock is present.',
        'The configured CDP port is not reachable.',
      ]),
    );
  });

  it('marks a reachable bridge and writable profile as healthy', () => {
    const report = buildBrowserHealthReport({
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      executableExists: true,
      profilePath: 'C:\\Users\\HP\\Neura\\browser-profile',
      profileExists: true,
      profileWritable: true,
      profileLockPresent: false,
      port: 9222,
      portReachable: true,
      bridgeStatus: 'connected',
      checkedAt: 2,
    });

    expect(report.bridgeStatus).toBe('connected');
    expect(report.profile.lockState).toBe('unlocked');
    expect(report.issues).toEqual([]);
  });
});
