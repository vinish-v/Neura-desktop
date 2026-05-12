import { describe, expect, it } from 'vitest';

import {
  buildResearchSearchQueries,
  ensureSourcesSection,
  extractSourceFromHtml,
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

  it('expands current-info research queries without changing simple browser routing', () => {
    expect(buildResearchSearchQueries('find the latest TN news')).toEqual([
      'the latest TN news',
      'the latest TN news latest news today',
      'latest news the latest TN news',
    ]);
  });

  it('extracts readable source data from article HTML', () => {
    const source = extractSourceFromHtml(
      `
        <html>
          <head>
            <title>Fallback title</title>
            <meta property="og:title" content="Tamil Nadu update">
            <meta property="og:site_name" content="Example News">
            <meta property="article:published_time" content="2026-05-12T10:00:00+05:30">
          </head>
          <body>
            <article>
              <h1>Tamil Nadu update</h1>
              <p>${'This is a real paragraph about Tamil Nadu public affairs. '.repeat(8)}</p>
              <p>${'This second paragraph adds enough article body text for extraction. '.repeat(8)}</p>
            </article>
          </body>
        </html>
      `,
      'https://example-news.test/story',
    );

    expect(source.title).toBe('Tamil Nadu update');
    expect(source.sourceName).toBe('Example News');
    expect(source.publishedAt).toBe('2026-05-12T10:00:00+05:30');
    expect(source.text.length).toBeGreaterThan(300);
  });

  it('adds source URLs when the synthesizer omits them', () => {
    const answer = ensureSourcesSection(
      'Tamil Nadu has several current updates from the checked reports.',
      [
        {
          title: 'Report one',
          url: 'https://source-one.test/report',
          sourceName: 'Source One',
          excerpt: 'excerpt',
          text: 'body',
        },
        {
          title: 'Report two',
          url: 'https://source-two.test/report',
          sourceName: 'Source Two',
          excerpt: 'excerpt',
          text: 'body',
        },
      ],
    );

    expect(answer).toContain('Sources:');
    expect(answer).toContain('https://source-one.test/report');
    expect(answer).toContain('https://source-two.test/report');
  });
});
