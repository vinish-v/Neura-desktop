/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { SettingStore } from '@main/store/setting';
import type { MailTaskIntakeSettings } from '@main/store/types';

import { BackgroundTaskService } from './background-task-service';
import { ConnectorsService } from './connectors-service';

type GmailHeader = {
  name?: string;
  value?: string;
};

type GmailMessage = {
  id?: string;
  payload?: {
    headers?: GmailHeader[];
  };
};

const DEFAULT_SETTINGS: MailTaskIntakeSettings = {
  enabled: false,
  connectorId: 'gmail',
  subjectPrefix: '[Neura Task]',
  maxResults: 10,
  processedMessageIds: [],
};

const getHeader = (message: GmailMessage, name: string) =>
  message.payload?.headers?.find(
    (header) => header.name?.toLowerCase() === name.toLowerCase(),
  )?.value || '';

const normalizeSettings = (
  settings?: Partial<MailTaskIntakeSettings>,
): MailTaskIntakeSettings => ({
  enabled: Boolean(settings?.enabled),
  connectorId: 'gmail',
  subjectPrefix: settings?.subjectPrefix?.trim() || DEFAULT_SETTINGS.subjectPrefix,
  maxResults:
    typeof settings?.maxResults === 'number'
      ? Math.min(25, Math.max(1, Math.round(settings.maxResults)))
      : DEFAULT_SETTINGS.maxResults,
  processedMessageIds: Array.isArray(settings?.processedMessageIds)
    ? settings.processedMessageIds.slice(-500)
    : [],
  updatedAt: settings?.updatedAt,
});

const extractJsonContent = (result: {
  content?: Array<{ type: string; json?: unknown }>;
}) => result.content?.find((item) => item.type === 'json')?.json as
  | { messages?: GmailMessage[] }
  | undefined;

export class MailTaskIntakeService {
  private static instance: MailTaskIntakeService | null = null;

  static getInstance() {
    if (!MailTaskIntakeService.instance) {
      MailTaskIntakeService.instance = new MailTaskIntakeService();
    }
    return MailTaskIntakeService.instance;
  }

  getSettings() {
    return normalizeSettings(SettingStore.get('mailTaskIntake'));
  }

  update(input: Partial<MailTaskIntakeSettings>) {
    const next = normalizeSettings({
      ...this.getSettings(),
      ...input,
      connectorId: 'gmail',
      updatedAt: Date.now(),
    });
    SettingStore.set('mailTaskIntake', next);
    return next;
  }

  async getStatus() {
    const settings = this.getSettings();
    const health = (await ConnectorsService.getInstance().getHealth('gmail'))[0];
    const setupGap = !settings.enabled
      ? 'Mail task intake is disabled.'
      : health?.setupGap ||
        (!health ? 'Gmail connector health is unavailable.' : undefined);
    return {
      settings,
      ready: Boolean(settings.enabled && health && !setupGap),
      setupGap,
      gmailHealth: health,
    };
  }

  async runOnce() {
    const settings = this.getSettings();
    if (!settings.enabled) {
      return {
        queued: 0,
        skipped: 0,
        message: 'Mail task intake is disabled.',
      };
    }
    const status = await this.getStatus();
    if (!status.ready) {
      return {
        queued: 0,
        skipped: 0,
        message: status.setupGap,
      };
    }
    const result = await ConnectorsService.getInstance().callTool({
      connectorId: 'gmail',
      name: 'gmail_list_unread',
      arguments: { maxResults: settings.maxResults },
    });
    const json = extractJsonContent(result);
    const messages = Array.isArray(json?.messages) ? json.messages : [];
    const processed = new Set(settings.processedMessageIds);
    let queued = 0;
    let skipped = 0;
    for (const message of messages) {
      const id = message.id?.trim();
      const subject = getHeader(message, 'Subject').trim();
      if (!id || processed.has(id) || !subject.startsWith(settings.subjectPrefix)) {
        skipped += 1;
        continue;
      }
      const goal = subject.slice(settings.subjectPrefix.length).trim();
      if (!goal) {
        skipped += 1;
        processed.add(id);
        continue;
      }
      await BackgroundTaskService.getInstance().enqueue({
        kind: 'multi_agent',
        goal,
        arguments: {
          intake: 'gmail_subject',
          gmailMessageId: id,
          from: getHeader(message, 'From'),
          date: getHeader(message, 'Date'),
          subject,
        },
      });
      queued += 1;
      processed.add(id);
    }
    this.update({
      processedMessageIds: [...processed].slice(-500),
    });
    return {
      queued,
      skipped,
      message: `Queued ${queued} task(s) from Gmail subjects; skipped ${skipped}.`,
    };
  }
}
