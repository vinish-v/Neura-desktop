/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { initIpc } from '@neura-desktop/electron-ipc/main';
import type { ConnectorCredential } from '@agent-infra/shared';

import { ConnectorsService } from '@main/services/connectors-service';

const t = initIpc.create();

export const connectorsRoute = t.router({
  listConnectors: t.procedure.input<void>().handle(async () => {
    return ConnectorsService.getInstance().list();
  }),
  listConnectorHealth: t.procedure.input<void>().handle(async () => {
    return ConnectorsService.getInstance().getHealth();
  }),
  getConnectorAuditLog: t.procedure.input<void>().handle(async () => {
    return ConnectorsService.getInstance().getAuditLog();
  }),
  testConnector: t.procedure
    .input<{ connectorId: string }>()
    .handle(async ({ input }) => {
      return ConnectorsService.getInstance().testConnector(input.connectorId);
    }),
  refreshConnectorCredential: t.procedure
    .input<{ connectorId: string }>()
    .handle(async ({ input }) => {
      return ConnectorsService.getInstance().refresh(input.connectorId);
    }),
  revokeConnectorProviderToken: t.procedure
    .input<{ connectorId: string }>()
    .handle(async ({ input }) => {
      return ConnectorsService.getInstance().revokeProvider(input.connectorId);
    }),
  connectConnector: t.procedure
    .input<{
      connectorId: string;
      credential?: ConnectorCredential;
      config?: Record<string, string>;
    }>()
    .handle(async ({ input }) => {
      return ConnectorsService.getInstance().connect(input);
    }),
  disconnectConnector: t.procedure
    .input<{ connectorId: string }>()
    .handle(async ({ input }) => {
      return ConnectorsService.getInstance().disconnect(input.connectorId);
    }),
  updateConnector: t.procedure
    .input<{
      connectorId: string;
      enabled?: boolean;
      permission?: 'read' | 'write' | 'admin';
      config?: Record<string, string>;
    }>()
    .handle(async ({ input }) => {
      return ConnectorsService.getInstance().update(input);
    }),
  beginConnectorOAuth: t.procedure
    .input<{ connectorId: string }>()
    .handle(async ({ input }) => {
      return ConnectorsService.getInstance().beginOAuth(input.connectorId);
    }),
  completeConnectorOAuth: t.procedure
    .input<{ connectorId: string; code: string }>()
    .handle(async ({ input }) => {
      return ConnectorsService.getInstance().completeOAuth(input);
    }),
});
