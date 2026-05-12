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
    id: 'builtin_mcp',
    displayName: 'Neura Built-in MCP Tools',
    type: 'mcp',
    enabled: false,
    authState: 'configured',
    permissionLevel: 'write',
    tools: ['filesystem', 'commands', 'search', 'browser'],
    config: {
      servers: 'filesystem,commands,search,browser',
      allowedDirectories: '',
    },
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
      url: '',
    },
  },
];

const connectorHelp: Record<string, string> = {
  github:
    'Set the token from the Connectors page so it is stored with Electron safeStorage. Repository defaults can stay here.',
  slack_webhook:
    'Legacy webhook settings are disabled here. Use the Connectors page for secure Slack webhook storage.',
  google_drive_export:
    'Prepares Drive-compatible exports now; OAuth upload is a later connector worker.',
  builtin_mcp:
    'Expose Neura packaged MCP servers to autonomous tasks. Leave disabled until you want MCP tools available in the desktop agent.',
  custom_mcp:
    'Set command/args/env for an additional local MCP server. Enabled servers are connected by the desktop runtime.',
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

      <section className="rounded-lg border border-border bg-background p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-medium">Skills System</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Allow Neura to load and execute reusable local skills.
            </p>
          </div>
          <Switch
            checked={settings.skillsEnabled !== false}
            onCheckedChange={(skillsEnabled) =>
              updateSetting({
                ...settings,
                skillsEnabled,
              })
            }
          />
        </div>
      </section>

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
                  <p className="text-sm text-muted-foreground">
                    Slack webhooks are stored securely from the Connectors page.
                  </p>
                </div>
              )}

              {connector.id === 'github' && (
                <div className="mt-4 space-y-2">
                  <p className="text-sm text-muted-foreground">
                    GitHub tokens are stored securely from the Connectors page.
                  </p>
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

              {connector.id === 'builtin_mcp' && (
                <div className="mt-4 grid gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="builtin-mcp-servers">Servers</Label>
                    <Input
                      id="builtin-mcp-servers"
                      value={connector.config?.servers || ''}
                      placeholder="filesystem,commands,search,browser"
                      onChange={(event) =>
                        updateConfig(
                          connector.id,
                          'servers',
                          event.target.value,
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="builtin-mcp-directories">
                      Allowed directories
                    </Label>
                    <Input
                      id="builtin-mcp-directories"
                      value={connector.config?.allowedDirectories || ''}
                      placeholder="Optional ; separated paths. Defaults to Documents and the app workspace."
                      onChange={(event) =>
                        updateConfig(
                          connector.id,
                          'allowedDirectories',
                          event.target.value,
                        )
                      }
                    />
                  </div>
                </div>
              )}

              {connector.id === 'custom_mcp' && (
                <div className="mt-4 grid gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="mcp-url">HTTP URL</Label>
                    <Input
                      id="mcp-url"
                      value={connector.config?.url || ''}
                      placeholder="Optional http://127.0.0.1:8089/mcp"
                      onChange={(event) =>
                        updateConfig(connector.id, 'url', event.target.value)
                      }
                    />
                  </div>
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
