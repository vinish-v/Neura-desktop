/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { EventPayload, EventType } from './types';

export type { EventPayload as UTIOPayload };

/**
 * UTIO (Neura Insights and Observation) is a data collection mechanism
 * for insights into Neura Desktop,
 */
export class UTIO {
  constructor(private readonly endpoint: string) {}

  async send<T extends EventType>(data: EventPayload<T>): Promise<void> {
    if (!this.endpoint) return;

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(`UTIO upload failed with status: ${response.status}`);
      }
    } catch (error) {
      // Silent fail
    }
  }
}
