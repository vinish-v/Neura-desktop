/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { ConsoleLogger } from '@agent-infra/logger';
import { DuckDuckGoSearchClient } from '../src';

async function runExample() {
  const logger = new ConsoleLogger('[DuckduckgoSearch]');
  try {
    const client = new DuckDuckGoSearchClient();
    const searchResults = await client.search({
      query: 'Neura',
      count: 5,
      retry: {
        retries: 3,
        randomize: true,
      },
    });

    console.log(JSON.stringify(searchResults, null, 2));
    console.log(`Found ${searchResults.results.length || 0} results`);
  } catch (error) {
    console.error('Search with options failed:', error);
  }
}

if (require.main === module) {
  runExample().catch(console.error);
}
