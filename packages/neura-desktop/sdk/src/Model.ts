/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import OpenAI, { type ClientOptions } from 'openai';
import {
  type ChatCompletionCreateParamsNonStreaming,
  type ChatCompletionCreateParamsBase,
  type ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import { actionParser } from '@neura-desktop/action-parser';

import { useContext } from './context/useContext';
import { Model, type InvokeParams, type InvokeOutput } from './types';
import { MAX_IMAGE_LENGTH } from '@neura-desktop/shared/constants';

import {
  preprocessResizeImage,
  convertToOpenAIMessages,
  convertToResponseApiInput,
  isMessageImage,
} from './utils';
import { DEFAULT_FACTORS } from './constants';
import {
  NeuraModelVersion,
  MAX_PIXELS_V1_0,
  MAX_PIXELS_V1_5,
  MAX_PIXELS_DOUBAO,
} from '@neura-desktop/shared/types';
import type {
  ResponseCreateParamsNonStreaming,
  ResponseInputItem,
} from 'openai/resources/responses/responses';

type OpenAIChatCompletionCreateParams = Omit<ClientOptions, 'maxRetries'> &
  Pick<
    ChatCompletionCreateParamsBase,
    'model' | 'max_tokens' | 'temperature' | 'top_p'
  >;

export interface NeuraModelConfig extends OpenAIChatCompletionCreateParams {
  /** Whether to use OpenAI Response API instead of Chat Completions API */
  useResponsesApi?: boolean;
}

export interface ThinkingVisionProModelConfig
  extends ChatCompletionCreateParamsNonStreaming {
  thinking?: {
    type: 'enabled' | 'disabled';
  };
}

export class NeuraModel extends Model {
  constructor(protected readonly modelConfig: NeuraModelConfig) {
    super();
    this.modelConfig = modelConfig;
  }

  get useResponsesApi(): boolean {
    return this.modelConfig.useResponsesApi ?? false;
  }
  private headImageContext: {
    messageIndex: number;
    responseIds: string[];
  } | null = null;

  /** [widthFactor, heightFactor] */
  get factors(): [number, number] {
    return DEFAULT_FACTORS;
  }

  get modelName(): string {
    return this.modelConfig.model ?? 'unknown';
  }

  get maxImageLength(): number {
    const model = this.modelConfig.model ?? '';
    const baseURL = this.modelConfig.baseURL ?? '';
    if (
      /llama-3\.2-.*vision/i.test(model) ||
      /integrate\.api\.nvidia\.com/i.test(baseURL)
    ) {
      return 1;
    }
    return MAX_IMAGE_LENGTH;
  }

  /**
   * reset the model state
   */
  reset() {
    this.headImageContext = null;
  }

  /**
   * call real LLM / VLM Model
   * @param params
   * @param options
   * @returns
   */
  protected async invokeModelProvider(
    neuraModelVersion: NeuraModelVersion = NeuraModelVersion.V1_0,
    params: {
      messages: Array<ChatCompletionMessageParam>;
      previousResponseId?: string;
    },
    options: {
      signal?: AbortSignal;
    },
    headers?: Record<string, string>,
  ): Promise<{
    prediction: string;
    costTime?: number;
    costTokens?: number;
    responseId?: string;
  }> {
    const { logger } = useContext();
    const { messages, previousResponseId } = params;
    const {
      baseURL,
      apiKey,
      model,
      max_tokens = neuraModelVersion == NeuraModelVersion.V1_5 ? 65535 : 1000,
      temperature = 0,
      top_p = 0.7,
      ...restOptions
    } = this.modelConfig;
    const requestTimeout =
      typeof restOptions.timeout === 'number' ? restOptions.timeout : 90_000;

    const openai = new OpenAI({
      ...restOptions,
      maxRetries: 0,
      baseURL,
      apiKey,
    });

    const createCompletionPrams: ChatCompletionCreateParamsNonStreaming = {
      model,
      messages,
      stream: false,
      seed: null,
      stop: null,
      frequency_penalty: null,
      presence_penalty: null,
      // custom options
      max_tokens,
      temperature,
      top_p,
    };

    const shouldSendThinkingControl =
      typeof model === 'string' && /doubao|thinking-vision/i.test(model);

    const createCompletionPramsForModel:
      | ChatCompletionCreateParamsNonStreaming
      | ThinkingVisionProModelConfig = shouldSendThinkingControl
      ? {
          ...createCompletionPrams,
          thinking: {
            type: 'disabled',
          },
        }
      : createCompletionPrams;

    const startTime = Date.now();

    if (this.modelConfig.useResponsesApi) {
      const lastAssistantIndex = messages.findLastIndex(
        (c) => c.role === 'assistant',
      );
      logger.info('[ResponseAPI] lastAssistantIndex: ', lastAssistantIndex);
      // incremental messages
      const inputs = convertToResponseApiInput(
        lastAssistantIndex > -1
          ? messages.slice(lastAssistantIndex + 1)
          : messages,
      );

      // find the first image message
      const headImageMessageIndex = messages.findIndex(isMessageImage);
      if (
        this.headImageContext?.responseIds.length &&
        this.headImageContext?.messageIndex !== headImageMessageIndex
      ) {
        // The image window has slid. Delete the first image message.
        logger.info(
          '[ResponseAPI] should [delete]: ',
          this.headImageContext,
          'headImageMessageIndex',
          headImageMessageIndex,
        );
        const headImageResponseId = this.headImageContext.responseIds.shift();

        if (headImageResponseId) {
          const deletedResponse = await openai.responses.delete(
            headImageResponseId,
            {
              headers,
            },
          );
          logger.info(
            '[ResponseAPI] [deletedResponse]: ',
            headImageResponseId,
            deletedResponse,
          );
        }
      }

      let result;
      let responseId = previousResponseId;
      for (const input of inputs) {
        const truncated = JSON.stringify(
          [input],
          (key, value) => {
            if (typeof value === 'string' && value.startsWith('data:image/')) {
              return value.slice(0, 50) + '...[truncated]';
            }
            return value;
          },
          2,
        );
        const responseParams: ResponseCreateParamsNonStreaming = {
          input: [input],
          model,
          temperature,
          top_p,
          stream: false,
          max_output_tokens: max_tokens,
          ...(responseId && {
            previous_response_id: responseId,
          }),
          // @ts-expect-error
          thinking: {
            type: 'disabled',
          },
        };
        logger.info(
          '[ResponseAPI] [input]: ',
          truncated,
          'previous_response_id',
          responseParams?.previous_response_id,
          'headImageMessageIndex',
          headImageMessageIndex,
        );

        result = await openai.responses.create(responseParams, {
          ...options,
          timeout: requestTimeout,
          headers,
        });
        logger.info('[ResponseAPI] [result]: ', result);
        responseId = result?.id;
        logger.info('[ResponseAPI] [responseId]: ', responseId);

        // head image changed
        if (responseId && isMessageImage(input)) {
          this.headImageContext = {
            messageIndex: headImageMessageIndex,
            responseIds: [
              ...(this.headImageContext?.responseIds || []),
              responseId,
            ],
          };
        }

        logger.info(
          '[ResponseAPI] [headImageContext]: ',
          this.headImageContext,
        );
      }

      return {
        prediction: result?.output_text ?? '',
        costTime: Date.now() - startTime,
        costTokens: result?.usage?.total_tokens ?? 0,
        responseId,
      };
    }

    // Use Chat Completions API if not using Response API
    const result = await openai.chat.completions.create(
      createCompletionPramsForModel,
      {
        ...options,
        timeout: requestTimeout,
        headers,
      },
    );

    return {
      prediction: result.choices?.[0]?.message?.content ?? '',
      costTime: Date.now() - startTime,
      costTokens: result.usage?.total_tokens ?? 0,
    };
  }

  async invoke(params: InvokeParams): Promise<InvokeOutput> {
    const {
      conversations,
      images,
      screenContext,
      scaleFactor,
      neuraModelVersion,
      headers,
      previousResponseId,
    } = params;
    const { logger, signal } = useContext();

    logger?.info(
      `[NeuraModel] invoke: screenContext=${JSON.stringify(screenContext)}, scaleFactor=${scaleFactor}, neuraModelVersion=${neuraModelVersion}, useResponsesApi=${this.modelConfig.useResponsesApi}`,
    );

    const modelName = this.modelConfig.model ?? '';
    const baseURL = this.modelConfig.baseURL ?? '';
    const isNvidiaVisionModel =
      /llama-3\.2-.*vision/i.test(modelName) ||
      /integrate\.api\.nvidia\.com/i.test(baseURL);
    const maxPixels = isNvidiaVisionModel
      ? 672 * 672
      : neuraModelVersion === NeuraModelVersion.V1_5
        ? MAX_PIXELS_V1_5
        : neuraModelVersion === NeuraModelVersion.DOUBAO_1_5_15B ||
            neuraModelVersion === NeuraModelVersion.DOUBAO_1_5_20B
          ? MAX_PIXELS_DOUBAO
          : MAX_PIXELS_V1_0;
    const compressedImages = await Promise.all(
      images.map((image) => preprocessResizeImage(image, maxPixels)),
    );

    const messages = convertToOpenAIMessages({
      conversations,
      images: compressedImages,
    });

    const startTime = Date.now();
    const result = await this.invokeModelProvider(
      neuraModelVersion,
      {
        messages,
        previousResponseId,
      },
      {
        signal,
      },
      headers,
    )
      .catch((e) => {
        logger?.error('[NeuraModel] error', e);
        throw e;
      })
      .finally(() => {
        logger?.info(`[NeuraModel cost]: ${Date.now() - startTime}ms`);
      });

    if (!result.prediction) {
      const err = new Error();
      err.name = 'vlm response error';
      err.stack = JSON.stringify(result) ?? 'no message';
      logger?.error(err);
      throw err;
    }

    const { prediction, costTime, costTokens, responseId } = result;

    try {
      const { parsed: parsedPredictions } = actionParser({
        prediction,
        factor: this.factors,
        screenContext,
        scaleFactor,
        modelVer: neuraModelVersion,
      });
      return {
        prediction,
        parsedPredictions,
        costTime,
        costTokens,
        responseId,
      };
    } catch (error) {
      logger?.error('[NeuraModel] error', error);
      return {
        prediction,
        parsedPredictions: [],
        responseId,
      };
    }
  }

  async invokeText(params: {
    messages: Array<ChatCompletionMessageParam>;
    neuraModelVersion?: NeuraModelVersion;
    headers?: Record<string, string>;
    previousResponseId?: string;
  }): Promise<{
    prediction: string;
    costTime?: number;
    costTokens?: number;
    responseId?: string;
  }> {
    const { logger, signal } = useContext();
    const startTime = Date.now();

    const result = await this.invokeModelProvider(
      params.neuraModelVersion,
      {
        messages: params.messages,
        previousResponseId: params.previousResponseId,
      },
      {
        signal,
      },
      params.headers,
    )
      .catch((e) => {
        logger?.error('[NeuraModel] text invoke error', e);
        throw e;
      })
      .finally(() => {
        logger?.info(`[NeuraModel text cost]: ${Date.now() - startTime}ms`);
      });

    return result;
  }
}
