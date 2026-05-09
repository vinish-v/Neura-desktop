/* eslint-disable @typescript-eslint/no-explicit-any */
/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  GUIAgentData,
  NeuraModelVersion,
  StatusEnum,
  ShareVersion,
  ErrorStatusEnum,
  GUIAgentError,
  Message,
} from '@neura-desktop/shared/types';
import {
  IMAGE_PLACEHOLDER,
  MAX_LOOP_COUNT,
} from '@neura-desktop/shared/constants';
import { sleep } from '@neura-desktop/shared/utils';
import asyncRetry from 'async-retry';
import { Jimp } from 'jimp';
import { v4 as uuidv4 } from 'uuid';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

import { setContext } from './context/useContext';
import { Operator, GUIAgentConfig, InvokeParams } from './types';
import { NeuraModel } from './Model';
import { BaseGUIAgent } from './base';
import {
  getSummary,
  processVlmParams,
  replaceBase64Prefix,
  toVlmModelFormat,
} from './utils';
import {
  INTERNAL_ACTION_SPACES_ENUM,
  MAX_SNAPSHOT_ERR_CNT,
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_TEMPLATE,
} from './constants';
import { InternalServerError } from 'openai';

const isAbortError = (error: unknown) =>
  error instanceof Error &&
  (error.name === 'AbortError' ||
    error.name === 'APIUserAbortError' ||
    error.message?.toLowerCase().includes('aborted'));

const isNonRetryableModelError = (error: unknown) => {
  const status = (error as { status?: unknown })?.status;
  return typeof status === 'number' && status >= 400 && status < 500;
};

const isRecoverableExecuteError = (error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';

  return /Element not found for (click_element|type_element)|Execution context was destroyed|Cannot find context with specified id|Frame was detached|Target closed/i.test(
    message,
  );
};

const stableStringify = (value: unknown): string => {
  if (!value || typeof value !== 'object') {
    return String(value ?? '');
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  return Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${key}:${stableStringify(item)}`)
    .join('|');
};

const getActionSignature = (
  parsedPredictions: Array<{ action_type: string; action_inputs: any }>,
) => {
  const prediction = parsedPredictions.find((item) => item.action_type);
  if (!prediction) {
    return '';
  }
  return `${prediction.action_type}:${stableStringify(prediction.action_inputs)}`;
};

const getStateFingerprint = (domText?: string) =>
  (domText || '')
    .replace(/\be\d+\b/g, 'e#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000);

const shouldGuardRepeatedAction = (actionSignature: string) =>
  /^(click_element|type_element|click|left_click|left_single|left_double|double_click|type):/i.test(
    actionSignature,
  );

const extractUrlFromDomText = (domText?: string) =>
  domText?.match(/^URL:\s*(.+)$/im)?.[1]?.trim() || '';

const extractTitleFromDomText = (domText?: string) =>
  domText?.match(/^Title:\s*(.+)$/im)?.[1]?.trim() || '';

const isHumanVerificationPage = (domText?: string) => {
  const text = domText || '';
  const url = extractUrlFromDomText(text);
  const title = extractTitleFromDomText(text);
  const combined = `${url}\n${title}\n${text}`;

  return /google\.[^/\s]+\/sorry\/index|recaptcha|captcha|i'?m not a robot|unusual traffic|automated queries|verify you are human|human verification/i.test(
    combined,
  );
};

const HUMAN_VERIFICATION_MESSAGE =
  'This page requires human verification. Use Take over to complete the CAPTCHA, then send "done" so Neura can continue.';

const isSearchResultsPage = (domText?: string) => {
  const text = domText || '';
  const url = extractUrlFromDomText(text);
  const title = extractTitleFromDomText(text);

  if (
    /\/\/(www\.)?(google|bing|duckduckgo|yahoo)\./i.test(url) &&
    /([?&]q=|\/search|\/html)/i.test(url)
  ) {
    return true;
  }

  return /\b(search results|people also ask|related searches|all images videos news shopping|tools)\b/i.test(
    `${title}\n${text.slice(0, 2500)}`,
  );
};

const taskNeedsDeepSource = (instruction: string) =>
  /\b(article|top article|ranked|ranking|summary|summarize|source|verify|detailed|details|research|report|extract|list of)\b/i.test(
    instruction,
  );

const getFinishedContent = (
  parsedPredictions: Array<{ action_type: string; action_inputs: any }>,
) => {
  const finished = parsedPredictions.find(
    (item) => item.action_type === INTERNAL_ACTION_SPACES_ENUM.FINISHED,
  );
  const content = finished?.action_inputs?.content;
  return typeof content === 'string' ? content.trim() : '';
};

const getPrimaryAction = (
  parsedPredictions: Array<{ action_type: string; action_inputs: any }>,
) => parsedPredictions.find((item) => item.action_type);

const normalizeSearchText = (value = '') =>
  value
    .replace(/\\n|\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const getTypedContent = (prediction?: {
  action_type: string;
  action_inputs: any;
}) => {
  if (!prediction) {
    return '';
  }

  if (!/^(type|type_element)$/i.test(prediction.action_type)) {
    return '';
  }

  const content = prediction.action_inputs?.content;
  return typeof content === 'string' ? normalizeSearchText(content) : '';
};

const extractSearchQueryFromDomText = (domText?: string) => {
  const url = extractUrlFromDomText(domText);
  if (!url) {
    return '';
  }

  try {
    const parsed = new URL(url);
    return normalizeSearchText(
      parsed.searchParams.get('q') ||
        parsed.searchParams.get('query') ||
        parsed.searchParams.get('p') ||
        '',
    );
  } catch {
    const match = url.match(/[?&](?:q|query|p)=([^&]+)/i);
    return normalizeSearchText(
      match?.[1] ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : '',
    );
  }
};

const shouldFinishRepeatedSearchSubmission = ({
  domText,
  parsedPredictions,
}: {
  domText?: string;
  parsedPredictions: Array<{ action_type: string; action_inputs: any }>;
}) => {
  if (!isSearchResultsPage(domText)) {
    return false;
  }

  const typedContent = getTypedContent(getPrimaryAction(parsedPredictions));
  if (!typedContent || typedContent.length < 2) {
    return false;
  }

  const pageQuery = extractSearchQueryFromDomText(domText);
  const pageText = normalizeSearchText(domText || '');

  return (
    (!!pageQuery &&
      (pageQuery.includes(typedContent) || typedContent.includes(pageQuery))) ||
    pageText.includes(typedContent)
  );
};

const buildRepeatedSearchCorrection = (domText?: string) => {
  const pageQuery = extractSearchQueryFromDomText(domText);

  return [
    pageQuery
      ? `The current page is already a search results page for "${pageQuery}".`
      : 'The current page already shows search results for the submitted query.',
    "Do not type the same query again. Use only the visible screenshot/DOM evidence to answer if it is sufficient; otherwise click a relevant result, inspect it, then use finished(content='...') with the real answer.",
  ].join(' ');
};

const hasPrematureFinished = ({
  instruction,
  domText,
  parsedPredictions,
}: {
  instruction: string;
  domText?: string;
  parsedPredictions: Array<{ action_type: string; action_inputs: any }>;
}) => {
  const finishedContent = getFinishedContent(parsedPredictions);
  if (!finishedContent) {
    return false;
  }

  if (
    /\b(would you like me to|i can use automation|i'?m using automation|i will|let me know|do that now)\b/i.test(
      finishedContent,
    )
  ) {
    return true;
  }

  if (taskNeedsDeepSource(instruction) && isSearchResultsPage(domText)) {
    return true;
  }

  return false;
};

const buildPrematureFinishedCorrection = (
  instruction: string,
  domText?: string,
) => {
  if (taskNeedsDeepSource(instruction) && isSearchResultsPage(domText)) {
    return "You tried to finish while still on a search results page. The user asked for source-backed or deeper information, so a SERP/snippet is not enough. Choose one relevant result from the current DOM map, open the destination page, inspect its content, and only then use finished(content='...').";
  }

  return "You tried to finish without proving the task is complete. Do not promise future automation or ask for confirmation when the action is safe. Use the current screenshot/DOM and choose the next executable action that actually performs the user's request.";
};

const normalizePlannerState = (text: string) =>
  text.replace(/\s+\n/g, '\n').trim().slice(0, 2200);

const coordinateActionTypes = new Set([
  'click',
  'left_click',
  'left_single',
  'double_click',
  'left_double',
  'right_click',
  'right_single',
  'drag',
]);

const hasFinitePoint = (value: unknown) =>
  Array.isArray(value) &&
  value.length >= 2 &&
  Number.isFinite(value[0]) &&
  Number.isFinite(value[1]);

const hasInvalidCoordinateAction = (
  parsedPredictions: Array<{ action_type: string; action_inputs: any }>,
) =>
  parsedPredictions.some((prediction) => {
    if (!coordinateActionTypes.has(prediction.action_type)) {
      return false;
    }

    if (prediction.action_type === 'drag') {
      return (
        !hasFinitePoint(prediction.action_inputs?.start_coords) ||
        !hasFinitePoint(prediction.action_inputs?.end_coords)
      );
    }

    return !hasFinitePoint(prediction.action_inputs?.start_coords);
  });

const buildPlannerMessages = ({
  instruction,
  conversations,
  domText,
  taskState,
}: {
  instruction: string;
  conversations: Message[];
  domText?: string;
  taskState?: string;
}): ChatCompletionMessageParam[] => {
  const recentHistory = conversations
    .filter((conv) => conv.value !== IMAGE_PLACEHOLDER)
    .slice(-12)
    .map(
      (conv) =>
        `${conv.from === 'human' ? 'User' : 'Assistant'}: ${conv.value}`,
    )
    .join('\n');

  return [
    {
      role: 'system',
      content: [
        'You are Neura planner, a text-only planning and validation model for a GUI automation agent.',
        'Maintain compact public task state across steps: ultimate goal, completed subgoals, missing proof, next executable strategy, and whether the current evidence is enough to finish.',
        'For brief latest-news requests, visible Top Stories/news cards are enough when they show source, headline, and recency; guide the action model to summarize and finish. Require opening a relevant source page only for article, source-backed summary, ranking, detailed verification, or extraction requests.',
        'When the task is complete, guide the action model to answer in a complete sentence with the visible context or source, not as a bare one-word response unless the user explicitly requested only the value.',
        'For local app tasks, require actual app interaction before completion.',
        'If the visible state did not change, choose a different strategy instead of repeating the same action.',
        'Do not output click coordinates. Do not write hidden chain-of-thought. Keep state concise and operational.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        `Task: ${instruction}`,
        taskState ? `Previous planner state:\n${taskState}` : '',
        recentHistory ? `Recent history:\n${recentHistory}` : '',
        domText
          ? `Current browser DOM/text summary:\n${domText.slice(0, 6000)}`
          : '',
        [
          'Return only this compact format:',
          'STATE:',
          'Goal: ...',
          'Done: ...',
          'Missing: ...',
          'Next: ...',
          'Can finish: yes/no',
          'GUIDANCE: one sentence for the vision/action model naming the next action type and target.',
        ].join('\n'),
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ];
};

export class GUIAgent<T extends Operator> extends BaseGUIAgent<
  GUIAgentConfig<T>
> {
  private readonly operator: T;
  private readonly model: InstanceType<typeof NeuraModel>;
  private readonly plannerModel?: InstanceType<typeof NeuraModel>;
  private readonly logger: NonNullable<GUIAgentConfig<T>['logger']>;
  private neuraModelVersion?: NeuraModelVersion;
  private systemPrompt: string;

  private isPaused = false;
  private resumePromise: Promise<void> | null = null;
  private resolveResume: (() => void) | null = null;
  private isStopped = false;

  constructor(config: GUIAgentConfig<T>) {
    super(config);
    this.operator = config.operator;

    this.model =
      config.model instanceof NeuraModel
        ? config.model
        : new NeuraModel(config.model);
    this.plannerModel = config.plannerModel
      ? config.plannerModel instanceof NeuraModel
        ? config.plannerModel
        : new NeuraModel(config.plannerModel)
      : undefined;
    this.logger = config.logger || console;
    this.neuraModelVersion = config.neuraModelVersion;
    this.systemPrompt = config.systemPrompt || this.buildSystemPrompt();
  }

  async run(
    instruction: string,
    historyMessages?: Message[],
    remoteModelHdrs?: Record<string, string>,
  ) {
    const { operator, model, plannerModel, logger } = this;
    const {
      signal,
      onData,
      onError,
      retry = {},
      maxLoopCount = MAX_LOOP_COUNT,
    } = this.config;

    const currentTime = Date.now();
    const data: GUIAgentData = {
      version: ShareVersion.V1,
      systemPrompt: this.systemPrompt,
      instruction,
      modelName: this.model.modelName,
      status: StatusEnum.INIT,
      logTime: currentTime,
      conversations: [
        {
          from: 'human',
          value: instruction,
          timing: {
            start: currentTime,
            end: currentTime,
            cost: 0,
          },
        },
      ],
    };

    // inject guiAgent config for operator to get
    setContext(
      Object.assign(this.config, {
        logger: this.logger,
        systemPrompt: this.systemPrompt,
        factors: this.model.factors,
        model: this.model,
      }),
    );

    logger.info(
      `[GUIAgent] run:\nsystem prompt: ${this.systemPrompt},\nmodel version: ${this.neuraModelVersion},\nmodel: ${this.model.modelName}`,
    );

    let loopCnt = 0;
    let snapshotErrCnt = 0;
    let totalTokens = 0;
    let totalTime = 0;
    let previousResponseId: string | undefined;
    let emptyActionCnt = 0;
    let invalidCoordinateActionCnt = 0;
    let lastStateFingerprint = '';
    let sameStateLoopCnt = 0;
    let lastStateActionSignature = '';
    let repeatedStateActionCnt = 0;
    let taskState = '';

    // start running agent
    data.status = StatusEnum.RUNNING;
    await onData?.({ data: { ...data, conversations: [] } });

    // Generate session id with UUID
    const sessionId = this.generateSessionId();

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        logger.info('[GUIAgent] loopCnt:', loopCnt);
        // check pause status
        if (this.isPaused && this.resumePromise) {
          data.status = StatusEnum.PAUSE;
          await onData?.({
            data: {
              ...data,
              conversations: [],
            },
          });
          await this.resumePromise;
          data.status = StatusEnum.RUNNING;
          await onData?.({
            data: {
              ...data,
              conversations: [],
            },
          });
        }

        if (
          this.isStopped ||
          (data.status !== StatusEnum.RUNNING &&
            data.status !== StatusEnum.PAUSE) ||
          signal?.aborted
        ) {
          // check if stop or aborted
          signal?.aborted && (data.status = StatusEnum.USER_STOPPED);
          break;
        }

        if (loopCnt >= maxLoopCount) {
          Object.assign(data, {
            status: StatusEnum.ERROR,
            error: this.guiAgentErrorParser(
              ErrorStatusEnum.REACH_MAXLOOP_ERROR,
            ),
          });
          break;
        }

        if (snapshotErrCnt >= MAX_SNAPSHOT_ERR_CNT) {
          Object.assign(data, {
            status: StatusEnum.ERROR,
            error: this.guiAgentErrorParser(
              ErrorStatusEnum.SCREENSHOT_RETRY_ERROR,
            ),
          });
          break;
        }

        loopCnt += 1;
        const start = Date.now();

        const snapshot = await asyncRetry(() => operator.screenshot(), {
          retries: retry?.screenshot?.maxRetries ?? 0,
          minTimeout: 5000,
          onRetry: retry?.screenshot?.onRetry,
        });

        const { width, height, mime } = await Jimp.fromBuffer(
          Buffer.from(replaceBase64Prefix(snapshot.base64), 'base64'),
        ).catch((e) => {
          logger.error('[GUIAgent] screenshot error', e);
          return {
            width: null,
            height: null,
            mime: '',
          };
        });

        const isValidImage = !!(snapshot?.base64 && width && height);

        if (!isValidImage) {
          loopCnt -= 1;
          snapshotErrCnt += 1;
          await sleep(1000);
          continue;
        }

        let end = Date.now();

        if (isValidImage) {
          data.conversations.push({
            from: 'human',
            value: IMAGE_PLACEHOLDER,
            screenshotBase64: snapshot.base64,
            domText: snapshot.domText,
            screenshotContext: {
              size: {
                width,
                height,
              },
              mime,
              scaleFactor: snapshot.scaleFactor,
            },
            timing: {
              start,
              end,
              cost: end - start,
            },
          });
          await onData?.({
            data: {
              ...data,
              conversations: data.conversations.slice(-1),
            },
          });
        }

        if (isHumanVerificationPage(snapshot.domText)) {
          logger.warn('[GUIAgent] human verification page detected', {
            url: extractUrlFromDomText(snapshot.domText),
            title: extractTitleFromDomText(snapshot.domText),
          });
          end = Date.now();
          const message: Message = {
            from: 'gpt',
            value: HUMAN_VERIFICATION_MESSAGE,
            timing: {
              start,
              end,
              cost: end - start,
            },
            screenshotContext: {
              size: {
                width,
                height,
              },
              scaleFactor: snapshot.scaleFactor,
            },
            predictionParsed: [
              {
                reflection: null,
                thought: 'Human verification is required before continuing.',
                action_type: INTERNAL_ACTION_SPACES_ENUM.CALL_USER,
                action_inputs: {},
              },
            ],
          };
          data.conversations.push(message);
          data.status = StatusEnum.CALL_USER;
          await onData?.({
            data: {
              ...data,
              conversations: [message],
            },
          });
          break;
        }

        const plannerStrategy = plannerModel
          ? await plannerModel
              .invokeText({
                messages: buildPlannerMessages({
                  instruction,
                  conversations: data.conversations,
                  domText: snapshot.domText,
                  taskState,
                }),
                headers: remoteModelHdrs,
              })
              .then((result) => normalizePlannerState(result.prediction))
              .catch((error) => {
                logger.warn(
                  '[GUIAgent] planner model failed; continuing without planner strategy',
                  error,
                );
                return '';
              })
          : '';

        if (plannerStrategy) {
          taskState = plannerStrategy;
          logger.info('[GUIAgent] Planner Strategy:', plannerStrategy);
        }

        // conversations -> messages, images
        const conversationsForModel = plannerStrategy
          ? [
              ...data.conversations,
              {
                from: 'human' as const,
                value: `Planner state for continuity:\n${plannerStrategy}\n\nUse the current screenshot/DOM to choose only the next executable GUI action. Keep the Action line as one function call.`,
              },
            ]
          : data.conversations;
        const modelFormat = toVlmModelFormat({
          historyMessages: historyMessages || [],
          conversations: conversationsForModel,
          systemPrompt: data.systemPrompt,
        });
        // sliding images window to vlm model
        const vlmParams: InvokeParams = {
          ...processVlmParams(modelFormat.conversations, modelFormat.images),
          screenContext: {
            width,
            height,
          },
          scaleFactor: snapshot.scaleFactor,
          neuraModelVersion: this.neuraModelVersion,
          headers: {
            ...remoteModelHdrs,
            'X-Session-Id': sessionId,
          },
          previousResponseId,
        };
        const invokeResult = await asyncRetry(
          async (bail) => {
            try {
              const result = await model.invoke({
                ...vlmParams,
                ...processVlmParams(
                  vlmParams.conversations,
                  vlmParams.images,
                  model.maxImageLength,
                ),
              });
              return result;
            } catch (error: unknown) {
              if (isAbortError(error)) {
                bail(error as unknown as Error);
                return {
                  prediction: '',
                  parsedPredictions: [],
                };
              }

              if (isNonRetryableModelError(error)) {
                bail(error as unknown as Error);
                return {
                  prediction: '',
                  parsedPredictions: [],
                };
              }

              throw error;
            }
          },
          {
            retries: retry?.model?.maxRetries ?? 0,
            minTimeout: 1000 * 3,
            maxTimeout: 1000 * 8,
            onRetry: retry?.model?.onRetry,
          },
        ).catch((error: Error) => {
          if (isAbortError(error)) {
            data.status = StatusEnum.USER_STOPPED;
            data.error = undefined;
            return null;
          }

          Object.assign(data, {
            status: StatusEnum.ERROR,
            error: this.guiAgentErrorParser(
              ErrorStatusEnum.INVOKE_RETRY_ERROR,
              error,
            ),
          });
          return null;
        });

        if (!invokeResult) {
          break;
        }

        const {
          prediction,
          parsedPredictions,
          costTime,
          costTokens,
          responseId,
        } = invokeResult;

        // responseId shouldn't be assigned to null or undefined
        if (responseId) {
          previousResponseId = responseId;
        }

        totalTokens += costTokens || 0;
        totalTime += costTime || 0;

        logger.info(
          `[GUIAgent] consumes: >>> costTime: ${costTime}, costTokens: ${costTokens} <<<`,
        );
        logger.info('[GUIAgent] Response:', prediction);
        logger.info(
          '[GUIAgent] Parsed Predictions:',
          JSON.stringify(parsedPredictions),
        );

        if (!prediction) {
          logger.error('[GUIAgent] Response Empty:', prediction);
          continue;
        }

        const predictionSummary = getSummary(prediction);
        const stateFingerprint = getStateFingerprint(snapshot.domText);
        if (stateFingerprint && stateFingerprint === lastStateFingerprint) {
          sameStateLoopCnt += 1;
        } else {
          lastStateFingerprint = stateFingerprint;
          sameStateLoopCnt = 1;
          lastStateActionSignature = '';
          repeatedStateActionCnt = 0;
        }

        if (!parsedPredictions.some((item) => item.action_type)) {
          emptyActionCnt += 1;
          logger.warn(
            `[GUIAgent] No executable action parsed. count=${emptyActionCnt}`,
          );
          end = Date.now();
          data.conversations.push({
            from: 'gpt',
            value: predictionSummary,
            timing: {
              start,
              end,
              cost: end - start,
            },
            screenshotContext: {
              size: {
                width,
                height,
              },
              scaleFactor: snapshot.scaleFactor,
            },
            predictionParsed: parsedPredictions,
          });
          data.conversations.push({
            from: 'human',
            value:
              "Your previous response was not executable. This is an authorized benign UI automation task. Reply with exactly two lines only: Thought: one short sentence. Action: one executable function call from the Action Space. Do not refuse unless the user's task is clearly harmful.",
            timing: {
              start: end,
              end,
              cost: 0,
            },
          });
          await onData?.({
            data: {
              ...data,
              conversations: data.conversations.slice(-2, -1),
            },
          });

          if (emptyActionCnt >= 2) {
            Object.assign(data, {
              status: StatusEnum.ERROR,
              error: this.guiAgentErrorParser(
                ErrorStatusEnum.UNKNOWN_ERROR,
                new Error(
                  'Neura could not produce a valid next action. Use Take over if the page needs manual input, or try a more direct instruction.',
                ),
              ),
            });
            break;
          }
          continue;
        } else {
          emptyActionCnt = 0;
        }

        if (hasInvalidCoordinateAction(parsedPredictions)) {
          invalidCoordinateActionCnt += 1;
          logger.warn(
            `[GUIAgent] Invalid coordinate action parsed. count=${invalidCoordinateActionCnt}`,
          );
          end = Date.now();
          data.conversations.push({
            from: 'gpt',
            value: predictionSummary,
            timing: {
              start,
              end,
              cost: end - start,
            },
            screenshotContext: {
              size: {
                width,
                height,
              },
              scaleFactor: snapshot.scaleFactor,
            },
            predictionParsed: parsedPredictions,
          });
          data.conversations.push({
            from: 'human',
            value:
              'Your previous action had invalid coordinates or placeholder values such as x1, y1, null, or NaN. Look at the current screenshot and reply with exactly two lines: Thought: one short sentence. Action: one executable function call with real numeric coordinates from the screenshot, or use navigate/type/wait/finished if coordinates are unnecessary.',
            timing: {
              start: end,
              end,
              cost: 0,
            },
          });
          await onData?.({
            data: {
              ...data,
              conversations: data.conversations.slice(-2),
            },
          });

          if (invalidCoordinateActionCnt >= 3) {
            Object.assign(data, {
              status: StatusEnum.ERROR,
              error: this.guiAgentErrorParser(
                ErrorStatusEnum.UNKNOWN_ERROR,
                new Error(
                  'The model repeatedly returned invalid click coordinates. Use a GUI action-trained model or give a more specific instruction.',
                ),
              ),
            });
            break;
          }
          continue;
        } else {
          invalidCoordinateActionCnt = 0;
        }

        if (
          hasPrematureFinished({
            instruction,
            domText: snapshot.domText,
            parsedPredictions,
          })
        ) {
          logger.warn('[GUIAgent] premature finished guard triggered', {
            url: extractUrlFromDomText(snapshot.domText),
            title: extractTitleFromDomText(snapshot.domText),
          });
          end = Date.now();
          data.conversations.push({
            from: 'gpt',
            value: predictionSummary,
            timing: {
              start,
              end,
              cost: end - start,
            },
            screenshotContext: {
              size: {
                width,
                height,
              },
              scaleFactor: snapshot.scaleFactor,
            },
            predictionParsed: parsedPredictions,
          });
          data.conversations.push({
            from: 'human',
            value: buildPrematureFinishedCorrection(
              instruction,
              snapshot.domText,
            ),
            timing: {
              start: end,
              end,
              cost: 0,
            },
          });
          await onData?.({
            data: {
              ...data,
              conversations: data.conversations.slice(-2),
            },
          });
          continue;
        }

        if (
          shouldFinishRepeatedSearchSubmission({
            domText: snapshot.domText,
            parsedPredictions,
          })
        ) {
          logger.warn('[GUIAgent] repeated search submission guard triggered', {
            query: extractSearchQueryFromDomText(snapshot.domText),
            url: extractUrlFromDomText(snapshot.domText),
          });
          end = Date.now();
          data.conversations.push({
            from: 'gpt',
            value: predictionSummary,
            timing: {
              start,
              end,
              cost: end - start,
            },
            screenshotContext: {
              size: {
                width,
                height,
              },
              scaleFactor: snapshot.scaleFactor,
            },
          });
          data.conversations.push({
            from: 'human',
            value: buildRepeatedSearchCorrection(snapshot.domText),
            timing: {
              start: end,
              end,
              cost: 0,
            },
          });
          await onData?.({
            data: {
              ...data,
              conversations: data.conversations.slice(-2),
            },
          });
          continue;
        }

        const actionSignature = getActionSignature(parsedPredictions);
        if (
          actionSignature &&
          actionSignature === lastStateActionSignature &&
          stateFingerprint
        ) {
          repeatedStateActionCnt += 1;
        } else {
          lastStateActionSignature = actionSignature;
          repeatedStateActionCnt = actionSignature ? 1 : 0;
        }

        if (
          shouldGuardRepeatedAction(actionSignature) &&
          (repeatedStateActionCnt >= 2 || sameStateLoopCnt >= 4)
        ) {
          logger.warn('[GUIAgent] repeated action/state guard triggered', {
            sameStateLoopCnt,
            repeatedStateActionCnt,
            actionSignature,
          });
          end = Date.now();
          data.conversations.push({
            from: 'gpt',
            value: predictionSummary,
            timing: {
              start,
              end,
              cost: end - start,
            },
            screenshotContext: {
              size: {
                width,
                height,
              },
              scaleFactor: snapshot.scaleFactor,
            },
            predictionParsed: parsedPredictions,
          });
          data.conversations.push({
            from: 'human',
            value:
              "The browser state has not changed after repeated actions. Do not click the same navigation or article again. If the requested page, result, or information is already visible, reply with finished(content='...') now, using the answer visible on screen. Otherwise choose a different next action, such as scrolling, using a visible current DOM element that has not been tried, navigating directly, or calling the user if blocked.",
            timing: {
              start: end,
              end,
              cost: 0,
            },
          });
          await onData?.({
            data: {
              ...data,
              conversations: data.conversations.slice(-2),
            },
          });
          lastStateActionSignature = '';
          repeatedStateActionCnt = 0;
          continue;
        }

        end = Date.now();
        data.conversations.push({
          from: 'gpt',
          value: predictionSummary,
          timing: {
            start,
            end,
            cost: end - start,
          },
          screenshotContext: {
            size: {
              width,
              height,
            },
            scaleFactor: snapshot.scaleFactor,
          },
          predictionParsed: parsedPredictions,
        });
        await onData?.({
          data: {
            ...data,
            conversations: data.conversations.slice(-1),
          },
        });

        // start execute action
        let shouldRefreshAfterExecuteFailure = false;
        for (const parsedPrediction of parsedPredictions) {
          const actionType = parsedPrediction.action_type;

          logger.info('[GUIAgent] Action:', actionType);

          // handle internal action spaces
          if (actionType === INTERNAL_ACTION_SPACES_ENUM.ERROR_ENV) {
            Object.assign(data, {
              status: StatusEnum.ERROR,
              error: this.guiAgentErrorParser(
                ErrorStatusEnum.ENVIRONMENT_ERROR,
              ),
            });
            break;
          } else if (actionType === INTERNAL_ACTION_SPACES_ENUM.MAX_LOOP) {
            Object.assign(data, {
              status: StatusEnum.ERROR,
              error: this.guiAgentErrorParser(
                ErrorStatusEnum.REACH_MAXLOOP_ERROR,
              ),
            });
            break;
          }

          if (!signal?.aborted && !this.isStopped) {
            logger.info(
              '[GUIAgent] Action Inputs:',
              parsedPrediction.action_inputs,
              parsedPrediction.action_type,
            );
            // TODO: pass executeOutput to onData
            const executeOutput = await asyncRetry(
              () =>
                operator.execute({
                  prediction,
                  parsedPrediction,
                  screenWidth: width,
                  screenHeight: height,
                  scaleFactor: snapshot.scaleFactor,
                  factors: this.model.factors,
                }),
              {
                retries: retry?.execute?.maxRetries ?? 0,
                minTimeout: 5000,
                onRetry: retry?.execute?.onRetry,
              },
            ).catch((e) => {
              logger.error('[GUIAgent] execute error', e);
              if (isRecoverableExecuteError(e)) {
                shouldRefreshAfterExecuteFailure = true;
                data.conversations.push({
                  from: 'human',
                  value:
                    'The previous browser DOM action could not be executed because the page changed or the element id was stale. Take a fresh screenshot/DOM map and choose the next action from the current page. Prefer visible DOM element ids from the newest Browser DOM Map; use coordinate click/type only if no stable element id is available.',
                  timing: {
                    start: Date.now(),
                    end: Date.now(),
                    cost: 0,
                  },
                });
                return;
              }

              Object.assign(data, {
                status: StatusEnum.ERROR,
                error: this.guiAgentErrorParser(
                  ErrorStatusEnum.EXECUTE_RETRY_ERROR,
                  e,
                ),
              });
            });

            if (executeOutput && executeOutput?.status) {
              data.status = executeOutput.status;
            }

            if (executeOutput?.message) {
              const now = Date.now();
              const message = {
                from: 'gpt' as const,
                value: executeOutput.message,
                timing: {
                  start: now,
                  end: now,
                  cost: 0,
                },
              };
              data.conversations.push(message);
              await onData?.({
                data: {
                  ...data,
                  conversations: [message],
                },
              });
            }

            if (shouldRefreshAfterExecuteFailure) {
              await onData?.({
                data: {
                  ...data,
                  conversations: data.conversations.slice(-1),
                },
              });
              break;
            }
          }

          // Action types must break the loop after operator execution:
          if (actionType === INTERNAL_ACTION_SPACES_ENUM.CALL_USER) {
            data.status = StatusEnum.CALL_USER;
            break;
          } else if (actionType === INTERNAL_ACTION_SPACES_ENUM.FINISHED) {
            data.status = StatusEnum.END;
            break;
          }
        }

        if (shouldRefreshAfterExecuteFailure) {
          continue;
        }

        if (this.config.loopIntervalInMs && this.config.loopIntervalInMs > 0) {
          logger.info(
            `[GUIAgent] sleep for ${this.config.loopIntervalInMs}ms before next loop`,
          );
          await sleep(this.config.loopIntervalInMs);
          logger.info(
            `[GUIAgent] sleep for ${this.config.loopIntervalInMs}ms before next loop done`,
          );
        }
      }
    } catch (error) {
      logger.error('[GUIAgent] Catch error', error);
      if (isAbortError(error)) {
        logger.info('[GUIAgent] Catch: request was aborted');
        data.status = StatusEnum.USER_STOPPED;
        return;
      }

      data.status = StatusEnum.ERROR;
      data.error = this.guiAgentErrorParser(
        ErrorStatusEnum.UNKNOWN_ERROR,
        error as Error,
      );

      // We only use OnError callback to dispatch error information to caller,
      // and we will not throw error to the caller.
      // throw error;
    } finally {
      logger.info('[GUIAgent] Finally: status', data.status);

      this.model?.reset();
      this.plannerModel?.reset();

      if (data.status === StatusEnum.USER_STOPPED) {
        await operator.execute({
          prediction: '',
          parsedPrediction: {
            action_inputs: {},
            reflection: null,
            action_type: 'user_stop',
            thought: '',
          },
          screenWidth: 0,
          screenHeight: 0,
          scaleFactor: 1,
          factors: [0, 0],
        });
      }

      await onData?.({ data: { ...data, conversations: [] } });

      if (data.status === StatusEnum.ERROR) {
        onError?.({
          data,
          error:
            data.error ||
            new GUIAgentError(
              ErrorStatusEnum.UNKNOWN_ERROR,
              'Unknown error occurred',
            ),
        });
      }

      logger.info(
        `[GUIAgent] >>> totalTokens: ${totalTokens}, totalTime: ${totalTime}, loopCnt: ${loopCnt} <<<`,
      );
    }
  }

  public pause() {
    this.isPaused = true;
    this.resumePromise = new Promise((resolve) => {
      this.resolveResume = resolve;
    });
  }

  public resume() {
    if (this.resolveResume) {
      this.resolveResume();
      this.resumePromise = null;
      this.resolveResume = null;
    }
    this.isPaused = false;
  }

  public stop() {
    this.isStopped = true;
  }

  private buildSystemPrompt() {
    const actionSpaces = (this.operator.constructor as typeof Operator)?.MANUAL
      ?.ACTION_SPACES;

    return actionSpaces == null || actionSpaces.length === 0
      ? SYSTEM_PROMPT
      : SYSTEM_PROMPT_TEMPLATE.replace(
          '{{action_spaces_holder}}',
          actionSpaces.join('\n'),
        );
  }

  private guiAgentErrorParser(
    type: ErrorStatusEnum,
    error?: Error,
  ): GUIAgentError {
    this.logger.error('[GUIAgent] guiAgentErrorParser:', error);

    let parseError = null;

    if (error instanceof InternalServerError) {
      this.logger.error(
        '[GUIAgent] guiAgentErrorParser instanceof InternalServerError.',
      );
      parseError = new GUIAgentError(
        ErrorStatusEnum.MODEL_SERVICE_ERROR,
        error.message,
        error.stack,
      );
    }

    if (!parseError && type === ErrorStatusEnum.REACH_MAXLOOP_ERROR) {
      parseError = new GUIAgentError(
        ErrorStatusEnum.REACH_MAXLOOP_ERROR,
        `Has reached max loop count: ${error?.message || ''}`,
        error?.stack,
      );
    }

    if (!parseError && type === ErrorStatusEnum.SCREENSHOT_RETRY_ERROR) {
      parseError = new GUIAgentError(
        ErrorStatusEnum.SCREENSHOT_RETRY_ERROR,
        `Too many screenshot failures: ${error?.message || ''}`,
        error?.stack,
      );
    }

    if (!parseError && type === ErrorStatusEnum.INVOKE_RETRY_ERROR) {
      parseError = new GUIAgentError(
        ErrorStatusEnum.INVOKE_RETRY_ERROR,
        `Too many model invoke failures: ${error?.message || ''}`,
        error?.stack,
      );
    }

    if (!parseError && type === ErrorStatusEnum.EXECUTE_RETRY_ERROR) {
      parseError = new GUIAgentError(
        ErrorStatusEnum.EXECUTE_RETRY_ERROR,
        `Too many action execute failures: ${error?.message || ''}`,
        error?.stack,
      );
    }

    if (!parseError && type === ErrorStatusEnum.ENVIRONMENT_ERROR) {
      parseError = new GUIAgentError(
        ErrorStatusEnum.ENVIRONMENT_ERROR,
        `The environment error occurred when parsing the action: ${error?.message || ''}`,
        error?.stack,
      );
    }

    if (!parseError) {
      parseError = new GUIAgentError(
        ErrorStatusEnum.UNKNOWN_ERROR,
        error instanceof Error ? error.message : 'Unknown error occurred',
        error instanceof Error ? error.stack || 'null' : 'null',
      );
    }

    if (!parseError.stack) {
      // Avoid guiAgentErrorParser it self in stack trace
      Error.captureStackTrace(parseError, this.guiAgentErrorParser);
    }

    return parseError;
  }

  private generateSessionId(): string {
    return uuidv4();
  }
}
