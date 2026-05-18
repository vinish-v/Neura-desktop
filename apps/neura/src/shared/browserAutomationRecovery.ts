/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { sanitizeTaskEvidence, type TaskEvidence } from './taskEvidence';

export type AutomationSurface = 'browser' | 'computer';

export type AutomationFailureKind =
  | 'navigation_timeout'
  | 'selector_not_found'
  | 'blocked_or_login_required'
  | 'permission_denied'
  | 'browser_crashed'
  | 'unknown';

export type AutomationRecoveryStatus =
  | 'retryable'
  | 'needs_user'
  | 'relaunch_required'
  | 'manual_handoff'
  | 'blocked';

export type AutomationRecoveryNextAction =
  | 'retry_navigation'
  | 'capture_snapshot'
  | 'ask_user_for_login_or_captcha'
  | 'request_permission'
  | 'relaunch_browser'
  | 'manual_handoff';

export type AutomationRecoveryInput = {
  surface: AutomationSurface;
  message?: string;
  toolName?: string;
  action?: string;
  url?: string;
  selector?: string;
  screenshotPath?: string;
  snapshotPath?: string;
  capturedAt?: number;
};

export type AutomationRecoveryRecommendation = {
  kind: AutomationFailureKind;
  status: AutomationRecoveryStatus;
  label: string;
  nextAction: AutomationRecoveryNextAction;
  steps: string[];
  userFacingMessage: string;
};

export type AutomationRecoveryReport = AutomationRecoveryRecommendation & {
  evidence: TaskEvidence;
};

const normalize = (value?: string) => (value || '').replace(/\s+/g, ' ').trim();

const includesAny = (value: string, patterns: RegExp[]) =>
  patterns.some((pattern) => pattern.test(value));

export const classifyAutomationFailure = (
  input: Pick<AutomationRecoveryInput, 'message' | 'toolName' | 'action'>,
): AutomationFailureKind => {
  const text = normalize(
    [input.toolName, input.action, input.message].filter(Boolean).join(' '),
  );

  if (!text) {
    return 'unknown';
  }

  if (
    includesAny(text, [
      /\b(captcha|recaptcha|hcaptcha|cloudflare|bot detection|verify you are human)\b/i,
      /\b(sign in|signin|login|log in|authentication required|session expired)\b/i,
      /\b(403|forbidden|access denied)\b/i,
    ])
  ) {
    return 'blocked_or_login_required';
  }

  if (
    includesAny(text, [
      /\b(permission denied|eacces|eperm|operation not permitted|not allowed)\b/i,
      /\b(denied by the user|administrator privileges|screen recording|accessibility permission)\b/i,
    ])
  ) {
    return 'permission_denied';
  }

  if (
    includesAny(text, [
      /\b(navigation timeout|timed out navigating|page load timeout)\b/i,
      /\b(net::err_timed_out|timeout .*navigation|timeout .*page|timeout .*load)\b/i,
    ])
  ) {
    return 'navigation_timeout';
  }

  if (
    includesAny(text, [
      /\b(selector|locator|element|dom node)\b.*\b(not found|missing|detached|stale|not visible|not clickable)\b/i,
      /\b(waiting for selector|no node found|could not click|could not type)\b/i,
    ])
  ) {
    return 'selector_not_found';
  }

  if (
    includesAny(text, [
      /\b(browser|page|target|cdp|websocket)\b.*\b(crash|crashed|closed|disconnected|disconnect|connection refused)\b/i,
      /\b(target closed|page crashed|browser has disconnected|cdp websocket connect failed)\b/i,
      /\b(econnrefused|no connection could be made)\b/i,
    ])
  ) {
    return 'browser_crashed';
  }

  return 'unknown';
};

export const recommendAutomationRecovery = (
  kind: AutomationFailureKind,
  surface: AutomationSurface = 'browser',
): AutomationRecoveryRecommendation => {
  const surfaceLabel = surface === 'browser' ? 'Browser' : 'Computer';

  switch (kind) {
    case 'navigation_timeout':
      return {
        kind,
        status: 'retryable',
        label: 'Navigation timeout',
        nextAction: 'retry_navigation',
        steps: [
          'Capture the current browser snapshot.',
          'Retry the navigation once with the same URL.',
          'Verify the final URL and page title before claiming success.',
        ],
        userFacingMessage:
          'The page did not finish loading in time. Neura should capture what is visible, retry once, and report the final URL/title.',
      };
    case 'selector_not_found':
      return {
        kind,
        status: 'retryable',
        label: 'Page element not found',
        nextAction: 'capture_snapshot',
        steps: [
          'Refresh the page or DOM snapshot.',
          'Look for an equivalent visible element.',
          'Use coordinate takeover only after recording what was visible.',
        ],
        userFacingMessage:
          'Neura could not find the target page element. It should refresh the page snapshot and retry against visible evidence.',
      };
    case 'blocked_or_login_required':
      return {
        kind,
        status: 'needs_user',
        label: 'Login, captcha, or site block',
        nextAction: 'ask_user_for_login_or_captcha',
        steps: [
          'Capture a screenshot or page snapshot of the blocker.',
          'Ask the user to complete login, captcha, or verification.',
          'Resume from the same page after user handoff.',
        ],
        userFacingMessage:
          'The site appears to require login, captcha, or human verification. Neura should pause and ask for user help instead of pretending it finished.',
      };
    case 'permission_denied':
      return {
        kind,
        status: 'blocked',
        label: 'Permission denied',
        nextAction: 'request_permission',
        steps: [
          'Record the denied action and target.',
          'Ask the user to grant the missing app or OS permission.',
          'Retry only after permission is confirmed.',
        ],
        userFacingMessage:
          'The action was blocked by a permission boundary. Neura needs user approval or OS permission before continuing.',
      };
    case 'browser_crashed':
      return {
        kind,
        status: 'relaunch_required',
        label: 'Browser disconnected or crashed',
        nextAction: 'relaunch_browser',
        steps: [
          'Record the last attempted browser action.',
          'Relaunch or reattach to the local browser session.',
          'Restore the last URL before continuing.',
        ],
        userFacingMessage:
          'The browser session disconnected. Neura should relaunch or reattach to the local browser and restore the last URL before retrying.',
      };
    default:
      return {
        kind: 'unknown',
        status: 'manual_handoff',
        label: `${surfaceLabel} automation failure`,
        nextAction: 'manual_handoff',
        steps: [
          'Record the failed action and visible context.',
          'Capture a screenshot or snapshot if possible.',
          'Ask the user whether to retry or take over manually.',
        ],
        userFacingMessage:
          'Neura hit an automation failure that was not classifiable. It should show the evidence and ask whether to retry or hand off.',
      };
  }
};

export const buildAutomationRecoveryReport = (
  input: AutomationRecoveryInput,
): AutomationRecoveryReport => {
  const kind = classifyAutomationFailure(input);
  const recommendation = recommendAutomationRecovery(kind, input.surface);
  const capturedAt = input.capturedAt || Date.now();
  const action = normalize(input.action || input.toolName);
  const message = normalize(input.message);
  const summary = [
    input.surface === 'browser' ? 'Browser recovery evidence' : 'Computer recovery evidence',
    recommendation.label,
    action ? `during ${action}` : '',
  ]
    .filter(Boolean)
    .join(': ');

  const evidence = sanitizeTaskEvidence({
    id: `automation-recovery-${capturedAt}`,
    kind: input.surface === 'browser' ? 'browser_snapshot' : 'command_test',
    summary,
    status: 'completed',
    confidence: kind === 'unknown' ? 0.35 : 0.62,
    capturedAt,
    url: input.url,
    path: input.screenshotPath || input.snapshotPath,
    toolName: input.toolName,
    command: input.surface === 'computer' ? action : undefined,
    metadata: {
      recovery: {
        kind: recommendation.kind,
        status: recommendation.status,
        nextAction: recommendation.nextAction,
        steps: recommendation.steps,
        userFacingMessage: recommendation.userFacingMessage,
        attemptedAction: action || undefined,
        attemptedUrl: input.url,
        selector: input.selector,
        failureMessage: message || undefined,
        screenshotPath: input.screenshotPath,
        snapshotPath: input.snapshotPath,
      },
    },
  });

  return {
    ...recommendation,
    evidence,
  };
};
