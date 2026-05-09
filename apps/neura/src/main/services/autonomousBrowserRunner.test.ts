import { describe, expect, it, vi } from 'vitest';

vi.mock('@main/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

import {
  Actors,
  AgentEvent,
  EventType,
  ExecutionState,
} from '@agent-infra/browser-use';
import {
  buildInitialBrowserUrl,
  executorEventToProgress,
} from './autonomousBrowserRunner';

const event = (actor: Actors, state: ExecutionState, details: string) =>
  new AgentEvent(
    actor,
    state,
    {
      taskId: 'test',
      step: 0,
      maxSteps: 5,
      details,
    },
    Date.now(),
    EventType.EXECUTION,
  );

describe('executor event mapping', () => {
  it('maps planner output to plan progress', () => {
    expect(
      executorEventToProgress(
        event(Actors.PLANNER, ExecutionState.STEP_OK, '1. Open source page'),
      ),
    ).toMatchObject({
      type: 'plan.updated',
      title: 'Planner checklist updated',
      status: 'done',
    });
  });

  it('maps navigator actions to compact action progress', () => {
    expect(
      executorEventToProgress(
        event(Actors.NAVIGATOR, ExecutionState.ACT_START, 'Click Tech'),
      ),
    ).toMatchObject({
      type: 'step.started',
      title: 'Browser action',
      detail: 'Click Tech',
    });
  });

  it('maps navigator thinking to current action progress', () => {
    expect(
      executorEventToProgress(
        event(Actors.NAVIGATOR, ExecutionState.STEP_START, 'Navigating...'),
      ),
    ).toMatchObject({
      type: 'step.started',
      title: 'Navigator choosing next action',
      detail: 'Navigating...',
    });
  });

  it('maps validator success to validation progress', () => {
    expect(
      executorEventToProgress(
        event(Actors.VALIDATOR, ExecutionState.STEP_OK, 'Task completed'),
      ),
    ).toMatchObject({
      type: 'validation.completed',
      status: 'done',
    });
  });

  it('starts obvious search/news tasks on real search results', () => {
    expect(buildInitialBrowserUrl('give me the latest local news')).toBe(
      'https://www.google.com/search?q=latest%20local%20news',
    );
    expect(buildInitialBrowserUrl('open github.com')).toBe(
      'https://www.google.com/',
    );
  });
});
