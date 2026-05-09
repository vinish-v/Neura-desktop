import { describe, expect, it } from 'vitest';

import {
  isSearchResultsUrl,
  validateBrowserCompletion,
  validateCompletionProof,
} from './completionValidation';

describe('browser completion validation', () => {
  it('detects common search result urls', () => {
    expect(isSearchResultsUrl('https://www.google.com/search?q=ai')).toBe(true);
    expect(isSearchResultsUrl('https://www.bing.com/search?q=ai')).toBe(true);
    expect(isSearchResultsUrl('https://example.com/article')).toBe(false);
  });

  it('rejects finishing research tasks from a search results page', () => {
    expect(
      validateBrowserCompletion({
        originalGoal: 'latest AI news and summarize the top article',
        currentUrl: 'https://www.google.com/search?q=latest+AI+news',
        answerText: 'Here are snippets from Google.',
      }),
    ).toMatchObject({
      isValid: false,
      shouldReplan: true,
    });
  });

  it('allows source article completion when answer content is present', () => {
    expect(
      validateBrowserCompletion({
        originalGoal: 'latest AI news and summarize the top article',
        currentUrl: 'https://example.com/technology/ai-news',
        answerText:
          'The article says the company released a new model today and gives context from the source page.',
      }),
    ).toMatchObject({
      isValid: true,
      shouldReplan: false,
    });
  });

  it('triggers replanning when browser state repeats', () => {
    expect(
      validateBrowserCompletion({
        originalGoal: 'find latest tech news',
        repeatedStateCount: 3,
      }),
    ).toMatchObject({
      isValid: false,
      shouldReplan: true,
    });
  });

  it('requires evidence for research-style browser completion proof', () => {
    expect(
      validateCompletionProof({
        originalGoal: 'research latest AI news',
        runMode: 'gui_browser',
        currentUrl: 'https://example.com/article',
        answerText:
          'This answer has enough substance but no source evidence attached.',
        evidence: [],
      }),
    ).toMatchObject({
      isValid: false,
      shouldReplan: true,
    });
  });

  it('accepts artifact workflow completion when artifacts exist', () => {
    expect(
      validateCompletionProof({
        originalGoal: 'create a deck',
        runMode: 'artifact_workflow',
        artifactCount: 2,
      }),
    ).toMatchObject({
      isValid: true,
      shouldReplan: false,
    });
  });
});
