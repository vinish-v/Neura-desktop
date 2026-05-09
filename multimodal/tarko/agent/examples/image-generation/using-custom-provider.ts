/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * An example of a basic vision understanding.
 */

import { Agent } from '../../src';

async function main() {
  const agent = new Agent({
    model: {
      provider: 'azure-openai',
      id: 'gpt-image-1',
    },
  });

  const answer = await agent.run({
    input: 'Generate a colorful poster with Neura as the theme',
  });

  console.log(answer);
}

main();
