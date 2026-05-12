/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import ElectronStore from 'electron-store';
import yaml from 'js-yaml';

import * as env from '@main/env';
import { logger } from '@main/logger';
import {
  createDefaultNeuraRoadmap,
  normalizeNeuraRoadmap,
} from '@main/services/neuraRoadmap';

import {
  LocalStore,
  SearchEngineForSettings,
  VLMProviderV2,
  Operator,
} from './types';
import { validatePreset } from './validate';
import { BrowserWindow } from 'electron';

export const DEFAULT_SETTING: LocalStore = {
  language: 'en',
  vlmProvider: (env.vlmProvider as VLMProviderV2) || VLMProviderV2.nvidia_nim,
  vlmBaseUrl: env.vlmBaseUrl || 'https://integrate.api.nvidia.com/v1',
  vlmApiKey: env.vlmApiKey || '',
  vlmModelName: env.vlmModelName || 'meta/llama-3.2-11b-vision-instruct',
  useResponsesApi: false,
  usePlannerModel: true,
  plannerBaseUrl: env.plannerBaseUrl || 'https://integrate.api.nvidia.com/v1',
  plannerApiKey: env.plannerApiKey || '',
  plannerModelName: env.plannerModelName || 'nvidia/nemotron-3-nano-30b-a3b',
  modelTimeoutInMs: 240_000,
  plannerTimeoutInMs: 90_000,
  maxLoopCount: 100,
  loopIntervalInMs: 1000,
  searchEngineForBrowser: SearchEngineForSettings.GOOGLE,
  operator: Operator.LocalComputer,
  reportStorageBaseUrl: '',
  utioBaseUrl: '',
  agentMemory: {
    preferences: {},
    updatedAt: Date.now(),
  },
  taskRuns: [],
  neuraRoadmap: createDefaultNeuraRoadmap(),
  connectors: [
    {
      id: 'github',
      displayName: 'GitHub',
      type: 'builtin',
      enabled: false,
      authState: 'not_configured',
      permissionLevel: 'write',
      tools: ['connector_github_issue', 'connector_github_export'],
      config: {
        token: '',
        repository: '',
        apiBase: 'https://api.github.com',
      },
    },
    {
      id: 'slack_webhook',
      displayName: 'Slack Webhook',
      type: 'webhook',
      enabled: false,
      authState: 'not_configured',
      permissionLevel: 'write',
      tools: ['connector_slack_post'],
    },
    {
      id: 'google_drive_export',
      displayName: 'Google Drive Export',
      type: 'export',
      enabled: false,
      authState: 'not_configured',
      permissionLevel: 'write',
      tools: ['connector_drive_export'],
    },
    {
      id: 'custom_mcp',
      displayName: 'Custom MCP Server',
      type: 'mcp',
      enabled: false,
      authState: 'not_configured',
      permissionLevel: 'write',
      tools: ['connector_mcp_call'],
      config: {
        command: '',
        args: '',
        env: '',
      },
    },
  ],
  multimodalProviders: {},
};

const firstNonEmptyString = (...values: Array<unknown>): string => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return '';
};

const normalizeSettingStore = (state: Partial<LocalStore>): LocalStore => {
  const merged = {
    ...DEFAULT_SETTING,
    ...state,
  } as LocalStore;

  merged.language = merged.language || DEFAULT_SETTING.language;
  merged.vlmProvider = merged.vlmProvider || DEFAULT_SETTING.vlmProvider;
  merged.vlmBaseUrl = firstNonEmptyString(
    merged.vlmBaseUrl,
    DEFAULT_SETTING.vlmBaseUrl,
  );
  merged.vlmApiKey = firstNonEmptyString(
    merged.vlmApiKey,
    env.vlmApiKey,
    DEFAULT_SETTING.vlmApiKey,
  );
  merged.vlmModelName = firstNonEmptyString(
    merged.vlmModelName,
    DEFAULT_SETTING.vlmModelName,
  );
  merged.useResponsesApi = merged.useResponsesApi ?? false;
  merged.usePlannerModel = merged.usePlannerModel ?? true;
  merged.plannerBaseUrl = firstNonEmptyString(
    merged.plannerBaseUrl,
    merged.vlmBaseUrl,
    DEFAULT_SETTING.plannerBaseUrl,
  );
  merged.plannerApiKey = firstNonEmptyString(
    merged.plannerApiKey,
    env.plannerApiKey,
  );
  merged.plannerModelName = firstNonEmptyString(
    merged.plannerModelName,
    DEFAULT_SETTING.plannerModelName,
  );
  merged.modelTimeoutInMs =
    merged.modelTimeoutInMs || DEFAULT_SETTING.modelTimeoutInMs;
  merged.plannerTimeoutInMs =
    merged.plannerTimeoutInMs || DEFAULT_SETTING.plannerTimeoutInMs;
  merged.maxLoopCount = merged.maxLoopCount || DEFAULT_SETTING.maxLoopCount;
  merged.loopIntervalInMs =
    merged.loopIntervalInMs ?? DEFAULT_SETTING.loopIntervalInMs;
  merged.searchEngineForBrowser =
    merged.searchEngineForBrowser || DEFAULT_SETTING.searchEngineForBrowser;
  merged.operator = merged.operator || DEFAULT_SETTING.operator;
  merged.reportStorageBaseUrl = merged.reportStorageBaseUrl || '';
  merged.utioBaseUrl = merged.utioBaseUrl || '';
  merged.agentMemory = merged.agentMemory || DEFAULT_SETTING.agentMemory;
  merged.taskRuns = Array.isArray(merged.taskRuns) ? merged.taskRuns : [];
  merged.neuraRoadmap = normalizeNeuraRoadmap(merged.neuraRoadmap);
  merged.connectors = Array.isArray(merged.connectors)
    ? merged.connectors
    : DEFAULT_SETTING.connectors;
  merged.multimodalProviders = merged.multimodalProviders || {};

  return merged;
};

const redactSettingsForLog = (settings: unknown): unknown => {
  if (!settings || typeof settings !== 'object') {
    return settings;
  }

  const clone = { ...(settings as Record<string, unknown>) };
  if (typeof clone.vlmApiKey === 'string' && clone.vlmApiKey.length > 0) {
    clone.vlmApiKey = '[redacted]';
  }
  if (
    typeof clone.plannerApiKey === 'string' &&
    clone.plannerApiKey.length > 0
  ) {
    clone.plannerApiKey = '[redacted]';
  }
  return clone;
};

export class SettingStore {
  private static instance: ElectronStore<LocalStore>;

  public static getInstance(): ElectronStore<LocalStore> {
    if (!SettingStore.instance) {
      SettingStore.instance = new ElectronStore<LocalStore>({
        name: 'neura.setting',
        defaults: DEFAULT_SETTING,
      });

      SettingStore.instance.onDidAnyChange((newValue, oldValue) => {
        logger.log(
          `SettingStore: ${JSON.stringify(redactSettingsForLog(oldValue))} changed to ${JSON.stringify(redactSettingsForLog(newValue))}`,
        );
        // Notify that value updated
        BrowserWindow.getAllWindows().forEach((win) => {
          win.webContents.send('setting-updated', newValue);
        });
      });
    }
    return SettingStore.instance;
  }

  public static set<K extends keyof LocalStore>(
    key: K,
    value: LocalStore[K],
  ): void {
    SettingStore.getInstance().set(key, value);
  }

  public static setStore(state: Partial<LocalStore>): void {
    const current = SettingStore.getInstance().store;
    SettingStore.getInstance().set(
      normalizeSettingStore({ ...current, ...state }),
    );
  }

  public static get<K extends keyof LocalStore>(key: K): LocalStore[K] {
    return SettingStore.getInstance().get(key);
  }

  public static remove<K extends keyof LocalStore>(key: K): void {
    SettingStore.getInstance().delete(key);
  }

  public static getStore(): LocalStore {
    const normalized = normalizeSettingStore(SettingStore.getInstance().store);
    SettingStore.getInstance().set(normalized);
    return normalized;
  }

  public static clear(): void {
    SettingStore.getInstance().set(DEFAULT_SETTING);
  }

  public static openInEditor(): void {
    SettingStore.getInstance().openInEditor();
  }

  public static async importPresetFromUrl(
    url: string,
    autoUpdate = false,
  ): Promise<void> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch preset: ${response.status}`);
      }

      const yamlText = await response.text();
      const preset = yaml.load(yamlText);
      const validatedPreset = validatePreset(preset);

      SettingStore.setStore({
        ...validatedPreset,
        presetSource: {
          type: 'remote',
          url,
          autoUpdate,
          lastUpdated: Date.now(),
        },
      });
    } catch (error) {
      logger.error(error);
      throw new Error(
        `Failed to import preset: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  public static async importPresetFromText(
    yamlContent: string,
  ): Promise<LocalStore> {
    try {
      const settings = await parsePresetYaml(yamlContent);
      return settings;
    } catch (error) {
      logger.error('Failed to import preset from text:', error);
      throw error;
    }
  }

  public static async fetchPresetFromUrl(url: string): Promise<LocalStore> {
    try {
      const response = await fetch(url);
      const yamlContent = await response.text();
      return await this.importPresetFromText(yamlContent);
    } catch (error) {
      logger.error('Failed to fetch preset from URL:', error);
      throw error;
    }
  }
}

async function parsePresetYaml(yamlContent: string): Promise<LocalStore> {
  const preset = yaml.load(yamlContent);
  const validatedPreset = validatePreset(preset);
  return validatedPreset;
}
