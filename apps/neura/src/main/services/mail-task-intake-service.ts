/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'crypto';

import { SettingStore } from '@main/store/setting';
import type {
  MailTaskIntakeAuditEvent,
  MailTaskIntakeSettings,
} from '@main/store/types';

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
  senderAllowlist: [],
  processedMessageIds: [],
  auditLog: [],
};

const getHeader = (message: GmailMessage, name: string) =>
  message.payload?.headers?.find(
    (header) => header.name?.toLowerCase() === name.toLowerCase(),
  )?.value || '';

const normalizeAllowlist = (entries?: string[]) =>
  Array.isArray(entries)
    ? [
        ...new Set(
          entries
            .map((entry) => entry.trim().toLowerCase())
            .filter(Boolean),
        ),
      ].slice(0, 100)
    : [];

const extractEmailAddress = (value: string) => {
  const bracketed = value.match(/<([^<>@\s]+@[^<>\s]+)>/u)?.[1];
  if (bracketed) {
    return bracketed.toLowerCase();
  }
  return value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu)?.[0].toLowerCase();
};

const isSenderAllowed = (from: string, allowlist: string[]) => {
  if (!allowlist.length) {
    return true;
  }
  const email = extractEmailAddress(from);
  if (!email) {
    return false;
  }
  const domain = email.split('@')[1] || '';
  return allowlist.some((entry) => {
    const normalized = entry.toLowerCase();
    if (normalized.includes('@') && !normalized.startsWith('@')) {
      return email === normalized;
    }
    const allowedDomain = normalized.replace(/^@/u, '');
    return domain === allowedDomain || domain.endsWith(`.${allowedDomain}`);
  });
};

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
  senderAllowlist: normalizeAllowlist(settings?.senderAllowlist),
  processedMessageIds: Array.isArray(settings?.processedMessageIds)
    ? settings.processedMessageIds.slice(-500)
    : [],
  auditLog: Array.isArray(settings?.auditLog) ? settings.auditLog.slice(0, 200) : [],
  lastRunAt: settings?.lastRunAt,
  updatedAt: settings?.updatedAt,
});

const buildAuditEvent = (
  event: Omit<MailTaskIntakeAuditEvent, 'id' | 'createdAt'>,
): MailTaskIntakeAuditEvent => ({
  id: `mail_intake_${Date.now()}_${randomUUID().slice(0, 8)}`,
  ...event,
  createdAt: Date.now(),
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
    const auditEvents: Array<Omit<MailTaskIntakeAuditEvent, 'id' | 'createdAt'>> = [];
    let queued = 0;
    let skipped = 0;
    for (const message of messages) {
      const id = message.id?.trim();
      const subject = getHeader(message, 'Subject').trim();
      const from = getHeader(message, 'From').trim();
      const date = getHeader(message, 'Date');
      if (!id) {
        skipped += 1;
        auditEvents.push({
          status: 'skipped',
          from,
          subject,
          reason: 'Gmail message did not include an id.',
        });
        continue;
      }
      if (processed.has(id)) {
        skipped += 1;
        continue;
      }
      if (!subject.startsWith(settings.subjectPrefix)) {
        skipped += 1;
        auditEvents.push({
          messageId: id,
          status: 'skipped',
          from,
          subject,
          reason: 'Subject prefix did not match.',
        });
        continue;
      }
      if (!isSenderAllowed(from, settings.senderAllowlist)) {
        skipped += 1;
        processed.add(id);
        auditEvents.push({
          messageId: id,
          status: 'skipped',
          from,
          subject,
          reason: 'Sender is not in the local allowlist.',
        });
        continue;
      }
      const goal = subject.slice(settings.subjectPrefix.length).trim();
      if (!goal) {
        skipped += 1;
        processed.add(id);
        auditEvents.push({
          messageId: id,
          status: 'skipped',
          from,
          subject,
          reason: 'Subject prefix was present but no task goal followed it.',
        });
        continue;
      }
      try {
        const queuedTask = await BackgroundTaskService.getInstance().enqueue({
          kind: 'multi_agent',
          goal,
          arguments: {
            intake: 'gmail_subject',
            gmailMessageId: id,
            from,
            date,
            subject,
          },
        });
        queued += 1;
        processed.add(id);
        auditEvents.push({
          messageId: id,
          status: 'queued',
          from,
          subject,
          queuedTaskId: queuedTask.id,
          reason: 'Queued explicit Gmail task subject.',
        });
      } catch (error) {
        skipped += 1;
        auditEvents.push({
          messageId: id,
          status: 'failed',
          from,
          subject,
          reason:
            error instanceof Error
              ? `Failed to queue task: ${error.message}`
              : 'Failed to queue task.',
        });
      }
    }
    this.update({
      processedMessageIds: [...processed].slice(-500),
      auditLog: [
        ...auditEvents.map(buildAuditEvent),
        ...(settings.auditLog || []),
      ].slice(0, 200),
      lastRunAt: Date.now(),
    });
    return {
      queued,
      skipped,
      message: `Queued ${queued} task(s) from Gmail subjects; skipped ${skipped}.`,
    };
  }
}
