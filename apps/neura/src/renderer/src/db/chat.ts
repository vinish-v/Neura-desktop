/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
// /apps/neura/src/renderer/src/db/chat.ts
import { get, set, del, createStore } from 'idb-keyval';
import { ConversationWithSoM } from '@/main/shared/types';

export interface ChatMetaInfo {
  [key: string]: any;
}

const DBName = 'neura_db_chat';
const chatStore = createStore(DBName, 'chats');

export class ChatManager {
  async createSessionMessages(
    sessionId: string,
    messages: ConversationWithSoM[],
  ) {
    await set(sessionId, messages, chatStore);
    return messages;
  }

  async updateSessionMessages(
    sessionId: string,
    messages: ConversationWithSoM[],
  ) {
    await set(sessionId, messages, chatStore);

    return messages;
  }

  // 获取会话的所有消息
  async getSessionMessages(sessionId: string) {
    return get<ConversationWithSoM[]>(sessionId, chatStore);
  }

  // 删除会话相关的所有消息
  async deleteSessionMessages(sessionId: string) {
    await del(sessionId, chatStore);

    return true;
  }
}

export const chatManager = new ChatManager();
