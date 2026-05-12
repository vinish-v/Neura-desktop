/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */

export type ConnectorAuthType = 'oauth2' | 'api_key' | 'webhook' | 'none';

export type ConnectorPermission = 'read' | 'write' | 'admin';

export type ConnectorAuthState =
  | 'not_configured'
  | 'configured'
  | 'expired'
  | 'error';

export type OAuthConfig = {
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  redirectUri?: string;
  clientIdConfigKey?: string;
  clientSecretConfigKey?: string;
};

export type ConnectorToolDefinition = {
  name: string;
  description: string;
  permission: ConnectorPermission;
  inputSchema?: Record<string, unknown>;
};

export type ConnectorManifest = {
  id: string;
  displayName: string;
  description: string;
  authType: ConnectorAuthType;
  permissions: ConnectorPermission[];
  tools: ConnectorToolDefinition[];
  oauth?: OAuthConfig;
  configSchema?: Record<string, unknown>;
  tags?: string[];
};

export type ConnectorCredential = {
  accessToken?: string;
  refreshToken?: string;
  apiKey?: string;
  webhookUrl?: string;
  expiresAt?: number;
  metadata?: Record<string, unknown>;
};

export type ConnectorRuntimeConfig = {
  enabled: boolean;
  permission: ConnectorPermission;
  authState: ConnectorAuthState;
  config?: Record<string, string>;
};

export type ConnectorSummary = ConnectorManifest & {
  enabled: boolean;
  authState: ConnectorAuthState;
  permission: ConnectorPermission;
  configured: boolean;
};

export type ConnectorToolCall = {
  connectorId: string;
  name: string;
  arguments?: Record<string, unknown>;
};

export type ConnectorToolResult = {
  isError?: boolean;
  content: Array<
    | {
        type: 'text';
        text: string;
      }
    | {
        type: 'json';
        json: unknown;
      }
  >;
};

export type ConnectorCredentialStore = {
  get(connectorId: string): Promise<ConnectorCredential | null>;
  set(connectorId: string, credential: ConnectorCredential): Promise<void>;
  delete(connectorId: string): Promise<void>;
};

export type ConnectorToolContext = {
  manifest: ConnectorManifest;
  credential: ConnectorCredential | null;
  config: Record<string, string>;
};

export type ConnectorToolHandler = (
  input: Record<string, unknown>,
  context: ConnectorToolContext,
) => Promise<ConnectorToolResult>;

export type ConnectorImplementation = {
  manifest: ConnectorManifest;
  handlers: Record<string, ConnectorToolHandler>;
};
