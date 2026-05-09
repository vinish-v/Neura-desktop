/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */

// FIXME: using defineConfig
export default {
  model: {
    provider: 'openai-non-streaming',
    baseURL: process.env.OMNI_TARS_BASE_URL,
    apiKey: process.env.OMNI_TARS_API_KEY, // secretlint-disable-line
    id: process.env.OMNI_TARS_MODEL_ID,
    neuraModelVersion: 'neura-desktop-1.5',
  },
  webui: {
    logo: 'https://lf3-static.bytednsdoc.com/obj/eden-cn/zyha-aulnh/ljhwZthlaukjlkulzlp/appicon.png',
    subtitle: 'Offering seamless integration with a wide range of real-world tools.',
    welcomTitle: 'A multimodal AI agent',
    welcomePrompts: [
      'Search for the latest GUI Agent papers',
      'Find information about Neura',
      'Tell me the top 5 most popular projects on ProductHunt today',
      'Please book me the earliest flight from Hangzhou to Shenzhen on 10.1',
      'What is Agent TARS',
    ],
  },
};
