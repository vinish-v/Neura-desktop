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
import { ConnectorDefinition } from '@main/store/types';

type SecretStoreShape = {
  secrets: Record<string, string>;
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
    try {
      const result = await this.manager.callTool(call);
      this.audit({
        connectorId: call.connectorId,
        toolName: call.name,
        permission: tool?.permission || 'read',
        status: 'completed',
      });
      return result;
    } catch (error) {
      this.audit({
        connectorId: call.connectorId,
        toolName: call.name,
        permission: tool?.permission || 'read',
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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
    return this.list();
  }

  async disconnect(connectorId: string) {
    await this.credentialStore.delete(connectorId);
    this.updateConnector(connectorId, {
      enabled: false,
      authState: 'not_configured',
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
