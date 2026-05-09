import { classifyUserIntent } from '@shared/intentClassification';
import { Operator } from '@main/store/types';

export type InteractionMode = 'direct' | 'automation';

export type InteractionRoute = {
  mode: InteractionMode;
  operator: Operator;
  reason: string;
};

const toOperator = (firstOperator: 'browser' | 'computer') =>
  firstOperator === 'browser' ? Operator.LocalBrowser : Operator.LocalComputer;

export const classifyInteractionForInstructions = (
  instructions: string,
  fallback: Operator = Operator.LocalComputer,
): InteractionRoute => {
  if (
    fallback === Operator.RemoteBrowser ||
    fallback === Operator.RemoteComputer
  ) {
    return {
      mode: 'automation',
      operator: fallback,
      reason: 'remote operator selected',
    };
  }

  const decision = classifyUserIntent(instructions);

  if (decision.surface === 'direct') {
    return {
      mode: 'direct',
      operator: fallback,
      reason: decision.reason,
    };
  }

  return {
    mode: 'automation',
    operator: toOperator(decision.firstOperator),
    reason: decision.reason,
  };
};

export const selectOperatorForInstructions = (
  instructions: string,
  fallback: Operator = Operator.LocalComputer,
) => {
  return classifyInteractionForInstructions(instructions, fallback).operator;
};
