/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { StatusEnum } from '@neura-desktop/shared/types';
import OpenAI from 'openai';

import { logger } from '@main/logger';
import { LocalStore } from '@main/store/validate';
import { type AppState, SearchEngineForSettings } from '@main/store/types';
import { AgentOrchestrator } from './agentOrchestrator';
import { ComputerRuntimeController } from './computerRuntimeController';
import { embeddedBrowserRuntime } from './embeddedBrowserRuntime';
import { getTaskContextHint } from './taskContextMemory';

export type ResearchSource = {
  title: string;
  url: string;
  sourceName?: string;
  publishedAt?: string;
  excerpt: string;
  text: string;
};

export type SourceExtractor = {
  extractCurrentPage(): Promise<ResearchSource>;
};

export type SourceExtractorBackend = 'embedded' | 'obscura_candidate';

export type SourceExtractorBackendReport = {
  backend: SourceExtractorBackend;
  status: 'default' | 'evaluation_only';
  summary: string;
};

type RunnerArgs = {
  instructions: string;
  settings: LocalStore;
  searchEngine?: SearchEngineForSettings;
  setState: (state: AppState) => void;
  getState: () => AppState;
};

type SearchCandidate = {
  title: string;
  url: string;
  snippet: string;
  score?: number;
};

const RESEARCH_PATTERN =
  /\b(latest|current|today|recent|news|headlines|price|prices|cost|stock|score|top\s+\d+|top|best|popular|trending|compare|comparison|review|reviews|summari[sz]e|summary|research|article|sources?|verify|fact[- ]?check)\b/i;

const SIMPLE_OPEN_PATTERN = /^\s*(open|go to|visit|navigate to)\s+/i;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const isEmbeddedResearchTask = (instructions: string) => {
  const normalized = instructions.trim();
  if (!normalized || /\byoutube\b/i.test(normalized)) {
    return false;
  }
  if (
    SIMPLE_OPEN_PATTERN.test(normalized) &&
    !RESEARCH_PATTERN.test(normalized)
  ) {
    return false;
  }
  return RESEARCH_PATTERN.test(normalized);
};

const captchaLikeText = (value: string) =>
  /\b(captcha|recaptcha|hcaptcha|i'?m not a robot|human verification|unusual traffic)\b/i.test(
    value,
  );

const buildSearchUrl = (
  query: string,
  searchEngine = SearchEngineForSettings.GOOGLE,
) => {
  const encoded = encodeURIComponent(query.trim());
  switch (searchEngine) {
    case SearchEngineForSettings.BING:
      return `https://www.bing.com/search?q=${encoded}`;
    case SearchEngineForSettings.BAIDU:
      return `https://www.baidu.com/s?wd=${encoded}`;
    case SearchEngineForSettings.GOOGLE:
    default:
      return `https://www.google.com/search?q=${encoded}`;
  }
};

const normalizeResearchQuery = (instructions: string) =>
  instructions
    .replace(/^\s*please\s+/i, '')
    .replace(
      /^\s*(?:find|get|give(?:\s+me)?|show(?:\s+me)?|tell(?:\s+me)?|search(?:\s+(?:for|about))?|look\s+up|lookup|research|summari[sz]e)\s+/i,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();

export const buildResearchSearchQueries = (instructions: string) => {
  const baseQuery = normalizeResearchQuery(instructions) || instructions.trim();
  const queries: string[] = [];
  const add = (query: string) => {
    const normalized = query.replace(/\s+/g, ' ').trim();
    if (
      normalized &&
      !queries.some((item) => item.toLowerCase() === normalized.toLowerCase())
    ) {
      queries.push(normalized);
    }
  };

  add(baseQuery);
  if (
    /\b(latest|current|today|recent|news|headlines|live)\b/i.test(instructions)
  ) {
    add(`${baseQuery} latest news today`);
    add(`latest news ${baseQuery}`);
  } else if (/\b(price|prices|cost|stock)\b/i.test(instructions)) {
    add(`${baseQuery} current price`);
    add(`${baseQuery} official price`);
  } else if (
    /\b(top\s+\d+|top|best|popular|trending|compare|comparison|review|reviews)\b/i.test(
      instructions,
    )
  ) {
    add(`${baseQuery} latest ranking`);
    add(`${baseQuery} expert reviews`);
  } else {
    add(`${baseQuery} reliable sources`);
  }

  return queries.slice(0, 3);
};

const SOURCE_BLOCKED_HOST_PATTERN =
  /(^|\.)((google|bing|baidu|youtube|facebook|instagram|twitter|x|reddit|quora|pinterest|linkedin|tiktok)\.com|accounts\.google|webcache\.google|translate\.google|support\.google|policies\.google)/i;

const SEARCH_RESULT_NOISE_PATTERN =
  /\b(sign in|translate this page|cached|similar pages|people also ask|related searches|images|videos|maps|shopping)\b/i;

const ARTICLE_PATH_HINT_PATTERN =
  /\b(article|story|news|latest|live|update|updates|report|reports|explained|india|world|business|technology|sports|politics|elections?)\b|\/\d{4}[/-]\d{2}[/-]\d{2}\b/i;

const SEARCH_OR_INDEX_PATH_PATTERN =
  /\/(?:search|tag|tags|topic|topics|category|categories|archive|author|authors|video|videos|photo|photos|gallery|galleries)(?:\/|$)/i;

const sourceDomainKey = (urlValue: string) => {
  try {
    return new URL(urlValue).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
};

const isUsableSourceUrl = (urlValue: string) => {
  try {
    const url = new URL(urlValue);
    return (
      /^https?:$/i.test(url.protocol) &&
      !SOURCE_BLOCKED_HOST_PATTERN.test(url.hostname)
    );
  } catch {
    return false;
  }
};

const scoreSearchCandidate = (candidate: SearchCandidate, query: string) => {
  const haystack = `${candidate.title} ${candidate.snippet}`.toLowerCase();
  const queryTokens = query
    .toLowerCase()
    .split(/\W+/)
    .filter((token) => token.length >= 3);
  const tokenScore = queryTokens.reduce(
    (score, token) => score + (haystack.includes(token) ? 2 : 0),
    0,
  );
  const freshnessScore =
    /\b(latest|live|today|current|updated|breaking|news)\b/i.test(haystack)
      ? 5
      : 0;
  const titleScore = candidate.title.length >= 16 ? 3 : 0;
  const snippetScore = candidate.snippet.length >= 80 ? 2 : 0;
  const noisePenalty = SEARCH_RESULT_NOISE_PATTERN.test(haystack) ? 4 : 0;
  let articleScore = 0;
  try {
    const url = new URL(candidate.url);
    const pathName = url.pathname.toLowerCase();
    const pathDepth = pathName.split('/').filter(Boolean).length;
    articleScore += pathDepth >= 2 ? 2 : 0;
    articleScore += ARTICLE_PATH_HINT_PATTERN.test(pathName) ? 4 : 0;
    articleScore -= SEARCH_OR_INDEX_PATH_PATTERN.test(pathName) ? 6 : 0;
    articleScore -= url.searchParams.size > 2 ? 2 : 0;
  } catch {
    articleScore -= 4;
  }
  return (
    tokenScore +
    freshnessScore +
    titleScore +
    snippetScore +
    articleScore -
    noisePenalty
  );
};

export const rankSearchCandidates = (
  candidates: SearchCandidate[],
  query: string,
) => {
  const seenUrls = new Set<string>();
  const hostCounts = new Map<string, number>();

  return candidates
    .filter((candidate) => isUsableSourceUrl(candidate.url))
    .map((candidate) => ({
      ...candidate,
      score: scoreSearchCandidate(candidate, query),
    }))
    .filter((candidate) => candidate.score >= 2)
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .filter((candidate) => {
      const url = new URL(candidate.url);
      const normalizedUrl = `${url.origin}${url.pathname}`.replace(/\/$/, '');
      const host = sourceDomainKey(candidate.url);
      const hostCount = hostCounts.get(host) || 0;
      if (seenUrls.has(normalizedUrl) || hostCount >= 1) {
        return false;
      }
      seenUrls.add(normalizedUrl);
      hostCounts.set(host, hostCount + 1);
      return true;
    })
    .slice(0, 10);
};

const waitForPageReady = async (timeoutMs = 18_000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const ready = await embeddedBrowserRuntime
      .executeJavaScript<string>('document.readyState')
      .catch(() => 'loading');
    if (ready === 'interactive' || ready === 'complete') {
      const textLength = await embeddedBrowserRuntime
        .executeJavaScript<number>(
          "(document.body?.innerText || '').trim().length",
        )
        .catch(() => 0);
      if (textLength > 50) {
        break;
      }
    }
    await delay(300);
  }
  await delay(700);
};

const extractSearchCandidates = async () =>
  embeddedBrowserRuntime.executeJavaScript<SearchCandidate[]>(`
    (() => {
      const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const decodeHref = (href) => {
        try {
          const url = new URL(href);
          const direct = url.searchParams.get('q') || url.searchParams.get('url') || url.searchParams.get('u');
          if ((url.hostname.includes('google.') || url.hostname.includes('bing.') || url.hostname.includes('baidu.')) && direct && /^https?:/i.test(direct)) {
            return direct;
          }
        } catch {
          return href;
        }
        return href;
      };
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      const candidates = [];
      for (const anchor of anchors) {
        const title = clean(anchor.querySelector('h1,h2,h3,[role="heading"]')?.textContent || anchor.textContent);
        const url = decodeHref(anchor.href || '');
        if (!title || title.length < 8 || !/^https?:/i.test(url)) continue;
        const container = anchor.closest('article,li,[data-sokoban-container],div');
        const snippet = clean(container?.textContent || '').slice(0, 420);
        if (candidates.some((item) => item.url === url || item.title === title)) continue;
        candidates.push({ title, url, snippet });
        if (candidates.length >= 24) break;
      }
      return candidates;
    })();
  `);

export class EmbeddedBrowserSourceExtractor implements SourceExtractor {
  async extractCurrentPage() {
    return embeddedBrowserRuntime.executeJavaScript<ResearchSource>(`
      (() => {
        const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
        const meta = (selector) => document.querySelector(selector)?.getAttribute('content') || '';
        const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
          .map((script) => {
            try { return JSON.parse(script.textContent || '{}'); } catch { return null; }
          })
          .flatMap((item) => Array.isArray(item) ? item : [item])
          .find((item) => item && /NewsArticle|Article|BlogPosting/i.test(String(item['@type'] || '')));
        const title =
          clean(jsonLd?.headline) ||
          clean(meta('meta[property="og:title"]')) ||
          clean(document.querySelector('h1')?.textContent) ||
          clean(document.title);
        const sourceName =
          clean(jsonLd?.publisher?.name) ||
          clean(meta('meta[property="og:site_name"]')) ||
          clean(document.querySelector('meta[name="application-name"]')?.getAttribute('content')) ||
          location.hostname.replace(/^www\\./, '');
        const publishedAt =
          clean(jsonLd?.datePublished) ||
          clean(jsonLd?.dateModified) ||
          clean(meta('meta[property="article:published_time"]')) ||
          clean(meta('meta[name="date"]')) ||
          clean(meta('meta[name="pubdate"]')) ||
          clean(document.querySelector('time[datetime]')?.getAttribute('datetime')) ||
          clean(document.querySelector('time')?.textContent);
        document.querySelectorAll('script,style,noscript,svg,nav,header,footer,aside,form,button,[aria-hidden="true"]').forEach((node) => node.remove());
        const root =
          document.querySelector('article') ||
          document.querySelector('main') ||
          document.querySelector('[role="main"]') ||
          document.body;
        const blocks = Array.from(root.querySelectorAll('h1,h2,h3,p,li'))
          .map((node) => clean(node.textContent))
          .filter((line) => line.length >= 35)
          .filter((line, index, lines) => lines.indexOf(line) === index);
        const articleBody = Array.isArray(jsonLd?.articleBody) ? jsonLd.articleBody.join('\\n\\n') : clean(jsonLd?.articleBody);
        const text = articleBody || blocks.join('\\n\\n') || clean(document.body?.innerText || '');
        return {
          title,
          url: location.href,
          sourceName,
          publishedAt,
          excerpt: text.slice(0, 700),
          text: text.slice(0, 14000),
        };
      })();
    `);
  }
}

export const getSourceExtractorBackendReports = (): SourceExtractorBackendReport[] => [
  {
    backend: 'embedded',
    status: 'default',
    summary:
      'Default extractor uses Neura’s in-app embedded browser DOM and readable page text.',
  },
  {
    backend: 'obscura_candidate',
    status: 'evaluation_only',
    summary:
      'Obscura remains an optional future adapter behind SourceExtractor and is not enabled in runtime.',
  },
];

export const createSourceExtractor = (
  backend: SourceExtractorBackend = 'embedded',
): SourceExtractor => {
  if (backend !== 'embedded') {
    logger.info(
      '[embeddedBrowserResearchTask] unsupported source extractor backend requested, falling back to embedded',
      backend,
    );
  }
  return new EmbeddedBrowserSourceExtractor();
};

const decodeHtmlEntities = (value: string) =>
  value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const named: Record<string, string> = {
      amp: '&',
      apos: "'",
      gt: '>',
      lt: '<',
      nbsp: ' ',
      quot: '"',
    };
    const lower = String(entity).toLowerCase();
    if (lower in named) {
      return named[lower];
    }
    if (lower.startsWith('#x')) {
      const codePoint = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(codePoint)
        ? String.fromCodePoint(codePoint)
        : match;
    }
    if (lower.startsWith('#')) {
      const codePoint = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(codePoint)
        ? String.fromCodePoint(codePoint)
        : match;
    }
    return match;
  });

const firstMatch = (html: string, pattern: RegExp) => {
  const match = html.match(pattern);
  return match?.[1]
    ? decodeHtmlEntities(match[1]).replace(/\s+/g, ' ').trim()
    : '';
};

const htmlToText = (html: string) => {
  const body =
    html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ||
    html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ||
    html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ||
    html;
  return decodeHtmlEntities(
    body
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<\/(p|div|li|h[1-6]|section|article|br)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s+/g, '\n')
      .replace(/\n{3,}/g, '\n\n'),
  ).trim();
};

export const extractSourceFromHtml = (
  html: string,
  urlValue: string,
): ResearchSource => {
  const url = new URL(urlValue);
  const title =
    firstMatch(
      html,
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    ) ||
    firstMatch(
      html,
      /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,
    ) ||
    firstMatch(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i).replace(/<[^>]+>/g, ' ') ||
    firstMatch(html, /<title\b[^>]*>([\s\S]*?)<\/title>/i) ||
    url.hostname.replace(/^www\./, '');
  const sourceName =
    firstMatch(
      html,
      /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i,
    ) || url.hostname.replace(/^www\./, '');
  const publishedAt =
    firstMatch(
      html,
      /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    ) ||
    firstMatch(
      html,
      /<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)["']/i,
    ) ||
    firstMatch(html, /<time[^>]+datetime=["']([^"']+)["']/i) ||
    firstMatch(html, /"datePublished"\s*:\s*"([^"]+)"/i) ||
    firstMatch(html, /"dateModified"\s*:\s*"([^"]+)"/i);
  const text = htmlToText(html);

  return {
    title,
    url: urlValue,
    sourceName,
    publishedAt,
    excerpt: text.slice(0, 700),
    text: text.slice(0, 14000),
  };
};

const fetchSourcePage = async (urlValue: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(urlValue, {
      headers: {
        accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || (contentType && !/html|text/i.test(contentType))) {
      return null;
    }
    const html = await response.text();
    if (!html.trim()) {
      return null;
    }
    return extractSourceFromHtml(html, response.url || urlValue);
  } finally {
    clearTimeout(timeout);
  }
};

const sourceHasUsefulText = (source: ResearchSource) =>
  source.title.length >= 4 &&
  /^https?:/i.test(source.url) &&
  source.text.replace(/\s+/g, ' ').trim().length >= 300 &&
  !captchaLikeText(source.text);

const addResearchSource = (
  sources: ResearchSource[],
  seenDomains: Set<string>,
  source: ResearchSource | null,
) => {
  if (!source || !sourceHasUsefulText(source)) {
    return false;
  }

  const domain = sourceDomainKey(source.url);
  if (!domain || seenDomains.has(domain)) {
    return false;
  }

  seenDomains.add(domain);
  sources.push(source);
  return true;
};

const getResearchModelConfig = (settings: LocalStore) => {
  const baseURL = settings.plannerBaseUrl || settings.vlmBaseUrl;
  const apiKey = settings.plannerApiKey || settings.vlmApiKey;
  const model =
    settings.usePlannerModel !== false && settings.plannerModelName
      ? settings.plannerModelName
      : settings.vlmModelName;

  if (!baseURL || !apiKey || !model) {
    return null;
  }
  return {
    baseURL,
    apiKey,
    model,
    timeout: settings.plannerTimeoutInMs || 90_000,
  };
};

const sourceDigest = (source: ResearchSource, index: number) =>
  [
    `SOURCE ${index + 1}`,
    `Title: ${source.title}`,
    `URL: ${source.url}`,
    source.sourceName ? `Source: ${source.sourceName}` : '',
    source.publishedAt ? `Date: ${source.publishedAt}` : '',
    `Text:\n${source.text.slice(0, 4500)}`,
  ]
    .filter(Boolean)
    .join('\n');

const deterministicSynthesis = (
  instructions: string,
  sources: ResearchSource[],
) => {
  const items = sources.slice(0, 4).map((source, index) => {
    const detail = source.excerpt
      .replace(/\s+/g, ' ')
      .replace(source.title, '')
      .trim()
      .slice(0, 520);
    const date = source.publishedAt ? `, ${source.publishedAt}` : '';
    return `${index + 1}. **${source.title}** (${source.sourceName || new URL(source.url).hostname}${date}): ${detail}`;
  });
  return [
    `Here is a source-backed summary for "${instructions}":`,
    '',
    ...items,
    '',
    'Sources:',
    ...sources.map(
      (source) => `- ${source.sourceName || source.title}: ${source.url}`,
    ),
  ].join('\n');
};

const synthesizeSources = async (
  instructions: string,
  settings: LocalStore,
  sources: ResearchSource[],
  taskContextHint = '',
) => {
  const config = getResearchModelConfig(settings);
  if (!config) {
    return deterministicSynthesis(instructions, sources);
  }

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
  const completion = await client.chat.completions.create(
    {
      model: config.model,
      temperature: 0.2,
      stream: false,
      messages: [
        {
          role: 'system',
          content:
            'You synthesize browser research for Neura. Use only the provided source texts. Do not fabricate facts. Return a concise Markdown answer with concrete facts and a Sources section containing the used URLs.',
        },
        {
          role: 'user',
          content: [
            `User task: ${instructions}`,
            taskContextHint.trim(),
            'Write the final answer from these sources. Prefer current dates, names, prices, and direct facts. If sources disagree, say so.',
            sources.map(sourceDigest).join('\n\n---\n\n'),
          ].join('\n\n'),
        },
      ],
    },
    { timeout: config.timeout },
  );
  const content = completion.choices?.[0]?.message?.content?.trim();
  return content || deterministicSynthesis(instructions, sources);
};

export const ensureSourcesSection = (
  answer: string,
  sources: ResearchSource[],
) => {
  const normalized = answer.trim();
  const missingSources = sources.filter(
    (source) => !normalized.includes(source.url),
  );
  if (/^sources?:/im.test(normalized) && missingSources.length === 0) {
    return normalized;
  }

  return [
    normalized,
    '',
    'Sources:',
    ...missingSources.map(
      (source) => `- ${source.sourceName || source.title}: ${source.url}`,
    ),
  ]
    .filter((line, index, lines) => line || lines[index - 1])
    .join('\n');
};

export const validateResearchAnswer = (
  answer: string,
  sources: ResearchSource[],
) => {
  const normalized = answer.trim();
  if (sources.length < 2) {
    throw new Error(
      'Research needs at least two readable source pages before finishing.',
    );
  }
  if (
    !normalized ||
    /\bTop visible results\b/i.test(normalized) ||
    /\b(Translate this page|cached|similar pages)\b/i.test(normalized) ||
    /(?:[^\s)]https?:\/\/|Read more\s+-\s+\d+\s+hours ago)/i.test(normalized) ||
    normalized.length < 220
  ) {
    throw new Error(
      'Research answer is too shallow; it must synthesize facts from opened source pages.',
    );
  }
};

export async function runEmbeddedBrowserResearchTask({
  instructions,
  settings,
  searchEngine,
  setState,
  getState,
}: RunnerArgs) {
  const query = normalizeResearchQuery(instructions) || instructions.trim();
  const searchQueries = buildResearchSearchQueries(instructions);
  const orchestrator = new AgentOrchestrator({ getState, setState });
  const extractor = createSourceExtractor();

  orchestrator.begin(instructions, 'gui_browser');
  ComputerRuntimeController.start({
    mode: 'browser',
    subtitle: 'Browser',
    display: 'Browser research',
    activity: 'Planning research',
  });
  orchestrator.emit({
    type: 'plan.updated',
    title: 'Planning research',
    detail:
      'Search for relevant sources, open multiple credible pages, extract readable text, synthesize, then validate.',
    status: 'in_progress',
  });
  embeddedBrowserRuntime.ensure();
  void embeddedBrowserRuntime.setInteractionBlocked(true);
  setState({
    ...getState(),
    status: StatusEnum.RUNNING,
    thinking: true,
  });

  try {
    orchestrator.emit({
      type: 'step.started',
      title: 'Searching',
      detail: searchQueries.join('\n'),
      status: 'in_progress',
    });
    const searchEngines = [
      searchEngine || SearchEngineForSettings.GOOGLE,
      SearchEngineForSettings.BING,
    ].filter((engine, index, engines) => engines.indexOf(engine) === index);
    let candidates: SearchCandidate[] = [];
    let activeSearchUrl = '';
    for (const searchQuery of searchQueries) {
      for (const engine of searchEngines) {
        activeSearchUrl = buildSearchUrl(searchQuery, engine);
        await embeddedBrowserRuntime.navigate(activeSearchUrl);
        await waitForPageReady();
        orchestrator.addSource(activeSearchUrl);
        orchestrator.emit({
          type: 'step.completed',
          title: 'Search opened',
          detail:
            embeddedBrowserRuntime.webContents?.getURL() || activeSearchUrl,
          status: 'done',
        });

        const visibleText = await embeddedBrowserRuntime
          .executeJavaScript<string>("document.body?.innerText || ''")
          .catch(() => '');
        if (captchaLikeText(visibleText)) {
          continue;
        }

        candidates = rankSearchCandidates(
          [...candidates, ...(await extractSearchCandidates())],
          `${query} ${searchQuery}`,
        );
        if (candidates.length >= 4) {
          break;
        }
      }
      if (candidates.length >= 4) {
        break;
      }
    }

    if (!candidates.length) {
      throw new Error('No usable source links were found on the search page.');
    }
    orchestrator.emit({
      type: 'step.completed',
      title: 'Selected sources',
      detail: candidates
        .slice(0, 4)
        .map((candidate, index) => `${index + 1}. ${candidate.title}`)
        .join('\n'),
      status: 'done',
    });

    const sources: ResearchSource[] = [];
    const sourceDomains = new Set<string>();
    for (const candidate of candidates.slice(0, 10)) {
      if (sources.length >= 4) {
        break;
      }
      try {
        orchestrator.emit({
          type: 'step.started',
          title: 'Opening source',
          detail: candidate.title,
          status: 'in_progress',
        });
        await embeddedBrowserRuntime.navigate(candidate.url);
        await waitForPageReady();
        let source: ResearchSource | null =
          await extractor.extractCurrentPage();
        if (!sourceHasUsefulText(source)) {
          source = await fetchSourcePage(candidate.url).catch((error) => {
            logger.warn(
              '[embeddedBrowserResearchTask] source fetch fallback skipped',
              error,
            );
            return null;
          });
        }
        if (!addResearchSource(sources, sourceDomains, source)) {
          continue;
        }
        const acceptedSource = sources[sources.length - 1];
        orchestrator.addSource(acceptedSource.url);
        orchestrator.addFact(
          `${acceptedSource.title}: ${acceptedSource.excerpt.slice(0, 240)}`,
        );
        orchestrator.emit({
          type: 'step.completed',
          title: 'Extracted source',
          detail: `${acceptedSource.title}\n${acceptedSource.url}`,
          status: 'done',
        });
      } catch (error) {
        logger.warn(
          '[embeddedBrowserResearchTask] source extraction skipped',
          error,
        );
        const source = await fetchSourcePage(candidate.url).catch(
          (fetchError) => {
            logger.warn(
              '[embeddedBrowserResearchTask] source fetch after navigation failure skipped',
              fetchError,
            );
            return null;
          },
        );
        if (addResearchSource(sources, sourceDomains, source)) {
          const acceptedSource = sources[sources.length - 1];
          orchestrator.addSource(acceptedSource.url);
          orchestrator.addFact(
            `${acceptedSource.title}: ${acceptedSource.excerpt.slice(0, 240)}`,
          );
          orchestrator.emit({
            type: 'step.completed',
            title: 'Fetched source',
            detail: `${acceptedSource.title}\n${acceptedSource.url}`,
            status: 'done',
          });
        }
      }
    }

    if (sources.length < 2) {
      throw new Error(
        `Only ${sources.length} readable source page(s) could be extracted. Try a narrower query or use Take over if a site blocks access.`,
      );
    }

    orchestrator.emit({
      type: 'step.started',
      title: 'Synthesizing answer',
      detail: `Using ${sources.length} sources.`,
      status: 'in_progress',
    });
    const taskContextHint = getTaskContextHint(getState().taskState ?? undefined);
    const finalAnswer = ensureSourcesSection(
      await synthesizeSources(instructions, settings, sources, taskContextHint),
      sources,
    );
    validateResearchAnswer(finalAnswer, sources);

    orchestrator.setCompletionProof({
      kind: 'source',
      summary: `Synthesized answer from ${sources.length} opened source pages.`,
      evidence: sources.map((source) => `${source.title} - ${source.url}`),
      verifiedAt: Date.now(),
    });
    orchestrator.emit({
      type: 'validation.completed',
      title: 'Research verified',
      detail: `Validated ${sources.length} source-backed pages.`,
      status: 'done',
    });
    orchestrator.complete(finalAnswer);
    ComputerRuntimeController.complete('Research completed');
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('[embeddedBrowserResearchTask] failed', message);
    orchestrator.fail(message);
    ComputerRuntimeController.fail(message);
    return true;
  }
}
