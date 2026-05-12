import { describe, expect, it } from 'vitest';

import {
  isEmbeddedResearchTask,
  rankSearchCandidates,
} from './embeddedBrowserResearchTask';

describe('embeddedBrowserResearchTask routing', () => {
  it('routes current-info and research requests to the research runner', () => {
    expect(isEmbeddedResearchTask('find the latest TN news')).toBe(true);
    expect(isEmbeddedResearchTask('give me current iPhone price in India')).toBe(
      true,
    );
    expect(isEmbeddedResearchTask('compare the top 10 games this month')).toBe(
      true,
    );
  });

  it('keeps simple open and YouTube tasks on the quick browser path', () => {
    expect(isEmbeddedResearchTask('open youtube and play a song')).toBe(false);
    expect(isEmbeddedResearchTask('open example.com')).toBe(false);
    expect(isEmbeddedResearchTask('search about india')).toBe(false);
  });

  it('keeps source candidates and filters search/social/video noise', () => {
    const ranked = rankSearchCandidates(
      [
        {
          title: 'Google result shell',
          url: 'https://www.google.com/search?q=latest+tn+news',
          snippet: 'latest tn news',
        },
        {
          title: 'Latest Tamil Nadu News Today',
          url: 'https://example-news.test/tamil-nadu/latest-news',
          snippet:
            'Breaking latest Tamil Nadu news today with updated political and local developments.',
        },
        {
          title: 'YouTube video result',
          url: 'https://www.youtube.com/watch?v=abc',
          snippet: 'latest Tamil Nadu news video',
        },
        {
          title: 'Current TN headlines and live updates',
          url: 'https://another-source.test/news/tn-live',
          snippet:
            'Current Tamil Nadu headlines, live updates, today news and verified local developments.',
        },
      ],
      'latest TN news',
    );

    expect(ranked.map((candidate) => candidate.url)).toEqual([
      'https://example-news.test/tamil-nadu/latest-news',
      'https://another-source.test/news/tn-live',
    ]);
  });
});
