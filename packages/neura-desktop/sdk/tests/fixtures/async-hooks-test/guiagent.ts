/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { ConfigContext, setCurrentInstance } from './context';

export class GUIAgent {
  private o: any;

  constructor(options: { config: Record<string, any>; o: any }) {
    this.o = options.o;
    ConfigContext.getInstance().setConfig(this, options.config);
    this.initialize();
  }

  private async initialize() {
    setCurrentInstance(this);
    await this.o.fn();
  }
}
