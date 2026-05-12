/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */

import { builtinConnectors } from './builtin-connectors';
import type { ConnectorImplementation, ConnectorManifest } from './types';

export class ConnectorRegistry {
  private readonly connectors = new Map<string, ConnectorImplementation>();

  constructor(connectors: ConnectorImplementation[] = builtinConnectors) {
    connectors.forEach((connector) => this.register(connector));
  }

  register(connector: ConnectorImplementation) {
    this.connectors.set(connector.manifest.id, connector);
  }

  list(): ConnectorManifest[] {
    return [...this.connectors.values()]
      .map((connector) => connector.manifest)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  get(id: string) {
    return this.connectors.get(id) || null;
  }

  findByTool(toolName: string) {
    for (const connector of this.connectors.values()) {
      if (connector.handlers[toolName]) {
        return connector;
      }
    }
    return null;
  }
}
