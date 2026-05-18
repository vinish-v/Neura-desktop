import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConnectorAuditEvent, ConnectorDefinition } from '@main/store/types';

const mocks = vi.hoisted(() => ({
  connectors: [] as ConnectorDefinition[],
  auditLog: [] as ConnectorAuditEvent[],
  secrets: {} as Record<string, string>,
  approval: vi.fn(),
  shellOpenExternal: vi.fn(),
  settingGet: vi.fn((key: string) => {
    if (key === 'connectorAuditLog') {
      return mocks.auditLog;
    }
    if (key === 'connectors') {
      return mocks.connectors;
    }
    return undefined;
  }),
  settingSet: vi.fn((key: string, value: unknown) => {
    if (key === 'connectorAuditLog') {
      mocks.auditLog = value as ConnectorAuditEvent[];
    }
    if (key === 'connectors') {
      mocks.connectors = value as ConnectorDefinition[];
    }
  }),
  settingGetStore: vi.fn(() => ({
    connectors: mocks.connectors,
    connectorAuditLog: mocks.auditLog,
  })),
}));

vi.mock('electron', () => ({
  safeStorage: {
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
  shell: {
    openExternal: mocks.shellOpenExternal,
  },
  ipcMain: {
    handle: vi.fn(),
  },
}));

vi.mock('electron-store', () => ({
  default: class MockElectronStore {
    get(key: string) {
      if (key === 'secrets') {
        return mocks.secrets;
      }
      return undefined;
    }

    set(key: string, value: unknown) {
      if (key === 'secrets') {
        mocks.secrets = value as Record<string, string>;
      }
    }
  },
}));

vi.mock('@main/store/setting', () => ({
  SettingStore: {
    get: mocks.settingGet,
    set: mocks.settingSet,
    getStore: mocks.settingGetStore,
  },
}));

vi.mock('@main/logger', () => ({
  logger: {
    warn: vi.fn(),
  },
}));

vi.mock('./approvalGate', () => ({
  requestUserApproval: mocks.approval,
}));

import { ConnectorsService } from './connectors-service';

const slackConnector = (): ConnectorDefinition => ({
  id: 'slack',
  displayName: 'Slack',
  type: 'webhook',
  enabled: false,
  authState: 'not_configured',
  permissionLevel: 'write',
  tools: ['slack_post_message'],
  config: {},
});

const driveConnector = (): ConnectorDefinition => ({
  id: 'google_drive_export',
  displayName: 'Google Drive Export',
  type: 'export',
  enabled: true,
  authState: 'configured',
  permissionLevel: 'write',
  tools: ['connector_drive_export'],
  config: {},
});

const gmailConnector = (): ConnectorDefinition => ({
  id: 'gmail',
  displayName: 'Gmail',
  type: 'oauth',
  enabled: true,
  authState: 'configured',
  permissionLevel: 'read',
  tools: ['gmail_list_unread'],
  config: {
    clientId: 'google-client-id',
    redirectUri: 'http://127.0.0.1:54887/oauth/callback',
  },
});

describe('ConnectorsService', () => {
  beforeEach(() => {
    mocks.connectors = [slackConnector(), driveConnector(), gmailConnector()];
    mocks.auditLog = [];
    mocks.secrets = {};
    mocks.approval.mockReset();
    mocks.settingGet.mockClear();
    mocks.settingSet.mockClear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () => '',
        json: async () => ({}),
      })),
    );
  });

  it('reports honest setup gaps for native connectors without fake success', async () => {
    const service = new ConnectorsService();

    const result = await service.testConnector('google_drive_export');

    expect(result.ok).toBe(false);
    expect(result.setupGap).toContain('no real OAuth upload implementation');
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mocks.auditLog[0]).toEqual(
      expect.objectContaining({
        connectorId: 'google_drive_export',
        toolName: 'connector_test',
        status: 'failed',
        approvalStatus: 'not_required',
      }),
    );
  });

  it('tests configured write connectors locally without sending an external write', async () => {
    const service = new ConnectorsService();
    await service.connect({
      connectorId: 'slack',
      credential: {
        webhookUrl: 'https://hooks.slack.test/example',
      },
    });

    const result = await service.testConnector('slack');

    expect(result.ok).toBe(true);
    expect(result.message).toContain('No external write was attempted');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('audits connector lifecycle changes including local revoke', async () => {
    const service = new ConnectorsService();

    await service.connect({
      connectorId: 'slack',
      credential: {
        webhookUrl: 'https://hooks.slack.test/example',
      },
    });
    await service.update({
      connectorId: 'slack',
      enabled: true,
      permission: 'write',
    });
    await service.disconnect('slack');

    expect(mocks.auditLog.map((event) => event.toolName)).toEqual([
      'connector_disconnect',
      'connector_update',
      'connector_connect',
    ]);
    expect(mocks.secrets.slack).toBeUndefined();
    expect(mocks.connectors.find((connector) => connector.id === 'slack')).toEqual(
      expect.objectContaining({
        enabled: false,
        authState: 'not_configured',
      }),
    );
  });

  it('revokes supported provider OAuth tokens before removing local credentials', async () => {
    const service = new ConnectorsService();
    await service.connect({
      connectorId: 'gmail',
      credential: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      },
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => '',
      json: async () => ({}),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await service.revokeProvider('gmail');

    expect(result.message).toContain('revoked with the provider');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/revoke',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(URLSearchParams),
      }),
    );
    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = requestInit.body as URLSearchParams;
    expect(body.get('token')).toBe('refresh-token');
    expect(mocks.secrets.gmail).toBeUndefined();
    expect(mocks.connectors.find((connector) => connector.id === 'gmail')).toEqual(
      expect.objectContaining({
        enabled: false,
        authState: 'not_configured',
      }),
    );
    expect(mocks.auditLog[0]).toEqual(
      expect.objectContaining({
        connectorId: 'gmail',
        toolName: 'connector_provider_revoke',
        status: 'completed',
      }),
    );
  });

  it('reports unsupported provider revoke without deleting local credentials', async () => {
    const service = new ConnectorsService();
    await service.connect({
      connectorId: 'slack',
      credential: {
        webhookUrl: 'https://hooks.slack.test/example',
      },
    });

    await expect(service.revokeProvider('slack')).rejects.toThrow(
      'no supported provider-level revoke endpoint',
    );

    expect(mocks.secrets.slack).toBeTruthy();
    expect(mocks.auditLog[0]).toEqual(
      expect.objectContaining({
        connectorId: 'slack',
        toolName: 'connector_provider_revoke',
        status: 'failed',
      }),
    );
  });

  it('blocks write connector tools when no approval proof exists', async () => {
    const service = new ConnectorsService();
    await service.connect({
      connectorId: 'slack',
      credential: {
        webhookUrl: 'https://hooks.slack.test/example',
      },
    });
    mocks.approval.mockRejectedValueOnce(
      new Error('Approval required for connector:slack_post_message, but no active run exists.'),
    );

    await expect(
      service.callTool({
        connectorId: 'slack',
        name: 'slack_post_message',
        arguments: { text: 'hello' },
      }),
    ).rejects.toThrow('Approval required');

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mocks.auditLog[0]).toEqual(
      expect.objectContaining({
        connectorId: 'slack',
        toolName: 'slack_post_message',
        status: 'failed',
        approvalStatus: 'missing_run',
      }),
    );
  });

  it('records approved write proof before calling a connector tool', async () => {
    const service = new ConnectorsService();
    await service.connect({
      connectorId: 'slack',
      credential: {
        webhookUrl: 'https://hooks.slack.test/example',
      },
    });
    mocks.approval.mockResolvedValueOnce(true);

    await service.callTool({
      connectorId: 'slack',
      name: 'slack_post_message',
      arguments: { text: 'hello' },
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://hooks.slack.test/example',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(mocks.auditLog[0]).toEqual(
      expect.objectContaining({
        connectorId: 'slack',
        toolName: 'slack_post_message',
        status: 'completed',
        approvalStatus: 'approved',
      }),
    );
  });
});
