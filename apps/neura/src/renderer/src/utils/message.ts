/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Conversation } from '@neura-desktop/shared/types';

export const isCallUserMessage = (messages: Conversation[]) => {
  const lastMessage = messages?.[messages?.length - 1];
  const lastPredictionParsed =
    lastMessage?.predictionParsed?.[lastMessage?.predictionParsed?.length - 1];

  return lastPredictionParsed?.action_type === 'call_user';
};
