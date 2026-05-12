/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import type { SkillDefinition, SkillMetadata } from './types';

const NAME_PATTERN = /^[a-z0-9][a-z0-9-_.]{1,80}$/i;

const ensureString = (
  value: unknown,
  field: string,
  sourcePath?: string,
): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(
      `Invalid skill ${field}${sourcePath ? ` in ${sourcePath}` : ''}`,
    );
  }
  return value.trim();
};

export const skillSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

export const validateSkillDefinition = (
  input: unknown,
  sourcePath?: string,
): SkillDefinition => {
  if (!input || typeof input !== 'object') {
    throw new Error(
      `Skill must be an object${sourcePath ? `: ${sourcePath}` : ''}`,
    );
  }

  const record = input as Record<string, unknown>;
  const name = skillSlug(ensureString(record.name, 'name', sourcePath));
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid skill name "${name}"${sourcePath ? ` in ${sourcePath}` : ''}`,
    );
  }

  const tools = Array.isArray(record.tools)
    ? record.tools
        .map((tool) => {
          if (typeof tool === 'string') {
            return tool.trim();
          }
          if (tool && typeof tool === 'object') {
            const toolRecord = tool as Record<string, unknown>;
            const toolName = ensureString(
              toolRecord.name,
              'tool.name',
              sourcePath,
            );
            return {
              name: toolName,
              serverName:
                typeof toolRecord.serverName === 'string'
                  ? toolRecord.serverName.trim()
                  : undefined,
            };
          }
          return '';
        })
        .filter(Boolean)
    : [];

  return {
    name,
    description: ensureString(record.description, 'description', sourcePath),
    instructions: ensureString(record.instructions, 'instructions', sourcePath),
    tools,
    chains: Array.isArray(record.chains)
      ? record.chains.map(String).map(skillSlug).filter(Boolean)
      : [],
    examples: Array.isArray(record.examples)
      ? record.examples
          .map((example) => {
            if (!example || typeof example !== 'object') {
              return null;
            }
            const exampleRecord = example as Record<string, unknown>;
            const inputValue =
              typeof exampleRecord.input === 'string'
                ? exampleRecord.input.trim()
                : '';
            if (!inputValue) {
              return null;
            }
            return {
              input: inputValue,
              output:
                typeof exampleRecord.output === 'string'
                  ? exampleRecord.output
                  : undefined,
              notes:
                typeof exampleRecord.notes === 'string'
                  ? exampleRecord.notes
                  : undefined,
            };
          })
          .filter((example): example is NonNullable<typeof example> =>
            Boolean(example),
          )
      : [],
    tags: Array.isArray(record.tags)
      ? record.tags.map(String).filter(Boolean)
      : [],
    version: typeof record.version === 'string' ? record.version : '1.0.0',
    author: typeof record.author === 'string' ? record.author : 'Neura',
    createdAt:
      typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
    updatedAt:
      typeof record.updatedAt === 'number' ? record.updatedAt : Date.now(),
  };
};

export const toSkillMetadata = (
  skill: SkillDefinition,
  sourcePath?: string,
): SkillMetadata => {
  const { instructions: _instructions, examples, ...metadata } = skill;
  return {
    ...metadata,
    examplesCount: examples?.length || 0,
    sourcePath,
  };
};

export const loadSkillFromFile = async (filePath: string) => {
  const raw = await fs.readFile(filePath, 'utf8');
  return validateSkillDefinition(JSON.parse(raw), filePath);
};

export const saveSkillToFile = async (
  directory: string,
  skill: SkillDefinition,
) => {
  const validated = validateSkillDefinition(skill);
  await fs.mkdir(directory, { recursive: true });
  const outputPath = path.join(directory, `${validated.name}.json`);
  await fs.writeFile(
    outputPath,
    `${JSON.stringify({ ...validated, updatedAt: Date.now() }, null, 2)}\n`,
    'utf8',
  );
  return outputPath;
};
