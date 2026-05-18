/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

import { app, ipcMain } from 'electron';
import {
  MCPClient,
  type MCPServer,
  type MCPTool,
} from '@agent-infra/mcp-client';

import { logger } from '@main/logger';
import { SettingStore } from '@main/store/setting';
import { ConnectorDefinition } from '@main/store/types';
import { ConnectorsService } from './connectors-service';

const requireFromHere = createRequire(import.meta.url);

type NeuraMcpServerName =
  | 'neura-filesystem'
  | 'neura-commands'
  | 'neura-search'
  | 'neura-browser'
  | 'neura-connectors'
  | 'custom-mcp';

type McpCallToolInput = {
  serverName?: string;
  client?: string;
  name: string;
  args?: Record<string, unknown>;
  arguments?: Record<string, unknown>;
};

type BuiltInServerKey = 'filesystem' | 'commands' | 'search' | 'browser';

export type McpDiscoveryDiagnostic = {
  serverName: string;
  enabled: boolean;
  transport?: string;
  command?: string;
  args?: string[];
  urlConfigured?: boolean;
  toolCount: number;
  status: 'ready' | 'disabled' | 'error';
  issue?: string;
};

const DEFAULT_BUILTIN_SERVERS: BuiltInServerKey[] = [
  'filesystem',
  'commands',
  'search',
  'browser',
];

const toWindowsCommand = (command: string) =>
  process.platform === 'win32' ? `${command}.cmd` : command;

const splitArgs = (value?: string): string[] => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return [];
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.map(String);
    }
  } catch {
    // Fall through to shell-like splitting.
  }
  return [...trimmed.matchAll(/"([^"]*)"|'([^']*)'|[^\s]+/g)].map(
    (match) => match[1] ?? match[2] ?? match[0],
  );
};

const parseJsonEnv = (value?: string): Record<string, string> => {
  if (!value?.trim()) {
    return {};
  }
  const parsed = JSON.parse(value) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(parsed).map(([key, entry]) => [key, String(entry)]),
  );
};

const findWorkspaceRoot = (start: string) => {
  let current = start;
  while (current && current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
      return current;
    }
    current = path.dirname(current);
  }
  return start;
};

const workspaceRoot = findWorkspaceRoot(process.cwd());

const resolvePackageServerCommand = (
  packageName: string,
  sourceEntry: string,
  args: string[] = [],
) => {
  try {
    const packageEntry = requireFromHere.resolve(packageName);
    const packageDist = path.dirname(packageEntry);
    const packageBin = path.join(packageDist, 'index.cjs');
    if (fs.existsSync(packageBin)) {
      return {
        command: process.execPath,
        args: [packageBin, ...args],
      };
    }
  } catch (error) {
    logger.debug(
      `[MCPService] package resolution deferred for ${packageName}`,
      error,
    );
  }

  const localSource = path.join(workspaceRoot, sourceEntry);
  if (fs.existsSync(localSource)) {
    return {
      command: toWindowsCommand('pnpm'),
      args: ['--dir', workspaceRoot, 'exec', 'tsx', localSource, ...args],
    };
  }

  return {
    command: toWindowsCommand('npx'),
    args: ['-y', packageName, ...args],
  };
};

const normalizeDirectoryList = (value?: string) => {
  const configured = (value || '')
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean);

  const fallback = [process.cwd(), path.join(os.homedir(), 'Documents')].filter(
    (entry) => fs.existsSync(entry),
  );

  return [...new Set(configured.length ? configured : fallback)];
};

const getConnector = (id: string) =>
  (SettingStore.getStore().connectors || []).find(
    (connector) => connector.id === id,
  );

const getEnabledBuiltInServers = (
  connector?: ConnectorDefinition,
): BuiltInServerKey[] => {
  if (!connector?.enabled && process.env.NEURA_ENABLE_MCP !== '1') {
    return [];
  }

  const configured = (connector?.config?.servers || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  const requested = configured.length ? configured : DEFAULT_BUILTIN_SERVERS;

  return DEFAULT_BUILTIN_SERVERS.filter((server) => requested.includes(server));
};

const createBuiltInServers = (): MCPServer<NeuraMcpServerName>[] => {
  const connector = getConnector('builtin_mcp');
  const enabled = getEnabledBuiltInServers(connector);
  const allowedDirectories = normalizeDirectoryList(
    connector?.config?.allowedDirectories,
  );
  const servers: MCPServer<NeuraMcpServerName>[] = [];

  if (enabled.includes('filesystem')) {
    const args = allowedDirectories.flatMap((directory) => [
      '--allowed-directories',
      directory,
    ]);
    servers.push({
      name: 'neura-filesystem',
      type: 'stdio',
      status: 'activate',
      description: 'Local filesystem tools scoped to configured directories.',
      timeout: 45,
      ...resolvePackageServerCommand(
        '@agent-infra/mcp-server-filesystem',
        'packages/agent-infra/mcp-servers/filesystem/src/index.ts',
        args,
      ),
    });
  }

  if (enabled.includes('commands')) {
    servers.push({
      name: 'neura-commands',
      type: 'stdio',
      status: 'activate',
      description: 'Local command execution tools for approved agent tasks.',
      timeout: 120,
      ...resolvePackageServerCommand(
        '@agent-infra/mcp-server-commands',
        'packages/agent-infra/mcp-servers/commands/src/index.ts',
      ),
    });
  }

  if (enabled.includes('search')) {
    servers.push({
      name: 'neura-search',
      type: 'stdio',
      status: 'activate',
      description: 'Web search tools exposed through MCP.',
      timeout: 45,
      ...resolvePackageServerCommand(
        '@agent-infra/mcp-server-search',
        'packages/agent-infra/mcp-servers/search/src/index.ts',
      ),
    });
  }

  if (enabled.includes('browser')) {
    servers.push({
      name: 'neura-browser',
      type: 'stdio',
      status: 'activate',
      description: 'Browser automation tools exposed through MCP.',
      timeout: 90,
      ...resolvePackageServerCommand(
        '@agent-infra/mcp-server-browser',
        'packages/agent-infra/mcp-servers/browser/src/index.ts',
      ),
    });
  }

  return servers;
};

const createCustomServer = (): MCPServer<NeuraMcpServerName>[] => {
  const connector = getConnector('custom_mcp');
  if (!connector?.enabled) {
    return [];
  }

  const config = connector.config || {};
  const url = config.url?.trim();
  if (url) {
    return [
      {
        name: 'custom-mcp',
        type: config.transport === 'sse' ? 'sse' : 'streamable-http',
        status: 'activate',
        url,
        description: 'User-configured remote MCP server.',
        timeout: 90,
      },
    ];
  }

  const command = config.command?.trim();
  if (!command) {
    return [];
  }

  return [
    {
      name: 'custom-mcp',
      type: 'stdio',
      status: 'activate',
      command,
      args: splitArgs(config.args),
      env: parseJsonEnv(config.env),
      description: 'User-configured local MCP server.',
      timeout: 90,
    },
  ];
};

const createConfiguredServers = () => [
  ...createBuiltInServers(),
  ...createCustomServer(),
];

const createServerConfigKey = (servers: MCPServer<NeuraMcpServerName>[]) =>
  JSON.stringify(
    servers.map((server) => {
      const record = server as unknown as Record<string, unknown>;
      const env = record.env as Record<string, unknown> | undefined;
      return {
        name: server.name,
        status: server.status,
        type: server.type,
        command: record.command,
        args: record.args,
        cwd: record.cwd,
        url: record.url,
        timeout: server.timeout,
        envKeys: env ? Object.keys(env).sort() : [],
      };
    }),
  );

export class MCPService {
  private static instance: MCPService | null = null;
  private client: MCPClient<NeuraMcpServerName> | null = null;
  private starting: Promise<void> | null = null;
  private configKey = '';

  static getInstance() {
    if (!MCPService.instance) {
      MCPService.instance = new MCPService();
    }
    return MCPService.instance;
  }

  async start() {
    if (this.starting) {
      return this.starting;
    }

    this.starting = (async () => {
      const servers = createConfiguredServers();
      const nextConfigKey = createServerConfigKey(servers);
      if (this.client && this.configKey === nextConfigKey) {
        return;
      }
      if (this.client) {
        await this.cleanup();
      }

      if (!servers.length) {
        logger.info('[MCPService] No MCP connectors are enabled.');
        this.client = new MCPClient([], { defaultTimeout: 60 });
        this.configKey = nextConfigKey;
        return;
      }

      logger.info(
        `[MCPService] Starting ${servers.length} MCP server connection(s).`,
      );
      this.client = new MCPClient(servers, {
        defaultTimeout: 60,
        isDebug: process.env.DEBUG === 'mcp',
      });
      this.client.on('server-error', (event) => {
        logger.warn('[MCPService] server error', event);
      });
      await this.client.init();
      this.configKey = nextConfigKey;
    })().finally(() => {
      this.starting = null;
    });

    return this.starting;
  }

  async restart() {
    await this.cleanup();
    await this.start();
  }

  async listTools(serverName?: string): Promise<MCPTool[]> {
    await this.start();
    if (serverName === 'neura-connectors') {
      return this.listConnectorTools();
    }
    const mcpTools =
      (await this.client?.listTools(serverName as NeuraMcpServerName)) ?? [];
    if (serverName) {
      return mcpTools;
    }
    return [...mcpTools, ...(await this.listConnectorTools())];
  }

  async callTool(input: McpCallToolInput) {
    await this.start();
    const client = (input.serverName || input.client) as NeuraMcpServerName;
    if (client === 'neura-connectors') {
      const tool = (await ConnectorsService.getInstance().listTools()).find(
        (item) => item.name === input.name,
      );
      if (!tool) {
        throw new Error(`Connector tool not found: ${input.name}`);
      }
      return ConnectorsService.getInstance().callTool({
        connectorId: tool.connectorId,
        name: input.name,
        arguments: input.arguments || input.args || {},
      });
    }
    if (!this.client) {
      throw new Error('MCP client is not initialized.');
    }
    if (!client) {
      throw new Error('MCP tool call requires a serverName.');
    }
    return this.client.callTool({
      client,
      name: input.name,
      args: input.arguments || input.args || {},
    });
  }

  async status() {
    await this.start();
    const tools = (await this.client?.listTools().catch(() => [])) ?? [];
    const connectorTools = await this.listConnectorTools();
    return {
      enabledServers: createConfiguredServers().map((server) => server.name),
      connectorToolCount: connectorTools.length,
      toolCount: tools.length + connectorTools.length,
      appPath: app.getAppPath(),
    };
  }

  async diagnostics(): Promise<McpDiscoveryDiagnostic[]> {
    const configuredServers = createConfiguredServers();
    const configuredNames = new Set(configuredServers.map((server) => server.name));
    const expectedServers: Array<{
      name: NeuraMcpServerName;
      connectorId: string;
      key?: BuiltInServerKey;
    }> = [
      { name: 'neura-filesystem', connectorId: 'builtin_mcp', key: 'filesystem' },
      { name: 'neura-commands', connectorId: 'builtin_mcp', key: 'commands' },
      { name: 'neura-search', connectorId: 'builtin_mcp', key: 'search' },
      { name: 'neura-browser', connectorId: 'builtin_mcp', key: 'browser' },
      { name: 'custom-mcp', connectorId: 'custom_mcp' },
    ];
    await this.start();
    const diagnostics: McpDiscoveryDiagnostic[] = [];
    for (const expected of expectedServers) {
      const server = configuredServers.find((item) => item.name === expected.name);
      if (!server) {
        const connector = getConnector(expected.connectorId);
        diagnostics.push({
          serverName: expected.name,
          enabled: false,
          toolCount: 0,
          status: 'disabled',
          issue:
            expected.connectorId === 'builtin_mcp'
              ? `${expected.key} MCP server is not enabled in builtin_mcp config.`
              : connector?.enabled
                ? 'Custom MCP connector is enabled but missing url or command.'
                : 'Custom MCP connector is disabled.',
        });
        continue;
      }
      try {
        const tools = await this.listTools(server.name);
        const record = server as unknown as Record<string, unknown>;
        diagnostics.push({
          serverName: server.name,
          enabled: configuredNames.has(server.name),
          transport: server.type,
          command:
            typeof record.command === 'string'
              ? path.basename(record.command)
              : undefined,
          args: Array.isArray(record.args)
            ? (record.args as string[]).map((arg) =>
                arg.includes(workspaceRoot)
                  ? arg.replace(workspaceRoot, '<workspace>')
                  : arg,
              )
            : undefined,
          urlConfigured: typeof record.url === 'string' && Boolean(record.url),
          toolCount: tools.length,
          status: 'ready',
        });
      } catch (error) {
        diagnostics.push({
          serverName: server.name,
          enabled: true,
          transport: server.type,
          toolCount: 0,
          status: 'error',
          issue: error instanceof Error ? error.message : String(error),
        });
      }
    }
    diagnostics.push({
      serverName: 'neura-connectors',
      enabled: true,
      transport: 'internal',
      toolCount: (await this.listConnectorTools()).length,
      status: 'ready',
    });
    return diagnostics;
  }

  async cleanup() {
    if (this.client) {
      await this.client.cleanup().catch((error) => {
        logger.warn('[MCPService] cleanup failed', error);
      });
    }
    this.client = null;
    this.configKey = '';
  }

  private async listConnectorTools(): Promise<MCPTool[]> {
    const tools = await ConnectorsService.getInstance().listTools();
    return tools.map((tool) => ({
      id: `neura-connectors:${tool.connectorId}:${tool.name}`,
      serverName: 'neura-connectors',
      name: tool.name,
      description: `${tool.connectorName}: ${tool.description}`,
      inputSchema: (tool.inputSchema as MCPTool['inputSchema']) || {
        type: 'object',
        properties: {},
      },
    }));
  }
}

let rawIpcRegistered = false;

export const registerMcpIpcHandlers = () => {
  if (rawIpcRegistered) {
    return;
  }
  rawIpcRegistered = true;
  const service = MCPService.getInstance();

  ipcMain.handle(
    'mcp:list-tools',
    async (_event, params?: { serverName?: string }) =>
      service.listTools(params?.serverName),
  );
  ipcMain.handle('mcp:call-tool', async (_event, params: McpCallToolInput) =>
    service.callTool(params),
  );
  ipcMain.handle('mcp:stream', async (_event, params: { goal: string }) => {
    const { TaskManager } = await import('./task-manager');
    return TaskManager.getInstance().startMcpAutonomousTask(params.goal);
  });
  ipcMain.handle('mcp:status', async () => service.status());
};
