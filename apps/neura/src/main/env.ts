/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import os from 'node:os';

import dotenv from 'dotenv';

dotenv.config();

export const mode = process.env.NODE_ENV;
export const isProd = mode === 'production';
export const isDev = mode === 'development';
export const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
export const port = process.env.PORT || 1212;
export const startMinimized = process.env.START_MINIMIZED;
export const rendererUrl = process.env.ELECTRON_RENDERER_URL;
export const isE2eTest = process.env.CI === 'e2e';

export const vlmProvider = process.env.VLM_PROVIDER;
export const vlmBaseUrl =
  process.env.VLM_BASE_URL ||
  process.env.NVIDIA_NIM_BASE_URL ||
  'https://integrate.api.nvidia.com/v1';
export const vlmApiKey =
  process.env.VLM_API_KEY ||
  process.env.NVIDIA_API_KEY ||
  process.env.NIM_API_KEY ||
  '';
export const vlmModelName =
  process.env.VLM_MODEL_NAME ||
  process.env.NVIDIA_NIM_MODEL ||
  'meta/llama-3.2-11b-vision-instruct';
export const plannerBaseUrl =
  process.env.PLANNER_BASE_URL || process.env.NVIDIA_NIM_BASE_URL || vlmBaseUrl;
export const plannerApiKey =
  process.env.PLANNER_API_KEY ||
  process.env.NVIDIA_API_KEY ||
  process.env.NIM_API_KEY ||
  vlmApiKey;
export const plannerModelName =
  process.env.PLANNER_MODEL_NAME || 'nvidia/nemotron-3-nano-30b-a3b';

const { platform } = process;
export const isMacOS = platform === 'darwin';

export const isWindows = platform === 'win32';

export const isLinux = platform === 'linux';

/**
 * @see https://learn.microsoft.com/en-us/windows/release-health/windows11-release-information
 * Windows 11 buildNumber starts from 22000.
 */
const detectingWindows11 = () => {
  if (!isWindows) return false;

  const release = os.release();
  const majorVersion = Number.parseInt(release.split('.')[0]);
  const buildNumber = Number.parseInt(release.split('.')[2]);

  return majorVersion === 10 && buildNumber >= 22000;
};

export const isWindows11 = detectingWindows11();
