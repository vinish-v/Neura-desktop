/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Plug, ShieldCheck } from 'lucide-react';

import { ConnectorDefinition } from '@main/store/types';
import { useSetting } from '@renderer/hooks/useSetting';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { Switch } from '@renderer/components/ui/switch';
import { Textarea } from '@renderer/components/ui/textarea';

const DEFAULT_CONNECTORS: ConnectorDefinition[] = [
  {
    id: 'github',
    displayName: 'GitHub',
    type: 'builtin',
    enabled: false,
    authState: 'not_configured',
    permissionLevel: 'write',
    tools: ['connector_github_issue', 'connector_github_export'],
  },
  {
    id: 'slack_webhook',
    displayName: 'Slack Webhook',
    type: 'webhook',
    enabled: false,
    authState: 'not_configured',
    permissionLevel: 'write',
    tools: ['connector_slack_post'],
  },
  {
    id: 'google_drive_export',
    displayName: 'Google Drive Export',
    type: 'export',
    enabled: false,
    authState: 'not_configured',
    permissionLevel: 'write',
    tools: ['connector_drive_export'],
  },
  {
    id: 'custom_mcp',
    displayName: 'Custom MCP Server',
    type: 'mcp',
    enabled: false,
    authState: 'not_configured',
    permissionLevel: 'write',
    tools: ['connector_mcp_call'],
    config: {
      command: '',
      args: '',
      env: '',
    },
  },
];

const connectorHelp: Record<string, string> = {
  github:
    'Set a token and optional default repository like owner/repo. Neura can create issues and export files after approval.',
  slack_webhook: 'Set config.webhookUrl to allow connector_slack_post.',
  google_drive_export:
    'Prepares Drive-compatible exports now; OAuth upload is a later connector worker.',
  custom_mcp:
    'Set command/args/env for a local MCP server. Runtime MCP execution is the next slice.',
};

const getConnectors = (connectors?: ConnectorDefinition[]) => {
  const byId = new Map(
    (connectors || []).map((connector) => [connector.id, connector]),
  );
  return DEFAULT_CONNECTORS.map((connector) => ({
    ...connector,
    ...byId.get(connector.id),
    config: {
      ...(connector.config || {}),
      ...(byId.get(connector.id)?.config || {}),
    },
  }));
};

export function ConnectorSettings() {
  const { settings, updateSetting } = useSetting();
  const connectors = getConnectors(
    settings.connectors as ConnectorDefinition[],
  );

  const saveConnectors = (nextConnectors: ConnectorDefinition[]) => {
    updateSetting({
      ...settings,
      connectors: nextConnectors,
    });
  };

  const updateConnector = (id: string, patch: Partial<ConnectorDefinition>) => {
    saveConnectors(
      connectors.map((connector) =>
        connector.id === id
          ? {
              ...connector,
              ...patch,
              updatedAt: Date.now(),
            }
          : connector,
      ),
    );
  };

  const updateConfig = (id: string, key: string, value: string) => {
    const connector = connectors.find((item) => item.id === id);
    updateConnector(id, {
      config: {
        ...(connector?.config || {}),
        [key]: value,
      },
      authState: value.trim() ? 'configured' : 'not_configured',
    });
  };

  const resetConnector = (id: string) => {
    const fallback = DEFAULT_CONNECTORS.find(
      (connector) => connector.id === id,
    );
    if (!fallback) {
      return;
    }
    updateConnector(id, {
      ...fallback,
      updatedAt: Date.now(),
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
        <div className="mb-1 flex items-center gap-2 font-medium text-foreground">
          <ShieldCheck className="h-4 w-4" />
          Local Connector Center
        </div>
        Enable only the connectors Neura may expose to agent tools. Write tools
        record approval events on the active run.
      </div>

      {connectors.map((connector) => (
        <section
          key={connector.id}
          className="rounded-lg border border-border bg-background p-4"
        >
          <div className="flex items-start gap-3">
            <div className="mt-1 rounded-md bg-muted p-2">
              <Plug className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <div>
                  <h3 className="font-medium">{connector.displayName}</h3>
                  <p className="text-xs text-muted-foreground">
                    {connector.type} · {connector.authState} ·{' '}
                    {connector.permissionLevel}
                  </p>
                </div>
                <Switch
                  className="ml-auto"
                  checked={connector.enabled}
                  onCheckedChange={(enabled) =>
                    updateConnector(connector.id, { enabled })
                  }
                />
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {connectorHelp[connector.id]}
              </p>
              <div className="mt-2 text-xs text-muted-foreground">
                Tools: {connector.tools.join(', ')}
              </div>

              {connector.id === 'slack_webhook' && (
                <div className="mt-4 space-y-2">
                  <Label htmlFor="slack-webhook">Webhook URL</Label>
                  <Input
                    id="slack-webhook"
                    value={connector.config?.webhookUrl || ''}
                    placeholder="https://hooks.slack.com/services/..."
                    onChange={(event) =>
                      updateConfig(
                        connector.id,
                        'webhookUrl',
                        event.target.value,
                      )
                    }
                  />
                </div>
              )}

              {connector.id === 'github' && (
                <div className="mt-4 space-y-2">
                  <Label htmlFor="github-token">Token</Label>
                  <Input
                    id="github-token"
                    type="password"
                    value={connector.config?.token || ''}
                    placeholder="ghp_..."
                    onChange={(event) =>
                      updateConfig(connector.id, 'token', event.target.value)
                    }
                  />
                  <Label htmlFor="github-repository">Default repository</Label>
                  <Input
                    id="github-repository"
                    value={connector.config?.repository || ''}
                    placeholder="owner/repo"
                    onChange={(event) =>
                      updateConfig(
                        connector.id,
                        'repository',
                        event.target.value,
                      )
                    }
                  />
                  <Label htmlFor="github-api-base">API base URL</Label>
                  <Input
                    id="github-api-base"
                    value={
                      connector.config?.apiBase || 'https://api.github.com'
                    }
                    placeholder="https://api.github.com"
                    onChange={(event) =>
                      updateConfig(connector.id, 'apiBase', event.target.value)
                    }
                  />
                </div>
              )}

              {connector.id === 'custom_mcp' && (
                <div className="mt-4 grid gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="mcp-command">Command</Label>
                    <Input
                      id="mcp-command"
                      value={connector.config?.command || ''}
                      placeholder="npx"
                      onChange={(event) =>
                        updateConfig(
                          connector.id,
                          'command',
                          event.target.value,
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mcp-args">Args</Label>
                    <Input
                      id="mcp-args"
                      value={connector.config?.args || ''}
                      placeholder="-y @modelcontextprotocol/server-filesystem"
                      onChange={(event) =>
                        updateConfig(connector.id, 'args', event.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mcp-env">Env JSON</Label>
                    <Textarea
                      id="mcp-env"
                      value={connector.config?.env || ''}
                      placeholder='{"TOKEN":"..."}'
                      onChange={(event) =>
                        updateConfig(connector.id, 'env', event.target.value)
                      }
                    />
                  </div>
                </div>
              )}

              <div className="mt-4 flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => resetConnector(connector.id)}
                >
                  Reset
                </Button>
              </div>
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
