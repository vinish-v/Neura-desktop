import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConnectorDefinition } from '@main/store/types';

const mocks = vi.hoisted(() => ({
  connectors: [] as ConnectorDefinition[],
  listTools: vi.fn(async (serverName?: string) =>
    serverName === 'neura-filesystem'
      ? [{ name: 'read_file', serverName: 'neura-filesystem' }]
      : [],
  ),
  init: vi.fn(async () => undefined),
  cleanup: vi.fn(async () => undefined),
}));

vi.mock('electron', () => ({
  app: {
    getAppPath: () => 'D:/new-neura/neura-main-desktop/apps/neura',
  },
  ipcMain: {
    handle: vi.fn(),
  },
}));

vi.mock('@agent-infra/mcp-client', () => ({
  MCPClient: class MockMcpClient {
    on() {
      return undefined;
    }

    init() {
      return mocks.init();
    }

    listTools(serverName?: string) {
      return mocks.listTools(serverName);
    }

    cleanup() {
      return mocks.cleanup();
    }
  },
}));

vi.mock('@main/store/setting', () => ({
  SettingStore: {
    getStore: () => ({
      connectors: mocks.connectors,
    }),
  },
}));

vi.mock('@main/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('./connectors-service', () => ({
  ConnectorsService: {
    getInstance: () => ({
      listTools: async () => [],
    }),
  },
}));

import { MCPService } from './mcp-service';

const builtinMcp = (config: Record<string, string> = {}): ConnectorDefinition => ({
  id: 'builtin_mcp',
  displayName: 'Neura Built-in MCP Tools',
  type: 'mcp',
  enabled: true,
  authState: 'configured',
  permissionLevel: 'write',
  tools: ['filesystem', 'commands', 'search', 'browser'],
  config,
});

describe('MCPService diagnostics', () => {
  beforeEach(() => {
    mocks.connectors = [];
    mocks.listTools.mockClear();
    mocks.init.mockClear();
    mocks.cleanup.mockClear();
  });

  it('explains disabled MCP servers without pretending tools exist', async () => {
    const service = new MCPService();

    const diagnostics = await service.diagnostics();

    expect(diagnostics.find((item) => item.serverName === 'neura-filesystem')).toEqual(
      expect.objectContaining({
        status: 'disabled',
        toolCount: 0,
      }),
    );
  });

  it('reports discovered tools for enabled built-in MCP servers', async () => {
    mocks.connectors = [builtinMcp({ servers: 'filesystem' })];
    const service = new MCPService();

    const diagnostics = await service.diagnostics();

    expect(diagnostics.find((item) => item.serverName === 'neura-filesystem')).toEqual(
      expect.objectContaining({
        status: 'ready',
        toolCount: 1,
      }),
    );
    expect(diagnostics.find((item) => item.serverName === 'neura-commands')).toEqual(
      expect.objectContaining({
        status: 'disabled',
        toolCount: 0,
      }),
    );
  });
});
