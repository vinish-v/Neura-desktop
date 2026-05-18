/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'crypto';

import ElectronStore from 'electron-store';
import { ipcMain, safeStorage, shell } from 'electron';
import {
  ConnectorManager,
  ConnectorRegistry,
  createOAuthAuthorizationUrl,
  exchangeOAuthCode,
  type ConnectorCredential,
  type ConnectorCredentialStore,
  type ConnectorRuntimeConfig,
  type ConnectorSummary,
  type ConnectorToolCall,
} from '@agent-infra/shared';

import { logger } from '@main/logger';
import { SettingStore } from '@main/store/setting';
import { ConnectorAuditEvent, ConnectorDefinition } from '@main/store/types';
import { requestUserApproval } from './approvalGate';

type SecretStoreShape = {
  secrets: Record<string, string>;
};

export type ConnectorHealthRecord = {
  connectorId: string;
  displayName: string;
  enabled: boolean;
  authState: string;
  permission: 'read' | 'write' | 'admin';
  configured: boolean;
  credentialPresent: boolean;
  credentialExpiresAt?: number;
  availableTools: string[];
  missingConfig: string[];
  setupGap?: string;
  writeToolsRequireApproval: boolean;
  checkedAt: number;
};

export type ConnectorTestResult = ConnectorHealthRecord & {
  ok: boolean;
  message: string;
};

const toPermission = (value?: string): 'read' | 'write' | 'admin' => {
  if (value === 'admin' || value === 'write') {
    return value;
  }
  return 'read';
};

class SafeStorageCredentialStore implements ConnectorCredentialStore {
  private readonly store = new ElectronStore<SecretStoreShape>({
    name: 'neura.connector-secrets',
    defaults: { secrets: {} },
  });

  async get(connectorId: string) {
    const encoded = this.store.get('secrets')[connectorId];
    if (!encoded) {
      return null;
    }
    try {
      const decrypted = safeStorage.decryptString(
        Buffer.from(encoded, 'base64'),
      );
      return JSON.parse(decrypted) as ConnectorCredential;
    } catch (error) {
      logger.warn(`[ConnectorService] failed to decrypt ${connectorId}`, error);
      return null;
    }
  }

  async set(connectorId: string, credential: ConnectorCredential) {
    const encrypted = safeStorage.encryptString(JSON.stringify(credential));
    this.store.set('secrets', {
      ...this.store.get('secrets'),
      [connectorId]: encrypted.toString('base64'),
    });
  }

  async delete(connectorId: string) {
    const secrets = { ...this.store.get('secrets') };
    delete secrets[connectorId];
    this.store.set('secrets', secrets);
  }
}

export class ConnectorsService {
  private static instance: ConnectorsService | null = null;
  private readonly registry = new ConnectorRegistry();
  private readonly credentialStore = new SafeStorageCredentialStore();
  private readonly manager = new ConnectorManager(
    this.registry,
    this.credentialStore,
    (connectorId) => this.getRuntimeConfig(connectorId),
  );

  static getInstance() {
    if (!ConnectorsService.instance) {
      ConnectorsService.instance = new ConnectorsService();
    }
    return ConnectorsService.instance;
  }

  async list(): Promise<ConnectorSummary[]> {
    return this.manager.list();
  }

  async listTools() {
    return this.manager.listTools();
  }

  async callTool(call: ConnectorToolCall) {
    const tool = (await this.manager.listTools()).find(
      (item) =>
        item.connectorId === call.connectorId && item.name === call.name,
    );
    let approvalStatus: ConnectorAuditEvent['approvalStatus'] = 'not_required';
    try {
      if (tool && tool.permission !== 'read') {
        let approved = false;
        try {
          approved = await requestUserApproval({
            action: `connector:${call.name}`,
            target: call.connectorId,
            risk: tool.permission === 'admin' ? 'high' : 'medium',
          });
        } catch (error) {
          approvalStatus = 'missing_run';
          throw error;
        }
        if (!approved) {
          approvalStatus = 'denied';
          throw new Error(
            `${tool.name} was denied by the user and was not sent.`,
          );
        }
        approvalStatus = 'approved';
      }
      const result = await this.manager.callTool(call);
      this.audit({
        connectorId: call.connectorId,
        toolName: call.name,
        permission: tool?.permission || 'read',
        status: 'completed',
        approvalStatus,
      });
      return result;
    } catch (error) {
      this.audit({
        connectorId: call.connectorId,
        toolName: call.name,
        permission: tool?.permission || 'read',
        status: 'failed',
        approvalStatus,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  getAuditLog() {
    return (SettingStore.get('connectorAuditLog') || []) as ConnectorAuditEvent[];
  }

  async getHealth(connectorId?: string) {
    const health = await this.collectHealth();
    return connectorId
      ? health.filter((item) => item.connectorId === connectorId)
      : health;
  }

  async testConnector(connectorId: string): Promise<ConnectorTestResult> {
    const health = (await this.getHealth(connectorId))[0];
    if (!health) {
      throw new Error(`Connector not found: ${connectorId}`);
    }
    const ok =
      health.enabled &&
      health.configured &&
      health.missingConfig.length === 0 &&
      !health.setupGap;
    const result: ConnectorTestResult = {
      ...health,
      ok,
      message: ok
        ? `${health.displayName} is locally configured. No external write was attempted.`
        : health.setupGap ||
          `${health.displayName} needs setup before Neura can use it.`,
    };
    this.audit({
      connectorId,
      toolName: 'connector_test',
      permission: 'read',
      status: ok ? 'completed' : 'failed',
      approvalStatus: 'not_required',
      error: ok ? undefined : result.message,
    });
    return result;
  }

  async refresh(connectorId: string) {
    const implementation = this.registry.get(connectorId);
    if (!implementation?.manifest.oauth) {
      throw new Error(
        `${implementation?.manifest.displayName || connectorId} does not support token refresh.`,
      );
    }
    const credential = await this.credentialStore.get(connectorId);
    if (!credential?.refreshToken) {
      throw new Error(
        `${implementation.manifest.displayName} has no refresh token. Reconnect OAuth instead.`,
      );
    }
    const connector = this.getConnector(connectorId);
    const config = connector?.config || {};
    const clientId = config.clientId?.trim();
    if (!clientId) {
      throw new Error(
        `${implementation.manifest.displayName} clientId is required to refresh OAuth.`,
      );
    }
    const body = new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: credential.refreshToken,
    });
    const clientSecret = config.clientSecret?.trim();
    if (clientSecret) {
      body.set('client_secret', clientSecret);
    }
    const response = await fetch(implementation.manifest.oauth.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const token = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!response.ok) {
      throw new Error(
        `${implementation.manifest.displayName} refresh failed (${response.status}): ${JSON.stringify(token)}`,
      );
    }
    await this.credentialStore.set(connectorId, {
      ...credential,
      accessToken:
        typeof token.access_token === 'string'
          ? token.access_token
          : credential.accessToken,
      refreshToken:
        typeof token.refresh_token === 'string'
          ? token.refresh_token
          : credential.refreshToken,
      expiresAt:
        typeof token.expires_in === 'number'
          ? Date.now() + token.expires_in * 1000
          : credential.expiresAt,
      metadata: {
        ...(credential.metadata || {}),
        tokenType: token.token_type,
        scope: token.scope,
      },
    });
    this.updateConnector(connectorId, {
      enabled: true,
      authState: 'configured',
    });
    this.audit({
      connectorId,
      toolName: 'connector_refresh',
      permission: 'read',
      status: 'completed',
      approvalStatus: 'not_required',
    });
    return this.testConnector(connectorId);
  }

  async connect(input: {
    connectorId: string;
    credential?: ConnectorCredential;
    config?: Record<string, string>;
  }) {
    const manifest = this.registry.get(input.connectorId)?.manifest;
    if (!manifest) {
      throw new Error(`Connector not found: ${input.connectorId}`);
    }

    if (input.config) {
      this.updateConnector(input.connectorId, {
        config: {
          ...(this.getConnector(input.connectorId)?.config || {}),
          ...input.config,
        },
      });
    }
    if (input.credential) {
      await this.credentialStore.set(input.connectorId, input.credential);
    }
    this.updateConnector(input.connectorId, {
      enabled: true,
      authState: 'configured',
    });
    this.audit({
      connectorId: input.connectorId,
      toolName: 'connector_connect',
      permission: toPermission(this.getConnector(input.connectorId)?.permissionLevel),
      status: 'completed',
      approvalStatus: 'not_required',
    });
    return this.list();
  }

  async disconnect(connectorId: string) {
    await this.credentialStore.delete(connectorId);
    this.updateConnector(connectorId, {
      enabled: false,
      authState: 'not_configured',
    });
    this.audit({
      connectorId,
      toolName: 'connector_disconnect',
      permission: toPermission(this.getConnector(connectorId)?.permissionLevel),
      status: 'completed',
      approvalStatus: 'not_required',
    });
    return this.list();
  }

  async update(input: {
    connectorId: string;
    enabled?: boolean;
    permission?: 'read' | 'write' | 'admin';
    config?: Record<string, string>;
  }) {
    this.updateConnector(input.connectorId, {
      enabled: input.enabled,
      permissionLevel: input.permission,
      config: input.config
        ? {
            ...(this.getConnector(input.connectorId)?.config || {}),
            ...input.config,
          }
        : undefined,
    });
    this.audit({
      connectorId: input.connectorId,
      toolName: 'connector_update',
      permission: toPermission(
        input.permission || this.getConnector(input.connectorId)?.permissionLevel,
      ),
      status: 'completed',
      approvalStatus: 'not_required',
    });
    return this.list();
  }

  async beginOAuth(connectorId: string) {
    const implementation = this.registry.get(connectorId);
    if (!implementation?.manifest.oauth) {
      throw new Error(`Connector does not support OAuth: ${connectorId}`);
    }
    const connector = this.getConnector(connectorId);
    const config = connector?.config || {};
    const clientId = config.clientId?.trim();
    const redirectUri =
      config.redirectUri?.trim() ||
      implementation.manifest.oauth.redirectUri ||
      'http://127.0.0.1:54887/oauth/callback';
    if (!clientId) {
      throw new Error(
        `${implementation.manifest.displayName} clientId is required.`,
      );
    }
    const state = randomUUID();
    const authorizationUrl = createOAuthAuthorizationUrl({
      oauth: implementation.manifest.oauth,
      clientId,
      redirectUri,
      state,
    });
    await shell.openExternal(authorizationUrl);
    this.audit({
      connectorId,
      toolName: 'connector_begin_oauth',
      permission: toPermission(connector?.permissionLevel),
      status: 'completed',
      approvalStatus: 'not_required',
    });
    return {
      authorizationUrl,
      redirectUri,
      state,
    };
  }

  async completeOAuth(input: { connectorId: string; code: string }) {
    const implementation = this.registry.get(input.connectorId);
    if (!implementation?.manifest.oauth) {
      throw new Error(`Connector does not support OAuth: ${input.connectorId}`);
    }
    const connector = this.getConnector(input.connectorId);
    const config = connector?.config || {};
    const clientId = config.clientId?.trim();
    const redirectUri =
      config.redirectUri?.trim() ||
      implementation.manifest.oauth.redirectUri ||
      'http://127.0.0.1:54887/oauth/callback';
    if (!clientId) {
      throw new Error(
        `${implementation.manifest.displayName} clientId is required.`,
      );
    }

    const token = await exchangeOAuthCode({
      oauth: implementation.manifest.oauth,
      clientId,
      clientSecret: config.clientSecret?.trim() || undefined,
      redirectUri,
      code: this.extractOAuthCode(input.code),
    });
    await this.credentialStore.set(input.connectorId, {
      accessToken:
        typeof token.access_token === 'string' ? token.access_token : undefined,
      refreshToken:
        typeof token.refresh_token === 'string'
          ? token.refresh_token
          : undefined,
      expiresAt:
        typeof token.expires_in === 'number'
          ? Date.now() + token.expires_in * 1000
          : undefined,
      metadata: {
        tokenType: token.token_type,
        scope: token.scope,
      },
    });
    this.updateConnector(input.connectorId, {
      enabled: true,
      authState: 'configured',
    });
    this.audit({
      connectorId: input.connectorId,
      toolName: 'connector_complete_oauth',
      permission: toPermission(this.getConnector(input.connectorId)?.permissionLevel),
      status: 'completed',
      approvalStatus: 'not_required',
    });
    return this.list();
  }

  private getRuntimeConfig(connectorId: string): ConnectorRuntimeConfig | null {
    const connector = this.getConnector(connectorId);
    if (!connector) {
      return null;
    }
    return {
      enabled: connector.enabled,
      permission: toPermission(connector.permissionLevel),
      authState:
        connector.authState === 'error'
          ? 'error'
          : connector.authState === 'configured'
            ? 'configured'
            : 'not_configured',
      config: connector.config || {},
    };
  }

  private async collectHealth(): Promise<ConnectorHealthRecord[]> {
    const summaries = await this.manager.list();
    const storeConnectors = SettingStore.getStore().connectors || [];
    const summaryIds = new Set(summaries.map((summary) => summary.id));
    const records = await Promise.all(
      summaries.map(async (summary) =>
        this.buildHealthRecord({
          connectorId: summary.id,
          displayName: summary.displayName,
          enabled: summary.enabled,
          authState: summary.authState,
          permission: summary.permission,
          configured: summary.configured,
          tools: summary.tools.map((tool) => tool.name),
          writeToolsRequireApproval: summary.tools.some(
            (tool) => tool.permission !== 'read',
          ),
        }),
      ),
    );
    const nativeRecords = await Promise.all(
      storeConnectors
        .filter((connector) => !summaryIds.has(connector.id))
        .map((connector) =>
          this.buildHealthRecord({
            connectorId: connector.id,
            displayName: connector.displayName,
            enabled: connector.enabled,
            authState: connector.authState,
            permission: toPermission(connector.permissionLevel),
            configured: connector.authState === 'configured',
            tools: connector.tools || [],
            writeToolsRequireApproval: toPermission(connector.permissionLevel) !== 'read',
          }),
        ),
    );
    return [...records, ...nativeRecords].sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    );
  }

  private async buildHealthRecord(input: {
    connectorId: string;
    displayName: string;
    enabled: boolean;
    authState: string;
    permission: 'read' | 'write' | 'admin';
    configured: boolean;
    tools: string[];
    writeToolsRequireApproval: boolean;
  }): Promise<ConnectorHealthRecord> {
    const credential = await this.credentialStore.get(input.connectorId);
    const connector = this.getConnector(input.connectorId);
    const config = connector?.config || {};
    const missingConfig = this.getMissingConfig(input.connectorId, config, credential);
    const setupGap =
      this.getSetupGap(input.connectorId, input, credential, missingConfig) ||
      undefined;
    return {
      connectorId: input.connectorId,
      displayName: input.displayName,
      enabled: input.enabled,
      authState: input.authState,
      permission: input.permission,
      configured: input.configured || Boolean(credential),
      credentialPresent: Boolean(credential),
      credentialExpiresAt: credential?.expiresAt,
      availableTools: input.tools,
      missingConfig,
      setupGap,
      writeToolsRequireApproval: input.writeToolsRequireApproval,
      checkedAt: Date.now(),
    };
  }

  private getMissingConfig(
    connectorId: string,
    config: Record<string, string>,
    credential: ConnectorCredential | null,
  ) {
    const missing: string[] = [];
    const hasCredential = Boolean(
      credential?.apiKey ||
        credential?.accessToken ||
        credential?.refreshToken ||
        credential?.webhookUrl,
    );
    if (connectorId === 'gmail') {
      if (!config.clientId?.trim()) {
        missing.push('clientId');
      }
      if (!hasCredential) {
        missing.push('oauthCredential');
      }
    } else if (connectorId === 'notion') {
      if (!hasCredential) {
        missing.push('apiKey');
      }
      if (!config.parentPageId?.trim() && !config.databaseId?.trim()) {
        missing.push('parentPageId_or_databaseId');
      }
    } else if (connectorId === 'slack') {
      if (!credential?.webhookUrl && !config.webhookUrl?.trim()) {
        missing.push('webhookUrl');
      }
    } else if (connectorId === 'github') {
      if (!hasCredential) {
        missing.push('apiKey');
      }
      if (!config.repository?.trim()) {
        missing.push('repository');
      }
    } else if (connectorId === 'generic_rest') {
      if (!config.baseUrl?.trim()) {
        missing.push('baseUrl');
      }
    } else if (connectorId === 'google_drive_export') {
      missing.push('supportedDriveOAuthConnector');
    } else if (connectorId === 'custom_mcp') {
      if (!config.url?.trim() && !config.command?.trim()) {
        missing.push('url_or_command');
      }
    }
    return missing;
  }

  private getSetupGap(
    connectorId: string,
    input: {
      displayName: string;
      enabled: boolean;
      configured: boolean;
    },
    credential: ConnectorCredential | null,
    missingConfig: string[],
  ) {
    if (connectorId === 'google_drive_export') {
      return 'Google Drive export has no real OAuth upload implementation configured in this build.';
    }
    if (!input.enabled) {
      return `${input.displayName} is disabled.`;
    }
    if (!input.configured && !credential) {
      return `${input.displayName} has no stored credential.`;
    }
    if (missingConfig.length) {
      return `${input.displayName} is missing: ${missingConfig.join(', ')}.`;
    }
    return '';
  }

  private extractOAuthCode(value: string) {
    const trimmed = value.trim();
    try {
      const url = new URL(trimmed);
      return url.searchParams.get('code') || trimmed;
    } catch {
      return trimmed.replace(/^code=/i, '');
    }
  }

  private getConnector(connectorId: string) {
    return (SettingStore.getStore().connectors || []).find(
      (connector) => connector.id === connectorId,
    );
  }

  private updateConnector(
    connectorId: string,
    patch: Partial<ConnectorDefinition>,
  ) {
    const manifests = this.registry.list();
    const settings = SettingStore.getStore();
    const connectors = settings.connectors || [];
    const existing = connectors.find(
      (connector) => connector.id === connectorId,
    );
    const manifest = manifests.find((item) => item.id === connectorId);
    if (!existing && !manifest) {
      throw new Error(`Connector not found: ${connectorId}`);
    }
    const fallback: ConnectorDefinition = {
      id: connectorId,
      displayName: manifest?.displayName || connectorId,
      type:
        manifest?.authType === 'oauth2'
          ? 'oauth'
          : manifest?.authType === 'webhook'
            ? 'webhook'
            : manifest?.id === 'generic_rest'
              ? 'rest'
              : 'api',
      enabled: false,
      authState: 'not_configured',
      permissionLevel: manifest?.permissions.includes('write')
        ? 'write'
        : 'read',
      tools: manifest?.tools.map((tool) => tool.name) || [],
      config: {},
    };
    const next = {
      ...fallback,
      ...existing,
      ...patch,
      config: patch.config || existing?.config || fallback.config,
      updatedAt: Date.now(),
    };
    const nextConnectors = existing
      ? connectors.map((connector) =>
          connector.id === connectorId ? next : connector,
        )
      : [next, ...connectors];
    SettingStore.set('connectors', nextConnectors);
  }

  private audit(event: {
    connectorId: string;
    toolName: string;
    permission: 'read' | 'write' | 'admin';
    status: 'completed' | 'failed';
    approvalStatus?: ConnectorAuditEvent['approvalStatus'];
    error?: string;
  }) {
    const current = SettingStore.get('connectorAuditLog') || [];
    SettingStore.set(
      'connectorAuditLog',
      [
        {
          id: `connector_audit_${Date.now()}_${randomUUID().slice(0, 8)}`,
          ...event,
          createdAt: Date.now(),
        },
        ...current,
      ].slice(0, 200),
    );
  }
}

let rawConnectorsIpcRegistered = false;

export const registerConnectorsIpcHandlers = () => {
  if (rawConnectorsIpcRegistered) {
    return;
  }
  rawConnectorsIpcRegistered = true;
  const service = ConnectorsService.getInstance();

  ipcMain.handle('connectors:list', async () => service.list());
  ipcMain.handle(
    'connectors:connect',
    async (
      _event,
      input: {
        connectorId: string;
        credential?: ConnectorCredential;
        config?: Record<string, string>;
      },
    ) => service.connect(input),
  );
  ipcMain.handle('connectors:disconnect', async (_event, connectorId: string) =>
    service.disconnect(connectorId),
  );
  ipcMain.handle(
    'connectors:approve',
    async (
      _event,
      input: {
        connectorId: string;
        enabled?: boolean;
        permission?: 'read' | 'write' | 'admin';
        config?: Record<string, string>;
      },
    ) => service.update(input),
  );
  ipcMain.handle(
    'connectors:begin-oauth',
    async (_event, connectorId: string) => service.beginOAuth(connectorId),
  );
  ipcMain.handle(
    'connectors:complete-oauth',
    async (_event, input: { connectorId: string; code: string }) =>
      service.completeOAuth(input),
  );
};
