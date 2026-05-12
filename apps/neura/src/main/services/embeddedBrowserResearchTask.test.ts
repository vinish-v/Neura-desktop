import { describe, expect, it } from 'vitest';

import {
  buildResearchSearchQueries,
  createSourceExtractor,
  ensureSourcesSection,
  extractSourceFromHtml,
  getSourceExtractorBackendReports,
  isEmbeddedResearchTask,
  rankSearchCandidates,
  validateResearchAnswer,
} from './embeddedBrowserResearchTask';

describe('embeddedBrowserResearchTask routing', () => {
  it('routes current-info and research requests to the research runner', () => {
    expect(isEmbeddedResearchTask('find the latest TN news')).toBe(true);
    expect(
      isEmbeddedResearchTask('give me current iPhone price in India'),
    ).toBe(true);
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
          title: 'Tamil Nadu topic index',
          url: 'https://example-news.test/topic/tamil-nadu',
          snippet:
            'Latest Tamil Nadu news today category page with many links and related searches.',
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

  it('dedupes sources by domain and prefers article-like pages over index pages', () => {
    const ranked = rankSearchCandidates(
      [
        {
          title: 'Tamil Nadu news category',
          url: 'https://daily-source.test/topic/tamil-nadu',
          snippet:
            'Latest Tamil Nadu news today category page with related searches and topic links.',
        },
        {
          title: 'Tamil Nadu chief minister signs first orders today',
          url: 'https://daily-source.test/news/india/tamil-nadu-chief-minister-first-orders-2026-05-12',
          snippet:
            'Updated report on Tamil Nadu political developments, first executive orders, current context, and reactions today.',
        },
        {
          title: 'Tamil Nadu weather and local updates',
          url: 'https://regional-source.test/story/tamil-nadu-weather-local-updates',
          snippet:
            'Current local Tamil Nadu updates today from a regional newsroom with verified details.',
        },
      ],
      'latest Tamil Nadu news today',
    );

    const rankedUrls = ranked.map((candidate) => candidate.url);
    expect(rankedUrls).toContain(
      'https://daily-source.test/news/india/tamil-nadu-chief-minister-first-orders-2026-05-12',
    );
    expect(rankedUrls).toContain(
      'https://regional-source.test/story/tamil-nadu-weather-local-updates',
    );
    expect(rankedUrls).not.toContain(
      'https://daily-source.test/topic/tamil-nadu',
    );
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

  it('keeps the embedded extractor as the runtime default while exposing evaluation-only backends', () => {
    const reports = getSourceExtractorBackendReports();

    expect(reports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          backend: 'embedded',
          status: 'default',
        }),
        expect.objectContaining({
          backend: 'obscura_candidate',
          status: 'evaluation_only',
        }),
      ]),
    );
    expect(createSourceExtractor()).toBeDefined();
    expect(createSourceExtractor('obscura_candidate')).toBeDefined();
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

  it('rejects shallow visible-results answers for research tasks', () => {
    expect(() =>
      validateResearchAnswer('Top visible results for latest TN news', [
        {
          title: 'Source one',
          url: 'https://source-one.test/article',
          sourceName: 'Source One',
          excerpt: 'excerpt',
          text: 'body text '.repeat(100),
        },
        {
          title: 'Source two',
          url: 'https://source-two.test/article',
          sourceName: 'Source Two',
          excerpt: 'excerpt',
          text: 'body text '.repeat(100),
        },
      ]),
    ).toThrowError(
      'Research answer is too shallow; it must synthesize facts from opened source pages.',
    );
  });
});
