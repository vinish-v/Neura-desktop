/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import * as shareController from '../controllers/share';

/**
 * Register sharing-related routes
 * @param app Express application
 */
export function registerShareRoutes(app: express.Application): void {
  // Get share configuration
  app.get('/api/v1/share/config', shareController.getShareConfig);
}
