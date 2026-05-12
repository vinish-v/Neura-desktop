/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  KeyRound,
  Link2,
  Lock,
  Mail,
  Plug,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from 'lucide-react';
import type { ConnectorSummary } from '@agent-infra/shared';

import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select';
import { Switch } from '@renderer/components/ui/switch';

type Draft = {
  apiKey?: string;
  webhookUrl?: string;
  clientId?: string;
  redirectUri?: string;
  oauthCode?: string;
  repository?: string;
  apiBase?: string;
  baseUrl?: string;
  parentPageId?: string;
  databaseId?: string;
};

const iconByConnector: Record<string, typeof Plug> = {
  gmail: Mail,
  notion: Link2,
  slack: Plug,
  github: KeyRound,
  generic_rest: Link2,
};

const permissionOptions = ['read', 'write', 'admin'] as const;

const ConnectorCard = ({
  connector,
  onRefresh,
}: {
  connector: ConnectorSummary;
  onRefresh: () => Promise<void>;
}) => {
  const Icon = iconByConnector[connector.id] || Plug;
  const [draft, setDraft] = useState<Draft>({});
  const [busy, setBusy] = useState(false);
  const [oauthUrl, setOauthUrl] = useState('');

  const updateDraft = (key: keyof Draft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const config = useMemo(() => {
    const next: Record<string, string> = {};
    for (const key of [
      'clientId',
      'redirectUri',
      'repository',
      'apiBase',
      'baseUrl',
      'parentPageId',
      'databaseId',
    ] as Array<keyof Draft>) {
      const value = draft[key]?.trim();
      if (value) {
        next[key] = value;
      }
    }
    return next;
  }, [draft]);

  const saveCredential = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.connectConnector({
        connectorId: connector.id,
        config,
        credential: {
          apiKey: draft.apiKey?.trim() || undefined,
          accessToken:
            connector.authType === 'oauth2'
              ? draft.apiKey?.trim() || undefined
              : undefined,
          webhookUrl: draft.webhookUrl?.trim() || undefined,
        },
      });
      await onRefresh();
      setDraft({});
    } finally {
      setBusy(false);
    }
  };

  const beginOAuth = async () => {
    setBusy(true);
    try {
      await api.updateConnector({
        connectorId: connector.id,
        config,
      });
      const result = await api.beginConnectorOAuth({
        connectorId: connector.id,
      });
      setOauthUrl(result.authorizationUrl);
    } finally {
      setBusy(false);
    }
  };

  const completeOAuth = async () => {
    if (!draft.oauthCode?.trim()) {
      return;
    }
    setBusy(true);
    try {
      await api.completeConnectorOAuth({
        connectorId: connector.id,
        code: draft.oauthCode.trim(),
      });
      await onRefresh();
      setDraft({});
      setOauthUrl('');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await api.disconnectConnector({ connectorId: connector.id });
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="rounded-lg border border-white/10 bg-white/[0.045] p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-md bg-black/30 p-2">
          <Icon className="h-4 w-4 text-white/85" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-white">
                {connector.displayName}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {connector.description}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] uppercase text-muted-foreground">
                {connector.authState}
              </span>
              {connector.configured && (
                <CheckCircle2 className="h-4 w-4 text-emerald-200" />
              )}
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_160px_110px]">
            <div>
              <Label className="text-xs">Permission</Label>
              <Select
                value={connector.permission}
                onValueChange={(permission: 'read' | 'write' | 'admin') =>
                  api
                    .updateConnector({
                      connectorId: connector.id,
                      permission,
                    })
                    .then(onRefresh)
                }
              >
                <SelectTrigger className="mt-1 h-9 border-white/10 bg-black">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {permissionOptions.map((permission) => (
                    <SelectItem key={permission} value={permission}>
                      {permission}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Enabled</Label>
              <div className="mt-2">
                <Switch
                  checked={connector.enabled}
                  onCheckedChange={(enabled) =>
                    api
                      .updateConnector({
                        connectorId: connector.id,
                        enabled,
                      })
                      .then(onRefresh)
                  }
                />
              </div>
            </div>
            <div className="flex items-end justify-end">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={disconnect}
              >
                <Unplug className="h-3.5 w-3.5" />
                Revoke
              </Button>
            </div>
          </div>

          <div className="mt-4 text-xs text-muted-foreground">
            Tools: {connector.tools.map((tool) => tool.name).join(', ')}
          </div>

          <form onSubmit={saveCredential} className="mt-4 grid gap-3">
            {connector.id === 'gmail' && (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <Label htmlFor={`${connector.id}-client-id`}>
                      OAuth Client ID
                    </Label>
                    <Input
                      id={`${connector.id}-client-id`}
                      value={draft.clientId || ''}
                      onChange={(event) =>
                        updateDraft('clientId', event.target.value)
                      }
                      placeholder="Google OAuth client id"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`${connector.id}-redirect`}>
                      Redirect URI
                    </Label>
                    <Input
                      id={`${connector.id}-redirect`}
                      value={draft.redirectUri || ''}
                      onChange={(event) =>
                        updateDraft('redirectUri', event.target.value)
                      }
                      placeholder="http://127.0.0.1:54887/oauth/callback"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" disabled={busy} onClick={beginOAuth}>
                    <Lock className="h-4 w-4" />
                    Start OAuth
                  </Button>
                  {oauthUrl && (
                    <span className="self-center truncate text-xs text-blue-200">
                      OAuth opened in browser
                    </span>
                  )}
                </div>
                <div className="grid gap-3 md:grid-cols-[1fr_130px]">
                  <Input
                    value={draft.oauthCode || ''}
                    onChange={(event) =>
                      updateDraft('oauthCode', event.target.value)
                    }
                    placeholder="Paste OAuth code"
                  />
                  <Button
                    type="button"
                    disabled={busy || !draft.oauthCode?.trim()}
                    onClick={completeOAuth}
                  >
                    Complete
                  </Button>
                </div>
                <div>
                  <Label htmlFor={`${connector.id}-access-token`}>
                    Access Token
                  </Label>
                  <Input
                    id={`${connector.id}-access-token`}
                    type="password"
                    value={draft.apiKey || ''}
                    onChange={(event) =>
                      updateDraft('apiKey', event.target.value)
                    }
                    placeholder="Optional direct access token"
                  />
                </div>
              </>
            )}

            {connector.id === 'notion' && (
              <div className="grid gap-3 md:grid-cols-3">
                <Input
                  type="password"
                  value={draft.apiKey || ''}
                  onChange={(event) =>
                    updateDraft('apiKey', event.target.value)
                  }
                  placeholder="Notion integration token"
                />
                <Input
                  value={draft.parentPageId || ''}
                  onChange={(event) =>
                    updateDraft('parentPageId', event.target.value)
                  }
                  placeholder="Parent page ID"
                />
                <Input
                  value={draft.databaseId || ''}
                  onChange={(event) =>
                    updateDraft('databaseId', event.target.value)
                  }
                  placeholder="Database ID"
                />
              </div>
            )}

            {connector.id === 'slack' && (
              <Input
                type="password"
                value={draft.webhookUrl || ''}
                onChange={(event) =>
                  updateDraft('webhookUrl', event.target.value)
                }
                placeholder="Slack webhook URL"
              />
            )}

            {connector.id === 'github' && (
              <div className="grid gap-3 md:grid-cols-3">
                <Input
                  type="password"
                  value={draft.apiKey || ''}
                  onChange={(event) =>
                    updateDraft('apiKey', event.target.value)
                  }
                  placeholder="GitHub token"
                />
                <Input
                  value={draft.repository || ''}
                  onChange={(event) =>
                    updateDraft('repository', event.target.value)
                  }
                  placeholder="owner/repo"
                />
                <Input
                  value={draft.apiBase || ''}
                  onChange={(event) =>
                    updateDraft('apiBase', event.target.value)
                  }
                  placeholder="https://api.github.com"
                />
              </div>
            )}

            {connector.id === 'generic_rest' && (
              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  value={draft.baseUrl || ''}
                  onChange={(event) =>
                    updateDraft('baseUrl', event.target.value)
                  }
                  placeholder="https://api.example.com"
                />
                <Input
                  type="password"
                  value={draft.apiKey || ''}
                  onChange={(event) =>
                    updateDraft('apiKey', event.target.value)
                  }
                  placeholder="Optional API key"
                />
              </div>
            )}

            {connector.authType !== 'oauth2' && (
              <div className="flex justify-end">
                <Button type="submit" disabled={busy}>
                  <KeyRound className="h-4 w-4" />
                  Save Securely
                </Button>
              </div>
            )}
          </form>
        </div>
      </div>
    </article>
  );
};

export default function Connectors() {
  const [connectors, setConnectors] = useState<ConnectorSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setConnectors(await api.listConnectors());
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const recommended = connectors.filter(
    (connector) =>
      !connector.configured && ['gmail', 'notion'].includes(connector.id),
  );

  return (
    <div className="h-full overflow-y-auto px-8 py-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-white">Connectors</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Secure integrations exposed to Neura agents as MCP tools.
            </p>
          </div>
          <Button variant="outline" onClick={refresh}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>

        <section className="mb-5 rounded-lg border border-white/10 bg-white/[0.04] p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <ShieldCheck className="h-4 w-4" />
            Secure Credential Storage
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Tokens and webhooks are encrypted through Electron safeStorage and
            are not saved in normal app settings.
          </p>
          {recommended.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {recommended.map((connector) => (
                <span
                  key={connector.id}
                  className="rounded-full border border-blue-400/25 bg-blue-400/10 px-3 py-1 text-xs text-blue-100"
                >
                  Recommended: {connector.displayName}
                </span>
              ))}
            </div>
          )}
        </section>

        <div className="grid gap-4">
          {loading ? (
            <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4 text-sm text-muted-foreground">
              Loading connectors...
            </div>
          ) : (
            connectors.map((connector) => (
              <ConnectorCard
                key={connector.id}
                connector={connector}
                onRefresh={refresh}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
