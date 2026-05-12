/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OAuthConfig } from './types';

export const createOAuthAuthorizationUrl = (input: {
  oauth: OAuthConfig;
  clientId: string;
  redirectUri: string;
  state: string;
}) => {
  const url = new URL(input.oauth.authorizationUrl);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', input.oauth.scopes.join(' '));
  url.searchParams.set('state', input.state);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  return url.toString();
};

export const exchangeOAuthCode = async (input: {
  oauth: OAuthConfig;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  code: string;
}) => {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
  });
  if (input.clientSecret) {
    body.set('client_secret', input.clientSecret);
  }

  const response = await fetch(input.oauth.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`OAuth token exchange failed: ${JSON.stringify(payload)}`);
  }
  return payload;
};
