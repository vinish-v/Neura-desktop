/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ConnectorRegistry } from './connector-registry';
import type {
  ConnectorCredential,
  ConnectorCredentialStore,
  ConnectorRuntimeConfig,
  ConnectorSummary,
  ConnectorToolCall,
} from './types';

const permissionWeight = {
  read: 1,
  write: 2,
  admin: 3,
};

export class ConnectorManager {
  constructor(
    private readonly registry = new ConnectorRegistry(),
    private readonly credentialStore: ConnectorCredentialStore,
    private readonly getRuntimeConfig: (
      connectorId: string,
    ) => ConnectorRuntimeConfig | null,
  ) {}

  listManifests() {
    return this.registry.list();
  }

  async list(): Promise<ConnectorSummary[]> {
    return Promise.all(
      this.registry.list().map(async (manifest) => {
        const runtime = this.getRuntimeConfig(manifest.id);
        const credential = await this.credentialStore.get(manifest.id);
        return {
          ...manifest,
          enabled: runtime?.enabled || false,
          authState:
            runtime?.authState ||
            (credential ? 'configured' : 'not_configured'),
          permission: runtime?.permission || manifest.permissions[0] || 'read',
          configured: Boolean(credential),
        };
      }),
    );
  }

  async setCredential(connectorId: string, credential: ConnectorCredential) {
    await this.credentialStore.set(connectorId, credential);
  }

  async deleteCredential(connectorId: string) {
    await this.credentialStore.delete(connectorId);
  }

  async listTools() {
    const summaries = await this.list();
    return summaries
      .filter((connector) => connector.enabled && connector.configured)
      .flatMap((connector) =>
        connector.tools
          .filter(
            (tool) =>
              permissionWeight[tool.permission] <=
              permissionWeight[connector.permission],
          )
          .map((tool) => ({
            connectorId: connector.id,
            connectorName: connector.displayName,
            ...tool,
          })),
      );
  }

  async callTool(call: ConnectorToolCall) {
    const implementation = this.registry.get(call.connectorId);
    if (!implementation) {
      throw new Error(`Connector not found: ${call.connectorId}`);
    }
    const runtime = this.getRuntimeConfig(call.connectorId);
    if (!runtime?.enabled) {
      throw new Error(`${implementation.manifest.displayName} is disabled.`);
    }
    const tool = implementation.manifest.tools.find(
      (item) => item.name === call.name,
    );
    const handler = implementation.handlers[call.name];
    if (!tool || !handler) {
      throw new Error(`Connector tool not found: ${call.name}`);
    }
    if (
      permissionWeight[tool.permission] >
      permissionWeight[runtime.permission || 'read']
    ) {
      throw new Error(
        `${implementation.manifest.displayName} lacks ${tool.permission} permission.`,
      );
    }
    const credential = await this.credentialStore.get(call.connectorId);
    return handler(call.arguments || {}, {
      manifest: implementation.manifest,
      credential,
      config: runtime.config || {},
    });
  }
}
