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
  if (SIMPLE_OPEN_PATTERN.test(normalized) && !RESEARCH_PATTERN.test(normalized)) {
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

const SOURCE_BLOCKED_HOST_PATTERN =
  /(^|\.)((google|bing|baidu|youtube|facebook|instagram|twitter|x|reddit|quora|pinterest|linkedin|tiktok)\.com|accounts\.google|webcache\.google|translate\.google|support\.google|policies\.google)/i;

const SEARCH_RESULT_NOISE_PATTERN =
  /\b(sign in|translate this page|cached|similar pages|people also ask|related searches|images|videos|maps|shopping)\b/i;

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
  const freshnessScore = /\b(latest|live|today|current|updated|breaking|news)\b/i.test(
    haystack,
  )
    ? 5
    : 0;
  const titleScore = candidate.title.length >= 16 ? 3 : 0;
  const snippetScore = candidate.snippet.length >= 80 ? 2 : 0;
  const noisePenalty = SEARCH_RESULT_NOISE_PATTERN.test(haystack) ? 4 : 0;
  return tokenScore + freshnessScore + titleScore + snippetScore - noisePenalty;
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
      const host = url.hostname.replace(/^www\./, '');
      const hostCount = hostCounts.get(host) || 0;
      if (seenUrls.has(normalizedUrl) || hostCount >= 2) {
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

const sourceHasUsefulText = (source: ResearchSource) =>
  source.title.length >= 4 &&
  /^https?:/i.test(source.url) &&
  source.text.replace(/\s+/g, ' ').trim().length >= 300 &&
  !captchaLikeText(source.text);

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
      (source) =>
        `- ${source.sourceName || source.title}: ${source.url}`,
    ),
  ].join('\n');
};

const synthesizeSources = async (
  instructions: string,
  settings: LocalStore,
  sources: ResearchSource[],
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

const validateResearchAnswer = (
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
    /^Top visible results\b/i.test(normalized) ||
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
  const orchestrator = new AgentOrchestrator({ getState, setState });
  const extractor = new EmbeddedBrowserSourceExtractor();

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
      detail: query,
      status: 'in_progress',
    });
    const searchEngines = [
      searchEngine || SearchEngineForSettings.GOOGLE,
      SearchEngineForSettings.BING,
    ].filter(
      (engine, index, engines) => engines.indexOf(engine) === index,
    );
    let candidates: SearchCandidate[] = [];
    let activeSearchUrl = '';
    for (const engine of searchEngines) {
      activeSearchUrl = buildSearchUrl(query, engine);
      await embeddedBrowserRuntime.navigate(activeSearchUrl);
      await waitForPageReady();
      orchestrator.addSource(activeSearchUrl);
      orchestrator.emit({
        type: 'step.completed',
        title: 'Search opened',
        detail: embeddedBrowserRuntime.webContents?.getURL() || activeSearchUrl,
        status: 'done',
      });

      const visibleText = await embeddedBrowserRuntime
        .executeJavaScript<string>("document.body?.innerText || ''")
        .catch(() => '');
      if (captchaLikeText(visibleText)) {
        continue;
      }

      candidates = rankSearchCandidates(await extractSearchCandidates(), query);
      if (candidates.length >= 2) {
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
    for (const candidate of candidates.slice(0, 6)) {
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
        const source = await extractor.extractCurrentPage();
        if (!sourceHasUsefulText(source)) {
          continue;
        }
        sources.push(source);
        orchestrator.addSource(source.url);
        orchestrator.addFact(`${source.title}: ${source.excerpt.slice(0, 240)}`);
        orchestrator.emit({
          type: 'step.completed',
          title: 'Extracted source',
          detail: `${source.title}\n${source.url}`,
          status: 'done',
        });
      } catch (error) {
        logger.warn(
          '[embeddedBrowserResearchTask] source extraction skipped',
          error,
        );
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
    const finalAnswer = await synthesizeSources(instructions, settings, sources);
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
