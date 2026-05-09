import { NeuraModelVersion } from '@neura-desktop/shared/constants';
import {
  Operator,
  SearchEngineForSettings,
  VLMProviderV2,
} from '../store/types';
import {
  getSystemPrompt,
  getSystemPromptDoubao_15_15B,
  getSystemPromptDoubao_15_20B,
  getSystemPromptV1_5,
} from '../agent/prompts';
import { showMainWindow } from '../window';
import { SearchEngine } from '@neura-desktop/operator-browser';

export const getModelVersion = (
  provider: VLMProviderV2 | undefined,
): NeuraModelVersion => {
  switch (provider) {
    case VLMProviderV2.nvidia_nim:
      return NeuraModelVersion.V1_5;
    case VLMProviderV2.neura_1_5:
      return NeuraModelVersion.V1_5;
    case VLMProviderV2.neura_1_0:
      return NeuraModelVersion.V1_0;
    case VLMProviderV2.doubao_1_5:
      return NeuraModelVersion.DOUBAO_1_5_15B;
    case VLMProviderV2.doubao_1_5_vl:
      return NeuraModelVersion.DOUBAO_1_5_20B;
    default:
      return NeuraModelVersion.V1_0;
  }
};

export const getSpByModelVersion = (
  modelVersion: NeuraModelVersion,
  language: 'zh' | 'en',
  operatorType: 'browser' | 'computer',
) => {
  switch (modelVersion) {
    case NeuraModelVersion.DOUBAO_1_5_20B:
      return getSystemPromptDoubao_15_20B(language, operatorType);
    case NeuraModelVersion.DOUBAO_1_5_15B:
      return getSystemPromptDoubao_15_15B(language);
    case NeuraModelVersion.V1_5:
      return getSystemPromptV1_5(language, 'normal', operatorType);
    default:
      return getSystemPrompt(language);
  }
};

export const getLocalBrowserSearchEngine = (
  engine?: SearchEngineForSettings,
) => {
  return (engine || SearchEngineForSettings.GOOGLE) as unknown as SearchEngine;
};

export const beforeAgentRun = async (operator: Operator) => {
  switch (operator) {
    case Operator.RemoteComputer:
      break;
    case Operator.RemoteBrowser:
      break;
    case Operator.LocalComputer:
      break;
    case Operator.LocalBrowser:
      break;
    default:
      break;
  }
};

export const afterAgentRun = (operator: Operator) => {
  switch (operator) {
    case Operator.RemoteComputer:
      break;
    case Operator.RemoteBrowser:
      break;
    case Operator.LocalComputer:
      showMainWindow();
      break;
    case Operator.LocalBrowser:
      showMainWindow();
      break;
    default:
      break;
  }
};
