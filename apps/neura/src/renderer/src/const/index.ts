/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Operator } from '@main/store/types';

export const COMPUTER_OPERATOR = 'Computer Operator';
export const BROWSER_OPERATOR = 'Browser Operator';

export const OPERATOR_URL_MAP = {
  [Operator.RemoteComputer]: {
    text: 'Optional only: use a hosted Computer Operator only if you already want remote infrastructure. Neura core work is local-first.',
    url: 'https://console.volcengine.com/vefaas/region:vefaas+cn-beijing/application/create?templateId=680b0a890e881f000862d9f0&channel=github&source=neura',
  },
  [Operator.RemoteBrowser]: {
    text: 'Optional only: use a hosted Browser Operator only if you already want remote infrastructure. Neura core work is local-first.',
    url: 'https://console.volcengine.com/vefaas/region:vefaas+cn-beijing/application/create?templateId=67f7b4678af5a6000850556c&channel=github&source=neura',
  },
};
