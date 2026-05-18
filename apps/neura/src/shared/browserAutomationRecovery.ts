/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { sanitizeTaskEvidence, type TaskEvidence } from './taskEvidence';

export type AutomationSurface = 'browser' | 'computer';

export type AutomationFailureKind =
  | 'approval_needed'
  | 'provider_config_missing'
  | 'tool_error'
  | 'validation_error'
  | 'connector_auth_error'
  | 'navigation_timeout'
  | 'network_timeout'
  | 'stale_dom'
  | 'selector_not_found'
  | 'download_failure'
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
  | 'request_approval'
  | 'configure_provider'
  | 'inspect_tool_error'
  | 'collect_missing_validation_evidence'
  | 'reauthenticate_connector'
  | 'retry_navigation'
  | 'check_network'
  | 'refresh_dom'
  | 'retry_download'
  | 'capture_snapshot'
  | 'ask_user_for_login_or_captcha'
  | 'request_permission'
  | 'relaunch_browser'
  | 'manual_handoff';

export type BrowserActionKind =
  | 'launch'
  | 'navigation'
  | 'click'
  | 'extraction'
  | 'download'
  | 'login_wait'
  | 'recovery'
  | 'other';

export const BROWSER_ACTION_TIMEOUT_BUDGETS_MS: Record<
  BrowserActionKind,
  number
> = {
  launch: 15_000,
  navigation: 30_000,
  click: 5_000,
  extraction: 12_000,
  download: 60_000,
  login_wait: 120_000,
  recovery: 20_000,
  other: 10_000,
};

export const classifyBrowserActionKind = (
  action?: string,
): BrowserActionKind => {
  const text = normalize(action);
  if (!text) {
    return 'other';
  }
  if (/\b(launch|start|connect|reuse)\b/i.test(text)) {
    return 'launch';
  }
  if (/\b(navigate|goto|open_url|search|url|visit)\b/i.test(text)) {
    return 'navigation';
  }
  if (/\b(click|press|tap|select|type|input|fill|submit)\b/i.test(text)) {
    return 'click';
  }
  if (/\b(extract|read|scrape|snapshot|screenshot|dom|content)\b/i.test(text)) {
    return 'extraction';
  }
  if (/\b(download|save|export)\b/i.test(text)) {
    return 'download';
  }
  if (/\b(login|signin|captcha|paywall|wait)\b/i.test(text)) {
    return 'login_wait';
  }
  if (/\b(recover|restart|reconnect|retry)\b/i.test(text)) {
    return 'recovery';
  }
  return 'other';
};

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
      /\b(approval required|requires approval|waiting for approval|approval needed|user approval)\b/i,
      /\b(permission proof|explicit approval|approve this action|approval gate)\b/i,
    ])
  ) {
    return 'approval_needed';
  }

  if (
    includesAny(text, [
      /\b(provider|model|planner|chat|llm|nim|openai|openrouter)\b.*\b(not configured|missing|required|invalid)\b/i,
      /\b(api key|base url|model name|credential)\b.*\b(missing|required|not configured|invalid)\b/i,
      /\b(provider_config_missing|configuration required)\b/i,
    ])
  ) {
    return 'provider_config_missing';
  }

  if (
    includesAny(text, [
      /\b(connector|github|slack|drive|oauth|mcp)\b.*\b(auth|authentication|unauthorized|forbidden|token|expired|not configured|not connected)\b/i,
      /\b(401|invalid token|oauth|refresh token|connector_auth_error)\b/i,
    ])
  ) {
    return 'connector_auth_error';
  }

  if (
    includesAny(text, [
      /\b(validation failed|validator failed|missing evidence|completion proof|cannot mark complete|needs verification)\b/i,
      /\b(validation_error|unsupported claim|contradictory evidence)\b/i,
    ])
  ) {
    return 'validation_error';
  }

  if (
    includesAny(text, [
      /\b(captcha|recaptcha|hcaptcha|cloudflare|bot detection|verify you are human)\b/i,
      /\b(paywall|subscribe to continue|subscription required|members only)\b/i,
      /\b(sign in|signin|login|log in|authentication required|session expired)\b/i,
      /\b(403|forbidden|access denied)\b/i,
    ])
  ) {
    return 'blocked_or_login_required';
  }

  if (
    includesAny(text, [
      /\b(detached|stale|stale element|element id was stale|execution context was destroyed)\b/i,
      /\b(dom|node|element)\b.*\b(stale|detached|changed|no longer attached)\b/i,
    ])
  ) {
    return 'stale_dom';
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
      /\b(net::err_internet_disconnected|net::err_network_changed|net::err_name_not_resolved|dns|offline)\b/i,
      /\b(network timeout|network error|connection timed out|connection reset)\b/i,
    ])
  ) {
    return 'network_timeout';
  }

  if (
    includesAny(text, [
      /\b(download)\b.*\b(failed|timeout|interrupted|blocked|cancelled|canceled)\b/i,
      /\b(download_failure|failed to download|download did not complete)\b/i,
    ])
  ) {
    return 'download_failure';
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

  if (
    includesAny(text, [
      /\b(tool|command|terminal|shell|script|process)\b.*\b(failed|error|exception|traceback|non-zero|exit code)\b/i,
      /\b(tool_error|runtime exited with code|uncaught exception)\b/i,
    ])
  ) {
    return 'tool_error';
  }

  return 'unknown';
};

export const recommendAutomationRecovery = (
  kind: AutomationFailureKind,
  surface: AutomationSurface = 'browser',
): AutomationRecoveryRecommendation => {
  const surfaceLabel = surface === 'browser' ? 'Browser' : 'Computer';

  switch (kind) {
    case 'approval_needed':
      return {
        kind,
        status: 'needs_user',
        label: 'Approval needed',
        nextAction: 'request_approval',
        steps: [
          'Record the exact requested action and target.',
          'Ask the user for explicit approval before continuing.',
          'Resume only after the approval event is recorded.',
        ],
        userFacingMessage:
          'This action requires explicit approval. Neura should pause, show the requested action, and resume only after approval is recorded.',
      };
    case 'provider_config_missing':
      return {
        kind,
        status: 'blocked',
        label: 'Provider setup missing',
        nextAction: 'configure_provider',
        steps: [
          'Record which provider setting is missing.',
          'Tell the user the exact setup requirement without exposing secrets.',
          'Retry only after the provider is configured.',
        ],
        userFacingMessage:
          'A required model/provider setting is missing. Neura should report the setup gap honestly instead of pretending output was created.',
      };
    case 'connector_auth_error':
      return {
        kind,
        status: 'blocked',
        label: 'Connector authentication needed',
        nextAction: 'reauthenticate_connector',
        steps: [
          'Record the connector and tool that failed.',
          'Ask the user to connect, refresh, or revoke/reconnect the connector.',
          'Retry the connector action only after authentication is healthy.',
        ],
        userFacingMessage:
          'The connector is not authenticated or its token failed. Neura needs the connector to be connected again before continuing.',
      };
    case 'validation_error':
      return {
        kind,
        status: 'blocked',
        label: 'Validation evidence missing',
        nextAction: 'collect_missing_validation_evidence',
        steps: [
          'Record the failed validation requirement.',
          'Collect the missing source, artifact, browser, command, or connector evidence.',
          'Do not mark the run complete until validation passes.',
        ],
        userFacingMessage:
          'Neura could not validate the result yet. It should collect the missing proof before claiming completion.',
      };
    case 'tool_error':
      return {
        kind,
        status: 'retryable',
        label: 'Tool execution error',
        nextAction: 'inspect_tool_error',
        steps: [
          'Record the failing tool and sanitized error output.',
          'Inspect whether configuration, inputs, or environment caused the failure.',
          'Retry only after the root cause is addressed.',
        ],
        userFacingMessage:
          'A runtime tool failed. Neura should show the sanitized error, fix the root cause if possible, and retry only with proof.',
      };
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
    case 'network_timeout':
      return {
        kind,
        status: 'retryable',
        label: 'Network timeout',
        nextAction: 'check_network',
        steps: [
          'Record the URL and network error.',
          'Retry once after checking the local connection or DNS state.',
          'Escalate to user guidance if the network error repeats.',
        ],
        userFacingMessage:
          'The browser could not reach the network reliably. Neura should retry once and then show the network blocker honestly.',
      };
    case 'stale_dom':
      return {
        kind,
        status: 'retryable',
        label: 'Stale page element',
        nextAction: 'refresh_dom',
        steps: [
          'Capture the current URL and visible page state.',
          'Refresh the DOM snapshot once.',
          'Retry with a semantic or visible selector before using coordinates.',
        ],
        userFacingMessage:
          'The page changed before Neura could act on the element. Neura should refresh the page snapshot and retry once with visible evidence.',
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
    case 'download_failure':
      return {
        kind,
        status: 'retryable',
        label: 'Download failed',
        nextAction: 'retry_download',
        steps: [
          'Record the attempted download target and current URL.',
          'Retry the download once.',
          'Verify the downloaded file exists before claiming completion.',
        ],
        userFacingMessage:
          'The browser download did not complete. Neura should retry once and verify a real local file before saying it succeeded.',
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
