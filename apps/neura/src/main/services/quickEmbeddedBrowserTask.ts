/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { StatusEnum } from '@neura-desktop/shared/types';

import { logger } from '@main/logger';
import { type AppState, SearchEngineForSettings } from '@main/store/types';
import { AgentOrchestrator } from './agentOrchestrator';
import { ComputerRuntimeController } from './computerRuntimeController';
import { embeddedBrowserRuntime } from './embeddedBrowserRuntime';

type RunnerArgs = {
  instructions: string;
  searchEngine?: SearchEngineForSettings;
  setState: (state: AppState) => void;
  getState: () => AppState;
};

export type QuickBrowserTaskKind = 'youtube' | 'search' | 'open' | null;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

export const classifyQuickBrowserTask = (instructions: string) => {
  const normalized = instructions.trim();
  if (/\byoutube\b/i.test(normalized)) {
    return 'youtube' as const;
  }
  if (
    /\b(search|look\s+up|lookup|find online|google|bing|latest|current|today|now|news|weather|price|stock|score|top\s+\d+|top|best|popular|trending|review|reviews|article|source|sources)\b/i.test(
      normalized,
    )
  ) {
    return 'search' as const;
  }
  if (/\b(open|go to|visit|navigate to)\s+[a-z0-9][\w .-]{1,80}$/i.test(normalized)) {
    return 'open' as const;
  }
  return null;
};

const normalizeSearchQuery = (instructions: string) =>
  instructions
    .replace(/^\s*please\s+/i, '')
    .replace(
      /^\s*(?:search(?:\s+(?:for|about))?|look\s+up|lookup|find(?:\s+(?:me|the))?|google|bing|give(?:\s+me)?|show(?:\s+me)?|tell(?:\s+me)?|open\s+(?:a\s+)?browser\s+and)\s+/i,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();

const toDirectUrl = (instructions: string) => {
  const explicit = instructions.match(/\bhttps?:\/\/[^\s"'<>]+/i)?.[0];
  if (explicit) {
    return explicit;
  }
  const domain = instructions.match(
    /\b([a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+\.[a-z]{2,})(?:\/[^\s"'<>]*)?/i,
  )?.[0];
  if (domain) {
    return domain;
  }
  const target = instructions
    .replace(/^\s*(?:open|go to|visit|navigate to)\s+/i, '')
    .replace(/\b(?:website|site|page)\b/gi, '')
    .replace(/[^\w .-]/g, '')
    .trim()
    .replace(/\s+/g, '');
  return target ? `${target}.com` : '';
};

const extractYoutubeQuery = (instructions: string) => {
  const normalized = instructions
    .replace(/\bon\s+youtube\b/gi, '')
    .replace(/\byoutube\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const playMatch = normalized.match(
    /\bplay\s+(?:the\s+)?(.+?)(?:\s+(?:song|music|video))?$/i,
  )?.[1];
  const query = (playMatch || '')
    .replace(/^(?:a|any|some)\s+(?:song|music|video)$/i, '')
    .trim();
  return query || 'popular music video';
};

const waitForPageReady = async () => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 8_000) {
    const ready = await embeddedBrowserRuntime
      .executeJavaScript<string>('document.readyState')
      .catch(() => 'loading');
    if (ready === 'interactive' || ready === 'complete') {
      break;
    }
    await delay(250);
  }
  await delay(800);
};

const readVisiblePageText = async () =>
  embeddedBrowserRuntime.executeJavaScript<string>(`
    (() => (document.body?.innerText || '').replace(/\\s+\\n/g, '\\n').trim())();
  `);

const clickFirstYoutubeVideo = async () =>
  embeddedBrowserRuntime.executeJavaScript<{
    ok: boolean;
    title?: string;
    href?: string;
    reason?: string;
  }>(`
    (() => {
      const isVisible = (node) => {
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const anchors = Array.from(document.querySelectorAll('a[href*="/watch"]'))
        .filter((anchor) => isVisible(anchor))
        .filter((anchor) => !/shorts/i.test(anchor.href));
      const anchor = anchors.find((item) => item.id === 'video-title') || anchors[0];
      if (!anchor) {
        return { ok: false, reason: 'No visible YouTube video result is available yet.' };
      }
      anchor.scrollIntoView({ block: 'center', inline: 'center' });
      const title = (anchor.getAttribute('title') || anchor.textContent || document.title || '').replace(/\\s+/g, ' ').trim();
      const href = anchor.href;
      anchor.click();
      return { ok: true, title, href };
    })();
  `);

type SearchResult = {
  title: string;
  href: string;
  snippet: string;
};

const extractSearchResults = async () =>
  embeddedBrowserRuntime.executeJavaScript<{
    url: string;
    title: string;
    visibleText: string;
    results: SearchResult[];
  }>(`
    (() => {
      const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const visibleText = document.body?.innerText || '';
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      const results = [];
      for (const anchor of anchors) {
        const heading = anchor.querySelector('h1,h2,h3,[role="heading"]');
        const title = clean(heading?.textContent || anchor.textContent);
        const href = anchor.href;
        if (!title || title.length < 4 || !/^https?:/i.test(href)) continue;
        if (/google\\.|bing\\.|youtube\\.com\\/results|accounts\\.google/i.test(href)) continue;
        const container = anchor.closest('article,li,div');
        const snippet = clean(container?.textContent || '').slice(0, 280);
        if (results.some((item) => item.href === href || item.title === title)) continue;
        results.push({ title, href, snippet });
        if (results.length >= 8) break;
      }
      return {
        url: location.href,
        title: document.title,
        visibleText: visibleText.replace(/\\n{3,}/g, '\\n\\n').trim().slice(0, 5000),
        results,
      };
    })();
  `);

const summarizeSearchPage = (query: string, page: Awaited<ReturnType<typeof extractSearchResults>>) => {
  if (captchaLikeText(page.visibleText)) {
    return '';
  }

  if (page.results.length) {
    const lines = page.results.slice(0, 6).map((item, index) => {
      const snippet =
        item.snippet && item.snippet !== item.title
          ? ` - ${item.snippet.replace(item.title, '').trim()}`
          : '';
      return `${index + 1}. ${item.title}${snippet}`;
    });
    return `Top visible results for "${query}":\n${lines.join('\n')}`;
  }

  const lines = page.visibleText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 24)
    .filter(
      (line) =>
        !/^(all|images|videos|news|shopping|maps|sign in|tools|settings)$/i.test(
          line,
        ),
    )
    .slice(0, 10);

  return lines.length
    ? `Visible information for "${query}":\n${lines.join('\n')}`
    : '';
};

const completeBrowserTask = (
  orchestrator: AgentOrchestrator,
  finalAnswer: string,
  evidence: string[],
) => {
  orchestrator.setCompletionProof({
    kind: 'browser_terminal_page',
    summary: 'Embedded browser task completed from the visible browser page.',
    evidence: evidence.slice(0, 20),
    verifiedAt: Date.now(),
  });
  orchestrator.emit({
    type: 'validation.completed',
    title: 'Task verified',
    detail: 'Used the embedded browser and current visible page state.',
    status: 'done',
  });
  orchestrator.complete(finalAnswer);
  ComputerRuntimeController.complete('Task completed');
};

async function runYoutubeTask(
  args: RunnerArgs,
  orchestrator: AgentOrchestrator,
) {
  const query = extractYoutubeQuery(args.instructions);
  const shouldPlay = /\b(play|song|music|video)\b/i.test(args.instructions);
  const targetUrl = shouldPlay
    ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
    : 'https://www.youtube.com/';

  await embeddedBrowserRuntime.navigate(targetUrl);
  await waitForPageReady();
  orchestrator.addSource(embeddedBrowserRuntime.webContents?.getURL() || targetUrl);
  orchestrator.emit({
    type: 'step.completed',
    title: 'Opened YouTube',
    detail: embeddedBrowserRuntime.webContents?.getURL() || targetUrl,
    status: 'done',
  });

  if (!shouldPlay) {
    completeBrowserTask(orchestrator, 'Opened YouTube in Neura Browser.', [
      targetUrl,
    ]);
    return;
  }

  const clicked: {
    ok: boolean;
    title?: string;
    href?: string;
    reason?: string;
  } = await clickFirstYoutubeVideo().catch((error) => ({
    ok: false,
    reason: error instanceof Error ? error.message : String(error),
  }));
  if (!clicked.ok) {
    throw new Error(
      clicked.reason ||
        'Could not find a visible YouTube video result to play.',
    );
  }

  await delay(2500);
  const title =
    (await embeddedBrowserRuntime
      .executeJavaScript<string>('document.title')
      .catch(() => '')) ||
    clicked.title ||
    query;
  orchestrator.emit({
    type: 'step.completed',
    title: 'Started playback',
    detail: title.replace(/\s+-\s+YouTube$/i, '').trim(),
    status: 'done',
  });
  completeBrowserTask(
    orchestrator,
    `Opened YouTube and started playing: ${title.replace(/\s+-\s+YouTube$/i, '').trim() || query}`,
    [targetUrl, clicked.href || '', title].filter(Boolean),
  );
}

async function runSearchTask(
  args: RunnerArgs,
  orchestrator: AgentOrchestrator,
) {
  const query = normalizeSearchQuery(args.instructions);
  const url =
    classifyQuickBrowserTask(args.instructions) === 'open'
      ? toDirectUrl(args.instructions)
      : buildSearchUrl(query, args.searchEngine);

  if (!url) {
    throw new Error('No browser URL or search query could be inferred.');
  }

  await embeddedBrowserRuntime.navigate(url);
  await waitForPageReady();
  const currentUrl = embeddedBrowserRuntime.webContents?.getURL() || url;
  orchestrator.addSource(currentUrl);
  orchestrator.emit({
    type: 'step.completed',
    title: 'Opened browser page',
    detail: currentUrl,
    status: 'done',
  });

  if (classifyQuickBrowserTask(args.instructions) === 'open') {
    completeBrowserTask(orchestrator, `Opened ${currentUrl}.`, [currentUrl]);
    return;
  }

  const page = await extractSearchResults();
  if (captchaLikeText(page.visibleText)) {
    throw new Error(
      'Human verification is visible in the browser. Use Take over to complete it, then run the task again.',
    );
  }

  const summary = summarizeSearchPage(query, page);
  if (!summary) {
    const visibleText = await readVisiblePageText().catch(() => '');
    throw new Error(
      visibleText
        ? 'The browser page loaded, but no useful visible result text could be extracted.'
        : 'The browser page loaded blank or without readable content.',
    );
  }

  completeBrowserTask(orchestrator, summary, [
    currentUrl,
    ...page.results.map((item) => `${item.title} - ${item.href}`),
  ]);
}

export async function runQuickEmbeddedBrowserTask({
  instructions,
  searchEngine,
  setState,
  getState,
}: RunnerArgs) {
  const kind = classifyQuickBrowserTask(instructions);
  if (!kind) {
    return false;
  }

  const orchestrator = new AgentOrchestrator({ getState, setState });
  orchestrator.begin(instructions, 'gui_browser');
  ComputerRuntimeController.start({
    mode: 'browser',
    subtitle: 'Browser',
    display: 'Browser',
    activity: 'Starting browser task',
  });
  embeddedBrowserRuntime.ensure();
  await embeddedBrowserRuntime.setInteractionBlocked(true);
  setState({
    ...getState(),
    status: StatusEnum.RUNNING,
  });

  try {
    if (kind === 'youtube') {
      await runYoutubeTask(
        { instructions, searchEngine, setState, getState },
        orchestrator,
      );
    } else {
      await runSearchTask(
        { instructions, searchEngine, setState, getState },
        orchestrator,
      );
    }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('[quickEmbeddedBrowserTask] failed', message);
    orchestrator.fail(message);
    ComputerRuntimeController.fail(message);
    return true;
  }
}
