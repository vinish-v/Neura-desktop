/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Conversation } from '@neura-desktop/shared/types';
import { getState } from '@renderer/hooks/useStore';

import { api } from '@renderer/api';
import { ConversationWithSoM } from '@/main/shared/types';
import { Message } from '@neura-desktop/shared/types';
import type { Operator } from '@/main/store/types';

const filterAndTransformWithMap = (
  history: ConversationWithSoM[],
): Message[] => {
  return history
    .map((conv) => {
      if (conv.from === 'human' && conv.value && conv.value !== '<image>') {
        return {
          from: conv.from,
          value: conv.value,
        };
      } else if (conv.from === 'gpt' && conv.predictionParsed?.length) {
        const finished = conv.predictionParsed.find(
          (p) => p.action_type === 'finished' && p.action_inputs?.content,
        );
        if (finished) {
          return {
            from: conv.from,
            value: finished.action_inputs!.content!,
          };
        }

        const callUser = conv.predictionParsed.find(
          (p) => p.action_type === 'call_user' && p.thought,
        );
        if (callUser) {
          return {
            from: conv.from,
            value: callUser.thought!,
          };
        }
        return undefined;
      } else {
        return undefined;
      }
    })
    .filter((msg): msg is Message => msg !== undefined);
};

export const buildMessagesForRun = ({
  initialMessages,
  currentMessages: _currentMessages,
  history: _history,
}: {
  currentMessages: ConversationWithSoM[];
  initialMessages: Conversation[];
  history: ConversationWithSoM[];
}) => {
  return initialMessages;
};

export const useRunAgent = () => {
  // const dispatch = useDispatch();

  const run = async (
    value: string,
    history: ConversationWithSoM[],
    callback: () => void = () => {},
    displayValue = value,
    _operatorOverride?: Operator,
  ) => {
    const initialMessages: Conversation[] = [
      {
        from: 'human',
        value: displayValue,
        timing: { start: Date.now(), end: Date.now(), cost: 0 },
      },
    ];
    const currentMessages = getState().messages;

    const sessionHistory = filterAndTransformWithMap(history);

    await Promise.all([
      api.setInstructions({ instructions: value }),
      api.setMessages({
        messages: buildMessagesForRun({
          currentMessages,
          initialMessages,
          history,
        }),
      }),
      api.setSessionHistoryMessages({
        messages: sessionHistory,
      }),
    ]);

    await api.runAgent();

    callback();
  };

  const stopAgentRuning = async (callback: () => void = () => {}) => {
    await api.stopRun();
    callback();
  };

  return { run, stopAgentRuning };
};
