import { describe, expect, it } from 'vitest';

import {
  buildAutomationRecoveryReport,
  classifyAutomationFailure,
  recommendAutomationRecovery,
} from './browserAutomationRecovery';

describe('browser automation recovery', () => {
  it('classifies common browser and computer failures', () => {
    expect(
      classifyAutomationFailure({
        message: 'Action requires approval before posting to Slack',
      }),
    ).toBe('approval_needed');
    expect(
      classifyAutomationFailure({
        message: 'Planner provider API key is missing',
      }),
    ).toBe('provider_config_missing');
    expect(
      classifyAutomationFailure({
        message: 'GitHub connector returned 401 invalid token',
      }),
    ).toBe('connector_auth_error');
    expect(
      classifyAutomationFailure({
        message: 'Validation failed: missing evidence for completion proof',
      }),
    ).toBe('validation_error');
    expect(
      classifyAutomationFailure({
        message: 'Tool run_command failed with exit code 1',
      }),
    ).toBe('tool_error');
    expect(
      classifyAutomationFailure({
        toolName: 'browser_navigate',
        message: 'Navigation timeout of 30000 ms exceeded',
      }),
    ).toBe('navigation_timeout');
    expect(
      classifyAutomationFailure({
        toolName: 'browser_click',
        message: 'Element button.submit was not found in the DOM',
      }),
    ).toBe('selector_not_found');
    expect(
      classifyAutomationFailure({
        message: 'Cloudflare captcha asks to verify you are human',
      }),
    ).toBe('blocked_or_login_required');
    expect(
      classifyAutomationFailure({
        message: 'EACCES: permission denied opening screen recording',
      }),
    ).toBe('permission_denied');
    expect(
      classifyAutomationFailure({
        message: 'CDP WebSocket connect failed: no connection could be made',
      }),
    ).toBe('browser_crashed');
  });

  it('recommends concrete recovery steps for retryable browser failures', () => {
    const recommendation = recommendAutomationRecovery(
      'navigation_timeout',
      'browser',
    );

    expect(recommendation.status).toBe('retryable');
    expect(recommendation.nextAction).toBe('retry_navigation');
    expect(recommendation.steps.join(' ')).toContain('Retry');
    expect(recommendation.userFacingMessage).toContain('page did not finish');
  });

  it('redacts secrets from recovery evidence metadata', () => {
    const report = buildAutomationRecoveryReport({
      surface: 'browser',
      toolName: 'browser_navigate',
      action: 'open https://example.com?token=abc123',
      url: 'https://example.com/login',
      message:
        'Login required with Authorization: Bearer secret-token and apiKey=sk-secret',
      screenshotPath: 'C:\\Users\\HP\\Neura\\screen.png',
      capturedAt: 10,
    });

    const serialized = JSON.stringify(report.evidence);
    expect(report.kind).toBe('blocked_or_login_required');
    expect(report.evidence.kind).toBe('browser_snapshot');
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('sk-secret');
    expect(serialized).not.toContain('abc123');
    expect(serialized).toContain('[REDACTED]');
  });
});
