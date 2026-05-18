/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Github,
  KeyRound,
  Lock,
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

const permissionOptions = ['read', 'write', 'admin'] as const;

const inputClass =
  'rounded-full border-[#f6f1e8]/[0.12] bg-black/30 px-4 text-[#f6f1e8] placeholder:text-[#f6f1e8]/28';

const BrandIcon = ({ connectorId }: { connectorId: string }) => {
  if (connectorId === 'gmail') {
    return (
      <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
        <path fill="#EA4335" d="M4 6.4 12 12l8-5.6v11.2a1.6 1.6 0 0 1-1.6 1.6h-2.2V10.8L12 15.8l-4.2-5v8.4H5.6A1.6 1.6 0 0 1 4 17.6V6.4Z" />
        <path fill="#FBBC04" d="M4 6.4 12 12l8-5.6v2.8l-8 5.6-8-5.6V6.4Z" />
        <path fill="#34A853" d="M16.2 10.8 20 8.2v9.4a1.6 1.6 0 0 1-1.6 1.6h-2.2v-8.4Z" />
        <path fill="#4285F4" d="M4 8.2v9.4a1.6 1.6 0 0 0 1.6 1.6h2.2v-8.4L4 8.2Z" />
      </svg>
    );
  }

  if (connectorId === 'slack') {
    return (
      <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
        <rect x="10" y="2" width="4" height="9" rx="2" fill="#36C5F0" />
        <rect x="10" y="13" width="4" height="9" rx="2" fill="#2EB67D" />
        <rect x="13" y="10" width="9" height="4" rx="2" fill="#ECB22E" />
        <rect x="2" y="10" width="9" height="4" rx="2" fill="#E01E5A" />
      </svg>
    );
  }

  if (connectorId === 'notion') {
    return (
      <div className="flex h-6 w-6 items-center justify-center rounded-md border border-black/15 bg-white text-[15px] font-bold text-black">
        N
      </div>
    );
  }

  if (connectorId === 'github') {
    return <Github className="h-6 w-6 text-[#f6f1e8]" />;
  }

  return <Plug className="h-6 w-6 text-[#f6f1e8]" />;
};

const ConnectorCard = ({
  connector,
  onRefresh,
}: {
  connector: ConnectorSummary;
  onRefresh: () => Promise<void>;
}) => {
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
    <article className="rounded-[30px] border border-[#f6f1e8]/[0.1] bg-[#11100e]/82 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
      <div className="flex items-start gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[22px] border border-[#f6f1e8]/[0.1] bg-[#f6f1e8]/[0.055]">
          <BrandIcon connectorId={connector.id} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[17px] font-semibold text-[#f6f1e8]">
                {connector.displayName}
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-5 text-[#f6f1e8]/46">
                {connector.description}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-[#f6f1e8]/[0.1] bg-[#f6f1e8]/[0.045] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#f6f1e8]/52">
                {connector.authState}
              </span>
              {connector.configured && (
                <CheckCircle2 className="h-4 w-4 text-emerald-200" />
              )}
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-[1fr_150px_110px]">
            <div>
              <Label className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#f6f1e8]/42">
                Permission
              </Label>
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
                <SelectTrigger className="mt-2 h-10 rounded-full border-[#f6f1e8]/[0.12] bg-black/30 text-[#f6f1e8]">
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
              <Label className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#f6f1e8]/42">
                Enabled
              </Label>
              <div className="mt-3">
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
                className="rounded-full border-[#f6f1e8]/[0.12] bg-transparent text-[#f6f1e8]/70 hover:bg-[#f6f1e8]/[0.08] hover:text-[#f6f1e8]"
              >
                <Unplug className="h-3.5 w-3.5" />
                Revoke
              </Button>
            </div>
          </div>

          <div className="mt-4 text-xs text-[#f6f1e8]/38">
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
                      className={inputClass}
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
                      className={inputClass}
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
                    <span className="self-center truncate text-xs text-[#f6f1e8]/52">
                      OAuth opened in browser
                    </span>
                  )}
                </div>
                <div className="grid gap-3 md:grid-cols-[1fr_130px]">
                  <Input
                    className={inputClass}
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
                    className={inputClass}
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
                  className={inputClass}
                  type="password"
                  value={draft.apiKey || ''}
                  onChange={(event) =>
                    updateDraft('apiKey', event.target.value)
                  }
                  placeholder="Notion integration token"
                />
                <Input
                  className={inputClass}
                  value={draft.parentPageId || ''}
                  onChange={(event) =>
                    updateDraft('parentPageId', event.target.value)
                  }
                  placeholder="Parent page ID"
                />
                <Input
                  className={inputClass}
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
                className={inputClass}
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
                  className={inputClass}
                  type="password"
                  value={draft.apiKey || ''}
                  onChange={(event) =>
                    updateDraft('apiKey', event.target.value)
                  }
                  placeholder="GitHub token"
                />
                <Input
                  className={inputClass}
                  value={draft.repository || ''}
                  onChange={(event) =>
                    updateDraft('repository', event.target.value)
                  }
                  placeholder="owner/repo"
                />
                <Input
                  className={inputClass}
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
                  className={inputClass}
                  value={draft.baseUrl || ''}
                  onChange={(event) =>
                    updateDraft('baseUrl', event.target.value)
                  }
                  placeholder="https://api.example.com"
                />
                <Input
                  className={inputClass}
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
                <Button
                  type="submit"
                  disabled={busy}
                  className="rounded-full bg-[#f6f1e8] text-black hover:bg-white"
                >
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
    <div className="neura-home-page h-full overflow-y-auto px-5 py-8 md:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-4 flex w-fit items-center gap-2 rounded-full border border-[#f6f1e8]/[0.1] bg-[#f6f1e8]/[0.045] px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.18em] text-[#f6f1e8]/58">
              <span className="h-1.5 w-1.5 rounded-full bg-[#f6f1e8]" />
              App connections
            </div>
            <h1 className="max-w-3xl text-[54px] font-semibold leading-[0.92] tracking-normal text-[#f6f1e8] md:text-[76px]">
              Connect your work apps.
            </h1>
            <p className="mt-5 max-w-xl text-sm leading-6 text-[#f6f1e8]/48">
              Add secure credentials for services Neura can read from or write
              to during a task.
            </p>
          </div>
          <Button
            variant="outline"
            className="rounded-full border-[#f6f1e8]/[0.12] bg-transparent text-[#f6f1e8]/70 hover:bg-[#f6f1e8]/[0.08] hover:text-[#f6f1e8]"
            onClick={refresh}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>

        <section className="mb-5 rounded-[30px] border border-[#f6f1e8]/[0.1] bg-[#f6f1e8] p-5 text-black">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4" />
            Secure Credential Storage
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-black/58">
            Tokens and webhooks are encrypted through Electron safeStorage and
            are not saved in normal app settings.
          </p>
          {recommended.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {recommended.map((connector) => (
                <span
                  key={connector.id}
                  className="rounded-full border border-black/10 bg-black/[0.045] px-3 py-1 text-xs text-black/62"
                >
                  Recommended: {connector.displayName}
                </span>
              ))}
            </div>
          )}
        </section>

        <div className="grid gap-4 pb-8">
          {loading ? (
            <div className="rounded-[28px] border border-[#f6f1e8]/[0.1] bg-[#11100e]/72 p-6 text-sm text-[#f6f1e8]/42">
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
