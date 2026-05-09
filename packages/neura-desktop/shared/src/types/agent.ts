/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
export interface Message {
  from: 'gpt' | 'human';
  value: string; // <image>
  domText?: string;
}

export enum ErrorStatusEnum {
  /** 100000 */
  SCREENSHOT_RETRY_ERROR = -100000,
  /** 100001 */
  INVOKE_RETRY_ERROR = -100001,
  /** 100002 */
  EXECUTE_RETRY_ERROR = -100002,
  /** 100003 */
  MODEL_SERVICE_ERROR = -100003,
  /** 100004 */
  REACH_MAXLOOP_ERROR = -100004,
  /** 100005 */
  ENVIRONMENT_ERROR = -100005,
  /** 100099 */
  UNKNOWN_ERROR = -100099,
}

export class GUIAgentError extends Error {
  status: ErrorStatusEnum;
  message: string;
  stack?: string;

  constructor(status: ErrorStatusEnum, message: string, stack?: string) {
    super(message);
    this.status = status;
    this.message = message;
    this.stack = stack;
  }
}

export type Status = `${StatusEnum}`;
export enum StatusEnum {
  INIT = 'init',
  RUNNING = 'running',
  PAUSE = 'pause',
  END = 'end',
  CALL_USER = 'call_user',
  /**
   * @deprecated kept for backward compatibility
   */
  MAX_LOOP = 'max_loop',
  USER_STOPPED = 'user_stopped',
  ERROR = 'error',
}
export interface VlmResponse {
  generate_resp: {
    input: string;
    prediction: string;
    uid: string;
  }[];
}

export interface ScreenshotResult {
  /** screenshot base64, `keep screenshot size as physical pixels` */
  base64: string;
  /** screenshot scale factor(DPR), physical_pixels = logical_resolution * scaleFactor */
  scaleFactor: number;
  /** visible browser element map for DOM-first browser actions */
  domText?: string;
}

export type Coords = [number, number] | [];
export type ActionInputs = Partial<{
  content: string;
  start_box: string;
  end_box: string;
  key: string;
  hotkey: string;
  direction: string;
  element_id: string;
  command: string;
  cwd: string;
  path: string;
  paths: string;
  output_path: string;
  format: string;
  query: string;
  selector: string;
  overwrite: string;
  process_id: string;
  monitor_id: string;
  interval_minutes: string;
  watch: string;
  notify_on: string;
  url: string;
  full_page: string;
  title: string;
  prompt: string;
  text: string;
  voice: string;
  image_path: string;
  asset_path: string;
  repository: string;
  target_path: string;
  message: string;
  tool: string;
  payload: string;
  install: string;
  start_coords: Coords;
  end_coords: Coords;
}>;

export interface PredictionParsed {
  /** `<action_inputs>` parsed from action_type(`action_inputs`) */
  action_inputs: ActionInputs;
  /** `<reflection>` parsed from Reflection: `<reflection>` */
  reflection: string | null;
  /** `<action_type>` parsed from `<action_type>`(action_inputs) */
  action_type: string;
  /** `<thought>` parsed from Thought: `<thought>` */
  thought: string;
}
