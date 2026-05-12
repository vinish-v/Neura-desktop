/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ConnectorImplementation,
  ConnectorManifest,
  ConnectorToolContext,
  ConnectorToolResult,
} from './types';

const jsonResult = (json: unknown): ConnectorToolResult => ({
  content: [{ type: 'json', json }],
});

const textResult = (text: string): ConnectorToolResult => ({
  content: [{ type: 'text', text }],
});

const requireToken = (context: ConnectorToolContext) => {
  const token = context.credential?.accessToken || context.credential?.apiKey;
  if (!token) {
    throw new Error(`${context.manifest.displayName} is not connected.`);
  }
  return token;
};

const requireWebhook = (context: ConnectorToolContext) => {
  const webhookUrl =
    context.credential?.webhookUrl || context.config.webhookUrl || '';
  if (!webhookUrl) {
    throw new Error(`${context.manifest.displayName} webhook URL is missing.`);
  }
  return webhookUrl;
};

const requestJson = async (
  url: string,
  init: RequestInit,
): Promise<unknown> => {
  const response = await fetch(url, init);
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(
      `Connector API failed (${response.status}): ${JSON.stringify(body)}`,
    );
  }
  return body;
};

const gmailManifest: ConnectorManifest = {
  id: 'gmail',
  displayName: 'Gmail',
  description: 'Read and summarize Gmail messages with user-approved OAuth.',
  authType: 'oauth2',
  permissions: ['read'],
  oauth: {
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    clientIdConfigKey: 'clientId',
    clientSecretConfigKey: 'clientSecret',
  },
  tools: [
    {
      name: 'gmail_list_unread',
      description: 'List unread Gmail messages for the connected account.',
      permission: 'read',
      inputSchema: {
        type: 'object',
        properties: {
          maxResults: { type: 'number', minimum: 1, maximum: 25 },
        },
      },
    },
  ],
  tags: ['email', 'google', 'workspace'],
};

const notionManifest: ConnectorManifest = {
  id: 'notion',
  displayName: 'Notion',
  description: 'Create pages in a configured Notion database or parent page.',
  authType: 'api_key',
  permissions: ['read', 'write'],
  tools: [
    {
      name: 'notion_create_page',
      description:
        'Create a Notion page using the connected integration token.',
      permission: 'write',
      inputSchema: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string' },
          content: { type: 'string' },
          parentPageId: { type: 'string' },
          databaseId: { type: 'string' },
        },
      },
    },
  ],
  tags: ['docs', 'knowledge-base'],
};

const slackManifest: ConnectorManifest = {
  id: 'slack',
  displayName: 'Slack',
  description: 'Post approved messages to Slack through a webhook.',
  authType: 'webhook',
  permissions: ['write'],
  tools: [
    {
      name: 'slack_post_message',
      description: 'Post a message through the configured Slack webhook.',
      permission: 'write',
      inputSchema: {
        type: 'object',
        required: ['text'],
        properties: {
          text: { type: 'string' },
        },
      },
    },
  ],
  tags: ['chat', 'notifications'],
};

const githubManifest: ConnectorManifest = {
  id: 'github',
  displayName: 'GitHub',
  description: 'Create issues and inspect repository data through GitHub API.',
  authType: 'api_key',
  permissions: ['read', 'write'],
  tools: [
    {
      name: 'github_create_issue',
      description: 'Create an issue in a GitHub repository.',
      permission: 'write',
      inputSchema: {
        type: 'object',
        required: ['repository', 'title'],
        properties: {
          repository: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string' },
          labels: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  ],
  tags: ['code', 'issues'],
};

const restManifest: ConnectorManifest = {
  id: 'generic_rest',
  displayName: 'Generic REST',
  description: 'Call an approved REST endpoint with optional API key auth.',
  authType: 'api_key',
  permissions: ['read', 'write'],
  tools: [
    {
      name: 'rest_request',
      description: 'Make a request to the configured REST API base URL.',
      permission: 'write',
      inputSchema: {
        type: 'object',
        required: ['path'],
        properties: {
          method: { type: 'string' },
          path: { type: 'string' },
          body: { type: 'object' },
        },
      },
    },
  ],
  tags: ['api', 'custom'],
};

export const builtinConnectors: ConnectorImplementation[] = [
  {
    manifest: gmailManifest,
    handlers: {
      gmail_list_unread: async (input, context) => {
        const maxResults = Math.min(
          Math.max(Number(input.maxResults || 10), 1),
          25,
        );
        const token = requireToken(context);
        const list = (await requestJson(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread&maxResults=${maxResults}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        )) as { messages?: Array<{ id: string }> };
        const messages = await Promise.all(
          (list.messages || []).slice(0, maxResults).map(async (message) =>
            requestJson(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
              {
                headers: { Authorization: `Bearer ${token}` },
              },
            ),
          ),
        );
        return jsonResult({ messages });
      },
    },
  },
  {
    manifest: notionManifest,
    handlers: {
      notion_create_page: async (input, context) => {
        const token = requireToken(context);
        const title = String(input.title || '').trim();
        if (!title) {
          throw new Error('title is required.');
        }
        const parentPageId = String(
          input.parentPageId || context.config.parentPageId || '',
        ).trim();
        const databaseId = String(
          input.databaseId || context.config.databaseId || '',
        ).trim();
        if (!parentPageId && !databaseId) {
          throw new Error('A Notion parentPageId or databaseId is required.');
        }
        const content = String(input.content || '').trim();
        const body = {
          parent: databaseId
            ? { database_id: databaseId }
            : { page_id: parentPageId },
          properties: databaseId
            ? { Name: { title: [{ text: { content: title } }] } }
            : { title: [{ text: { content: title } }] },
          children: content
            ? [
                {
                  object: 'block',
                  type: 'paragraph',
                  paragraph: {
                    rich_text: [{ type: 'text', text: { content } }],
                  },
                },
              ]
            : [],
        };
        return jsonResult(
          await requestJson('https://api.notion.com/v1/pages', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
              'Notion-Version': '2022-06-28',
            },
            body: JSON.stringify(body),
          }),
        );
      },
    },
  },
  {
    manifest: slackManifest,
    handlers: {
      slack_post_message: async (input, context) => {
        const text = String(input.text || '').trim();
        if (!text) {
          throw new Error('text is required.');
        }
        const response = await fetch(requireWebhook(context), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (!response.ok) {
          throw new Error(`Slack webhook failed (${response.status}).`);
        }
        return textResult('Slack message posted.');
      },
    },
  },
  {
    manifest: githubManifest,
    handlers: {
      github_create_issue: async (input, context) => {
        const token = requireToken(context);
        const repository = String(
          input.repository || context.config.repository || '',
        ).trim();
        const title = String(input.title || '').trim();
        if (!repository || !title) {
          throw new Error('repository and title are required.');
        }
        return jsonResult(
          await requestJson(
            `${context.config.apiBase || 'https://api.github.com'}/repos/${repository}/issues`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                title,
                body: String(input.body || ''),
                labels: Array.isArray(input.labels) ? input.labels : undefined,
              }),
            },
          ),
        );
      },
    },
  },
  {
    manifest: restManifest,
    handlers: {
      rest_request: async (input, context) => {
        const baseUrl = String(context.config.baseUrl || '').replace(/\/$/, '');
        const requestPath = String(input.path || '').trim();
        if (!baseUrl || !requestPath.startsWith('/')) {
          throw new Error('baseUrl config and /path input are required.');
        }
        const token = context.credential?.apiKey;
        return jsonResult(
          await requestJson(`${baseUrl}${requestPath}`, {
            method: String(input.method || 'GET').toUpperCase(),
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: input.body ? JSON.stringify(input.body) : undefined,
          }),
        );
      },
    },
  },
];
