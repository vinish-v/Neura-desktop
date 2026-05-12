/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';

import {
  Operator,
  parseBoxToScreenCoords,
  StatusEnum,
  type ExecuteOutput,
  type ExecuteParams,
  type ScreenshotOutput,
} from '@neura-desktop/sdk/core';

import { logger } from '@main/logger';
import {
  BROWSER_INPUT_BLOCKER_ID,
  embeddedBrowserRuntime,
} from './embeddedBrowserRuntime';

type ActionInputs = Record<string, string | undefined>;

const END_STATUS = 'end' as const;
const DOM_ELEMENT_ATTRIBUTE = 'data-neura-element-id';

const normalizeElementId = (elementId: string) =>
  elementId.trim().match(/\d+/)?.[0] || elementId.trim();

const internalElementSelector = `#${BROWSER_INPUT_BLOCKER_ID},[data-neura-internal="true"]`;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeKey = (key: string) => {
  const value = key.trim();
  const lower = value.toLowerCase();
  const map: Record<string, string> = {
    enter: 'Enter',
    return: 'Enter',
    escape: 'Escape',
    esc: 'Escape',
    tab: 'Tab',
    backspace: 'Backspace',
    delete: 'Delete',
    space: 'Space',
    arrowup: 'ArrowUp',
    arrowdown: 'ArrowDown',
    arrowleft: 'ArrowLeft',
    arrowright: 'ArrowRight',
    pageup: 'PageUp',
    pagedown: 'PageDown',
  };
  return map[lower] || value;
};

const parseBool = (value?: string) =>
  ['1', 'true', 'yes'].includes((value || '').trim().toLowerCase());

const requireInput = (value: string | undefined, name: string) => {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${name} is required.`);
  }
  return trimmed;
};

const truncateExtraction = (value: string, max = 16_000) =>
  value.length > max
    ? `${value.slice(0, max)}\n\n[Output truncated after ${max} characters.]`
    : value;

const captchaLikeText = (value: string) =>
  /\b(captcha|recaptcha|hcaptcha|i'?m not a robot|human verification)\b/i.test(
    value,
  );

const scriptErrorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : 'Browser page script failed.';

const elementLookupScript = (elementId: string) => `
  const attr = ${JSON.stringify(DOM_ELEMENT_ATTRIBUTE)};
  const rawElementId = ${JSON.stringify(elementId)};
  const normalizedElementId = ${JSON.stringify(normalizeElementId(elementId))};
  const internalSelector = ${JSON.stringify(internalElementSelector)};
  const selectors = [
    'a[href]', 'button', 'input', 'textarea', 'select', '[role="button"]',
    '[role="link"]', '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])'
  ];
  const isInternal = (node) => node.matches?.(internalSelector) || node.closest?.(internalSelector);
  const isVisible = (node) => {
    if (isInternal(node)) return false;
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const byAttr = Array.from(document.querySelectorAll('[' + attr + ']'))
    .find((node) => {
      const value = node.getAttribute(attr);
      return (value === rawElementId || value === normalizedElementId || value === 'e' + normalizedElementId) && isVisible(node);
    });
  if (byAttr) return byAttr;
  const numericIndex = Number.parseInt(normalizedElementId, 10);
  if (Number.isFinite(numericIndex) && numericIndex >= 0) {
    const visibleElements = Array.from(document.querySelectorAll(selectors.join(',')))
      .filter(isVisible)
      .slice(0, 120);
    const requestedZeroBased = /^e\\d+$/i.test(rawElementId.trim());
    const byIndex = visibleElements[requestedZeroBased ? numericIndex : Math.max(0, numericIndex - 1)];
    if (byIndex) {
      byIndex.setAttribute(attr, 'e' + (requestedZeroBased ? numericIndex : Math.max(0, numericIndex - 1)));
      return byIndex;
    }
  }
  return null;
`;

const normalizeUrlForComparison = (raw: string) => {
  try {
    const url = new URL(raw.trim().match(/^[a-z]+:/i) ? raw.trim() : `https://${raw.trim()}`);
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return raw.trim().replace(/\/$/, '');
  }
};

export class ElectronBrowserOperator extends Operator {
  static MANUAL = {
    ACTION_SPACES: [
      `navigate(content='https://example.com')`,
      `navigate_back()`,
      `click_element(element_id='')`,
      `type_element(element_id='', content='') # Use "\\n" at the end of content to submit.`,
      `click(start_box='[x1, y1, x2, y2]')`,
      `double_click(start_box='[x1, y1, x2, y2]')`,
      `right_click(start_box='[x1, y1, x2, y2]')`,
      `scroll(start_box='[x1, y1, x2, y2]', direction='down or up or right or left')`,
      `type(content='') # Type into the focused browser field; use "\\n" to submit.`,
      `hotkey(key='ctrl+l')`,
      `extract_page(format='markdown|text|html|links|tables|json')`,
      `download_url(url='', output_path='', overwrite='false')`,
      `save_page_screenshot(path='', overwrite='false')`,
      `wait()`,
      `finished(content='')`,
      `call_user()`,
    ],
  };

  private repeatedNavigationTarget = '';
  private repeatedNavigationCount = 0;
  private lastScreenshotSignature = '';
  private unchangedScreenshotCount = 0;

  constructor() {
    super();
    embeddedBrowserRuntime.ensure();
  }

  async screenshot(): Promise<ScreenshotOutput> {
    let domText = await this.captureDomMap();
    const image = await embeddedBrowserRuntime.capturePage();
    const scaleFactor = await this.getDeviceScaleFactor();
    const signature = createHash('sha256')
      .update(image.base64.slice(0, 120_000))
      .update(domText)
      .digest('hex');
    if (signature === this.lastScreenshotSignature) {
      this.unchangedScreenshotCount += 1;
      domText += `\n\nSCREEN_UNCHANGED: This browser screenshot and DOM map are unchanged from the previous observation (${this.unchangedScreenshotCount}). Do not repeat the previous action. If the requested page or answer is already visible, call finished(content='...'). Otherwise choose a different visible element, coordinate action, scroll, or extract_page.`;
    } else {
      this.lastScreenshotSignature = signature;
      this.unchangedScreenshotCount = 0;
    }
    return {
      base64: image.base64,
      scaleFactor,
      domText,
    };
  }

  async execute(params: ExecuteParams): Promise<ExecuteOutput> {
    const { parsedPrediction, screenWidth, screenHeight } = params;
    const actionInputs = (parsedPrediction.action_inputs || {}) as ActionInputs;
    const actionType = parsedPrediction.action_type;
    let point: { x: number; y: number } | null = null;
    const getPoint = async () => {
      if (!point) {
        const deviceScaleFactor = await this.getDeviceScaleFactor();
        point = this.getMouseCoords(
          actionInputs,
          screenWidth,
          screenHeight,
          deviceScaleFactor,
        );
      }
      return point;
    };

    logger.info('[ElectronBrowserOperator] execute', {
      actionType,
      actionInputs,
    });

    switch (actionType) {
      case 'navigate':
        return await this.navigate(actionInputs);
      case 'navigate_back':
        embeddedBrowserRuntime.goBack();
        break;
      case 'click_element':
        return await this.clickElement(actionInputs);
      case 'type_element':
        return await this.typeElement(actionInputs);
      case 'click':
      case 'left_click':
      case 'left_single':
        {
          const { x, y } = await getPoint();
          await this.sendMouseClick(x, y, 'left', 1);
        }
        break;
      case 'double_click':
      case 'left_double':
        {
          const { x, y } = await getPoint();
          await this.sendMouseClick(x, y, 'left', 2);
        }
        break;
      case 'right_click':
      case 'right_single':
        {
          const { x, y } = await getPoint();
          await this.sendMouseClick(x, y, 'right', 1);
        }
        break;
      case 'scroll':
        {
          const { x, y } = await getPoint();
          await this.scroll(x, y, actionInputs.direction || 'down');
        }
        break;
      case 'type':
        await this.typeText(actionInputs.content || '');
        break;
      case 'hotkey':
        await this.sendHotkey(actionInputs.key || actionInputs.content || '');
        break;
      case 'press':
        await this.sendKey(actionInputs.key || actionInputs.content || '', 'keyDown');
        break;
      case 'release':
        await this.sendKey(actionInputs.key || actionInputs.content || '', 'keyUp');
        break;
      case 'extract_page':
        return await this.extractPage(actionInputs);
      case 'download_url':
        return await this.downloadUrl(actionInputs);
      case 'save_page_screenshot':
        return await this.savePageScreenshot(actionInputs);
      case 'wait':
        await delay(3000);
        break;
      case 'finished':
      case 'call_user':
      case 'user_stop':
        break;
      default:
        logger.warn('[ElectronBrowserOperator] unsupported action', actionType);
    }

    embeddedBrowserRuntime.publishBrowserState();
    const finalPoint = point as { x: number; y: number } | null;
    return {
      startX: finalPoint?.x,
      startY: finalPoint?.y,
      action_inputs: actionInputs,
    };
  }

  private async captureDomMap() {
    try {
      return await embeddedBrowserRuntime.executeJavaScript<string>(`
      (() => {
        try {
          const attr = ${JSON.stringify(DOM_ELEMENT_ATTRIBUTE)};
          const internalSelector = ${JSON.stringify(internalElementSelector)};
          const selectors = [
            'a[href]', 'button', 'input', 'textarea', 'select', '[role="button"]',
            '[role="link"]', '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])'
          ];
          const elements = Array.from(document.querySelectorAll(selectors.join(',')))
            .filter((el) => {
              if (el.matches?.(internalSelector) || el.closest?.(internalSelector)) return false;
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
            })
            .slice(0, 120);
          const lines = ['URL: ' + location.href, 'TITLE: ' + document.title, 'ELEMENTS:'];
          elements.forEach((el, index) => {
            const id = 'e' + index;
            el.setAttribute(attr, id);
            const rect = el.getBoundingClientRect();
            const role = el.getAttribute('role') || el.tagName.toLowerCase();
            const label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 180);
            lines.push(id + '. ' + role + ' [' + Math.round(rect.left) + ',' + Math.round(rect.top) + ',' + Math.round(rect.right) + ',' + Math.round(rect.bottom) + '] ' + label);
          });
          return lines.join('\\n');
        } catch (error) {
          return 'URL: ' + location.href + '\\nTITLE: ' + document.title + '\\nELEMENTS:\\nDOM map unavailable: ' + (error && error.message ? error.message : String(error));
        }
      })();
    `);
    } catch (error) {
      logger.warn('[ElectronBrowserOperator] DOM map capture failed', error);
      return `ELEMENTS:\nDOM map unavailable: ${scriptErrorMessage(error)}`;
    }
  }

  private async navigate(inputs: ActionInputs): Promise<ExecuteOutput> {
    const target = requireInput(inputs.content, 'content');
    const currentUrl = embeddedBrowserRuntime.webContents?.getURL() || '';
    const normalizedTarget = normalizeUrlForComparison(target);
    const normalizedCurrent = normalizeUrlForComparison(currentUrl);

    if (normalizedTarget && normalizedTarget === normalizedCurrent) {
      this.repeatedNavigationCount =
        this.repeatedNavigationTarget === normalizedTarget
          ? this.repeatedNavigationCount + 1
          : 1;
      this.repeatedNavigationTarget = normalizedTarget;
      return {
        message:
          this.repeatedNavigationCount >= 2
            ? 'The browser is already on that page. Do not navigate again; inspect the current page with the visible screenshot/DOM map, then click, type, extract_page, or finish with the answer.'
            : 'Navigation is already complete. Continue from the current visible page instead of navigating again.',
      };
    }

    this.repeatedNavigationTarget = normalizedTarget;
    this.repeatedNavigationCount = 0;
    await embeddedBrowserRuntime.navigate(target);
    return {
      action_inputs: inputs,
      message: `Navigated to ${embeddedBrowserRuntime.webContents?.getURL() || target}`,
    };
  }

  private async clickElement(inputs: ActionInputs): Promise<ExecuteOutput> {
    const elementId = requireInput(inputs.element_id || inputs.content, 'element_id');
    let result: { ok: boolean; reason?: string; text?: string };
    try {
      result = await embeddedBrowserRuntime.executeJavaScript<{
        ok: boolean;
        reason?: string;
        text?: string;
      }>(`
      (() => {
        try {
          const el = (() => {${elementLookupScript(elementId)}})();
          if (!el) return { ok: false, reason: 'Element is not visible on the current page.' };
          const text = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim();
          el.scrollIntoView({ block: 'center', inline: 'center' });
          el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
          el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
          el.click();
          return { ok: true, text };
        } catch (error) {
          return { ok: false, reason: error && error.message ? error.message : String(error) };
        }
      })();
    `);
    } catch (error) {
      logger.warn('[ElectronBrowserOperator] click_element script failed', error);
      result = { ok: false, reason: scriptErrorMessage(error) };
    }
    if (!result.ok) {
      return {
        status: captchaLikeText(result.reason || result.text || '')
          ? StatusEnum.CALL_USER
          : undefined,
        message: `Previous browser DOM action could not be executed: ${
          result.reason || 'element unavailable'
        }. Continue autonomously: take a fresh screenshot/DOM map and choose a visible element or coordinate click. Do not finish with this recovery message.`,
      };
    }
    if (captchaLikeText(result.text || '')) {
      return {
        status: StatusEnum.CALL_USER,
        message: 'Human verification is visible. User takeover is required.',
      };
    }
    embeddedBrowserRuntime.publishBrowserState();
    return { message: result.text };
  }

  private async typeElement(inputs: ActionInputs): Promise<ExecuteOutput> {
    const elementId = requireInput(inputs.element_id, 'element_id');
    const content = inputs.content || inputs.text || '';
    let result: { ok: boolean; reason?: string };
    try {
      result = await embeddedBrowserRuntime.executeJavaScript<{
        ok: boolean;
        reason?: string;
      }>(`
      (() => {
        try {
          const el = (() => {${elementLookupScript(elementId)}})();
          if (!el) return { ok: false, reason: 'Element is not visible on the current page.' };
          el.scrollIntoView({ block: 'center', inline: 'center' });
          el.focus();
          return { ok: true };
        } catch (error) {
          return { ok: false, reason: error && error.message ? error.message : String(error) };
        }
      })();
    `);
    } catch (error) {
      logger.warn('[ElectronBrowserOperator] type_element script failed', error);
      result = { ok: false, reason: scriptErrorMessage(error) };
    }
    if (!result.ok) {
      result = await this.focusVisibleEditableElement();
    }
    if (!result.ok) {
      return {
        message: `Previous browser DOM action could not be executed: ${
          result.reason || 'element unavailable'
        }. Continue autonomously: take a fresh screenshot/DOM map and choose a visible element or coordinate click/type. Do not finish with this recovery message.`,
      };
    }
    await this.typeText(content);
    return {};
  }

  private async focusVisibleEditableElement() {
    try {
      return await embeddedBrowserRuntime.executeJavaScript<{
        ok: boolean;
        reason?: string;
      }>(`
      (async () => {
        const internalSelector = ${JSON.stringify(internalElementSelector)};
        const isInternal = (node) => node.matches?.(internalSelector) || node.closest?.(internalSelector);
        const isVisible = (node) => {
          if (!node || isInternal(node)) return false;
          const rect = node.getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        };
        const editableSelectors = [
          'input:not([type="hidden"]):not([disabled])',
          'textarea:not([disabled])',
          '[contenteditable="true"]',
          '[role="searchbox"]',
          '[role="textbox"]'
        ];
        const pickEditable = () => {
          const candidates = Array.from(document.querySelectorAll(editableSelectors.join(','))).filter(isVisible);
          return candidates.find((el) => {
            const text = [
              el.getAttribute('aria-label'),
              el.getAttribute('placeholder'),
              el.getAttribute('name'),
              el.getAttribute('title'),
              el.id,
              el.className
            ].join(' ');
            return /search|query|q\\b/i.test(text);
          }) || candidates[0] || null;
        };

        let target = pickEditable();
        if (!target) {
          const buttons = Array.from(document.querySelectorAll('button,[role="button"],a[href]')).filter(isVisible);
          const searchButton = buttons.find((el) => /search/i.test([
            el.getAttribute('aria-label'),
            el.getAttribute('title'),
            el.textContent
          ].join(' ')));
          if (searchButton) {
            searchButton.click();
            await new Promise((resolve) => setTimeout(resolve, 350));
            target = pickEditable();
          }
        }

        if (!target) {
          return { ok: false, reason: 'No visible editable field is available on the current page.' };
        }
        target.scrollIntoView({ block: 'center', inline: 'center' });
        target.focus();
        return { ok: true };
      })();
    `);
    } catch (error) {
      logger.warn('[ElectronBrowserOperator] editable fallback failed', error);
      return { ok: false, reason: scriptErrorMessage(error) };
    }
  }

  private async typeText(content: string) {
    const normalized = content.replace(/\\n/g, '\n');
    const text = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
    await embeddedBrowserRuntime.withInteractionUnblocked(async () => {
      if (text) {
        await embeddedBrowserRuntime.webContents?.insertText(text);
      }
      if (normalized.endsWith('\n')) {
        await this.sendKey('Enter');
      }
    });
  }

  private async sendMouseClick(
    x: number,
    y: number,
    button: 'left' | 'right',
    clickCount: number,
  ) {
    this.assertPoint(x, y);
    await embeddedBrowserRuntime.withInteractionUnblocked(() => {
      embeddedBrowserRuntime.sendInputEvent({
        type: 'mouseDown',
        x,
        y,
        button,
        clickCount,
      });
      embeddedBrowserRuntime.sendInputEvent({
        type: 'mouseUp',
        x,
        y,
        button,
        clickCount,
      });
    });
  }

  private async scroll(x: number, y: number, direction: string) {
    this.assertPoint(x, y);
    const amount = direction === 'up' || direction === 'left' ? 450 : -450;
    await embeddedBrowserRuntime.withInteractionUnblocked(() => {
      embeddedBrowserRuntime.sendInputEvent({
        type: 'mouseWheel',
        x,
        y,
        deltaX: direction === 'left' || direction === 'right' ? amount : 0,
        deltaY: direction === 'up' || direction === 'down' ? amount : 0,
      });
    });
  }

  private async sendHotkey(raw: string) {
    type InputModifier =
      | 'shift'
      | 'control'
      | 'ctrl'
      | 'alt'
      | 'meta'
      | 'command'
      | 'cmd';
    const parts = raw
      .split(/[\s+]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    const key = normalizeKey(parts.pop() || '');
    const modifiers = parts
      .map((part): InputModifier | null => {
        const value = part.toLowerCase();
        if (value === 'control') return 'ctrl';
        if (value === 'cmd' || value === 'command') return 'meta';
        if (
          value === 'shift' ||
          value === 'ctrl' ||
          value === 'alt' ||
          value === 'meta'
        ) {
          return value;
        }
        return null;
      })
      .filter((value): value is InputModifier => Boolean(value));
    await embeddedBrowserRuntime.withInteractionUnblocked(() => {
      embeddedBrowserRuntime.sendInputEvent({
        type: 'keyDown',
        keyCode: key,
        modifiers,
      });
      embeddedBrowserRuntime.sendInputEvent({
        type: 'keyUp',
        keyCode: key,
        modifiers,
      });
    });
  }

  private async sendKey(raw: string, type: 'keyDown' | 'keyUp' = 'keyDown') {
    const keyCode = normalizeKey(raw);
    await embeddedBrowserRuntime.withInteractionUnblocked(() => {
      embeddedBrowserRuntime.sendInputEvent({ type, keyCode });
      if (type === 'keyDown') {
        embeddedBrowserRuntime.sendInputEvent({ type: 'keyUp', keyCode });
      }
    });
  }

  private async extractPage(inputs: ActionInputs): Promise<ExecuteOutput> {
    const format = (inputs.format || 'markdown').trim().toLowerCase();
    let extracted: {
      url: string;
      title: string;
      html: string;
      text: string;
      links: Array<{ text: string; href: string }>;
      tables: string[][][];
    };
    try {
      extracted = await embeddedBrowserRuntime.executeJavaScript<{
        url: string;
        title: string;
        html: string;
        text: string;
        links: Array<{ text: string; href: string }>;
        tables: string[][][];
      }>(`
      (() => {
        try {
          const text = document.body?.innerText || '';
          const links = Array.from(document.querySelectorAll('a[href]')).map((anchor) => ({
            text: (anchor.textContent || '').replace(/\\s+/g, ' ').trim(),
            href: anchor.href,
          }));
          const tables = Array.from(document.querySelectorAll('table')).map((table) =>
            Array.from(table.querySelectorAll('tr')).map((row) =>
              Array.from(row.querySelectorAll('th,td')).map((cell) =>
                (cell.textContent || '').replace(/\\s+/g, ' ').trim()
              )
            )
          );
          return {
            url: location.href,
            title: document.title,
            html: document.documentElement.outerHTML,
            text,
            links,
            tables,
          };
        } catch (error) {
          return {
            url: location.href,
            title: document.title,
            html: '',
            text: document.body?.innerText || '',
            links: [],
            tables: [],
          };
        }
      })();
    `);
    } catch (error) {
      logger.warn('[ElectronBrowserOperator] extract_page script failed', error);
      return {
        message: `Could not extract the page through DOM scripting: ${scriptErrorMessage(
          error,
        )}. Use the visible page/screenshot to continue.`,
      };
    }
    const markdown = [
      `# ${extracted.title || 'Untitled page'}`,
      '',
      `Source: ${extracted.url}`,
      '',
      extracted.text,
    ].join('\n');
    const outputByFormat: Record<string, string> = {
      markdown,
      text: extracted.text,
      html: extracted.html,
      links: JSON.stringify(extracted.links, null, 2),
      tables: JSON.stringify(extracted.tables, null, 2),
      json: JSON.stringify(extracted, null, 2),
    };
    return {
      status: END_STATUS,
      message: `Extracted current page as ${format}:\n\n${truncateExtraction(outputByFormat[format] || markdown)}`,
    };
  }

  private async downloadUrl(inputs: ActionInputs): Promise<ExecuteOutput> {
    const url = requireInput(inputs.url || inputs.content, 'url');
    const outputPath = path.resolve(requireInput(inputs.output_path || inputs.path, 'output_path'));
    await this.assertWritable(outputPath, parseBool(inputs.overwrite));
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Download failed with HTTP ${response.status}`);
    }
    await fs.writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
    return { status: END_STATUS, message: `Downloaded ${url} to ${outputPath}` };
  }

  private async savePageScreenshot(inputs: ActionInputs): Promise<ExecuteOutput> {
    const outputPath = path.resolve(requireInput(inputs.path || inputs.output_path, 'path'));
    await this.assertWritable(outputPath, parseBool(inputs.overwrite));
    const image = await embeddedBrowserRuntime.capturePage();
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, Buffer.from(image.base64, 'base64'));
    return {
      status: END_STATUS,
      message: `Saved page screenshot to ${outputPath}`,
    };
  }

  private async assertWritable(outputPath: string, overwrite: boolean) {
    if (!overwrite && existsSync(outputPath)) {
      throw new Error(
        `Output path already exists: ${outputPath}. Ask with overwrite=true or choose a new path.`,
      );
    }
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
  }

  private async getDeviceScaleFactor() {
    try {
      return await embeddedBrowserRuntime.executeJavaScript<number>(
        'window.devicePixelRatio || 1',
      );
    } catch (error) {
      logger.warn('[ElectronBrowserOperator] device scale lookup failed', error);
      return 1;
    }
  }

  private getMouseCoords(
    inputs: ActionInputs,
    screenWidth: number,
    screenHeight: number,
    deviceScaleFactor: number,
  ) {
    const parsedCoords = inputs.start_coords;
    if (Array.isArray(parsedCoords)) {
      return {
        x: Number(parsedCoords[0]) / deviceScaleFactor,
        y: Number(parsedCoords[1]) / deviceScaleFactor,
      };
    }
    const coords = parseBoxToScreenCoords({
      boxStr: inputs.start_box || '',
      screenWidth,
      screenHeight,
    });
    return {
      x: Math.round((coords.x || 0) / deviceScaleFactor),
      y: Math.round((coords.y || 0) / deviceScaleFactor),
    };
  }

  private assertPoint(x: number, y: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('A valid browser coordinate is required.');
    }
  }
}
