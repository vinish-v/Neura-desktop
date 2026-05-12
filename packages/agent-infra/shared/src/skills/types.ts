/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */

export type SkillExample = {
  input: string;
  output?: string;
  notes?: string;
};

export type SkillToolRef = {
  serverName?: string;
  name: string;
};

export type SkillDefinition = {
  name: string;
  description: string;
  instructions: string;
  tools?: Array<string | SkillToolRef>;
  chains?: string[];
  examples?: SkillExample[];
  tags?: string[];
  version?: string;
  author?: string;
  createdAt?: number;
  updatedAt?: number;
};

export type SkillMetadata = Omit<
  SkillDefinition,
  'instructions' | 'examples'
> & {
  examplesCount: number;
  sourcePath?: string;
};

export type SkillRunInput = {
  skillName: string;
  arguments?: Record<string, unknown>;
  goal?: string;
  depth?: number;
};

export type SkillRunResult = {
  skillName: string;
  output: string;
  usedSkills: string[];
};
