/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */

export type BrowserCompletionValidationInput = {
  originalGoal: string;
  currentUrl?: string;
  answerText?: string;
  repeatedStateCount?: number;
};

export type BrowserCompletionValidationResult = {
  isValid: boolean;
  reason: string;
  shouldReplan: boolean;
};

export type CompletionProofValidationInput = {
  originalGoal: string;
  runMode?: string;
  currentUrl?: string;
  answerText?: string;
  evidence?: string[];
  artifactCount?: number;
};

const sourceDepthPattern =
  /\b(latest|news|research|summari[sz]e|article|source|source-backed|top result|official|verify|details?|compare|review|ranking|ranked|who|what|where|when|why|how|explain|find|search)\b/i;

const strictSourceDepthPattern =
  /\b(research|summari[sz]e|article|source|source-backed|top result|official|verify|details?|compare|review|ranking|ranked|explain|extract)\b/i;

const compactFactualLookupPattern =
  /\b(price|prices|cost|weather|forecast|score|scores|stock|stocks|crypto|rate|rates|temperature)\b/i;

const compactFactualAnswerPattern = /(?:\p{Sc}|\b\d+(?:[.,]\d+)*%?\b)/u;

export function needsSourceDepth(goal: string) {
  return sourceDepthPattern.test(goal);
}

export function requiresSourcePage(goal: string) {
  return strictSourceDepthPattern.test(goal);
}

function isCompactFactualLookup(goal: string) {
  return (
    compactFactualLookupPattern.test(goal) &&
    !strictSourceDepthPattern.test(goal)
  );
}

function hasCompactFactualAnswer(answerText = '') {
  const answer = answerText.trim();
  return (
    answer.length > 0 &&
    answer.length <= 120 &&
    compactFactualAnswerPattern.test(answer)
  );
}

export function isSearchResultsUrl(url = '') {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const path = parsed.pathname.toLowerCase();

    return (
      (host === 'google.com' && path === '/search') ||
      (host.endsWith('.google.com') && path === '/search') ||
      (host === 'bing.com' && path === '/search') ||
      (host === 'duckduckgo.com' && path === '/') ||
      (host === 'search.yahoo.com' && path.startsWith('/search'))
    );
  } catch {
    return /\b(google|bing|duckduckgo|yahoo)\.[^/]+\/search\b/i.test(url);
  }
}

export function validateBrowserCompletion({
  originalGoal,
  currentUrl,
  answerText,
  repeatedStateCount = 0,
}: BrowserCompletionValidationInput): BrowserCompletionValidationResult {
  if (repeatedStateCount >= 3) {
    return {
      isValid: false,
      reason:
        'The browser is repeating the same page/action and should replan.',
      shouldReplan: true,
    };
  }

  if (
    requiresSourcePage(originalGoal) &&
    currentUrl &&
    isSearchResultsUrl(currentUrl)
  ) {
    return {
      isValid: false,
      reason:
        'Research-style tasks must open a source page instead of finishing on a search results page.',
      shouldReplan: true,
    };
  }

  if (
    isCompactFactualLookup(originalGoal) &&
    hasCompactFactualAnswer(answerText)
  ) {
    return {
      isValid: true,
      reason: 'The final answer contains the requested factual value.',
      shouldReplan: false,
    };
  }

  if (answerText && answerText.trim().length >= 24) {
    return {
      isValid: true,
      reason: 'The final answer contains useful extracted content.',
      shouldReplan: false,
    };
  }

  return {
    isValid: !needsSourceDepth(originalGoal),
    reason: needsSourceDepth(originalGoal)
      ? 'The answer is too shallow for a research-style task.'
      : 'The task can finish without source-depth validation.',
    shouldReplan: needsSourceDepth(originalGoal),
  };
}

export function validateCompletionProof({
  originalGoal,
  runMode,
  currentUrl,
  answerText,
  evidence = [],
  artifactCount = 0,
}: CompletionProofValidationInput): BrowserCompletionValidationResult {
  if (
    runMode === 'wide_research' ||
    runMode === 'artifact_workflow' ||
    runMode === 'website_builder' ||
    runMode === 'multimodal_workflow'
  ) {
    if (artifactCount > 0) {
      return {
        isValid: true,
        reason: 'The task produced one or more artifacts as completion proof.',
        shouldReplan: false,
      };
    }
    return {
      isValid: false,
      reason: 'Artifact workflow cannot complete without generated artifacts.',
      shouldReplan: false,
    };
  }

  if (runMode === 'executor_browser' || runMode === 'gui_browser') {
    const browserValidation = validateBrowserCompletion({
      originalGoal,
      currentUrl,
      answerText,
    });
    if (!browserValidation.isValid) {
      return browserValidation;
    }

    if (needsSourceDepth(originalGoal) && evidence.length === 0) {
      return {
        isValid: false,
        reason: 'Research-style browser tasks need source evidence.',
        shouldReplan: true,
      };
    }

    return browserValidation;
  }

  if (runMode === 'gui_computer' && !answerText && evidence.length === 0) {
    return {
      isValid: false,
      reason: 'Local computer task ended without action or artifact evidence.',
      shouldReplan: false,
    };
  }

  return {
    isValid: true,
    reason: 'Completion proof requirements satisfied for this run mode.',
    shouldReplan: false,
  };
}

export type ComputerCompletionValidationInput = {
  originalGoal: string;
  recentActionNames: string[];
  answerText?: string;
};

export type ComputerCompletionValidationResult = {
  isValid: boolean;
  reason: string;
  shouldReplan: boolean;
};

export function validateComputerCompletion({
  originalGoal,
  recentActionNames,
}: ComputerCompletionValidationInput): ComputerCompletionValidationResult {
  const goalLower = originalGoal.toLowerCase();
  const requiresFileCreation =
    /\b(create|save|write|export|download|make)\b/i.test(goalLower) &&
    /\b(file|document|docx|pdf|xlsx|txt|csv|image|presentation|report)\b/i.test(
      goalLower,
    );

  if (requiresFileCreation) {
    const hasWriteAction = recentActionNames.some(
      (action) =>
        ['type', 'hotkey', 'click', 'run_command'].includes(action) ||
        action.includes('save') ||
        action.includes('write'),
    );

    if (!hasWriteAction) {
      return {
        isValid: false,
        reason:
          'The task requires creating or modifying a file, but no sufficient actions (like typing, saving, or running commands) were taken. Please execute the actual file creation/modification.',
        shouldReplan: true,
      };
    }
  }

  return {
    isValid: true,
    reason: 'The computer task execution looks valid.',
    shouldReplan: false,
  };
}
