/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  loadSkillFromFile,
  saveSkillToFile,
  skillSlug,
  toSkillMetadata,
  validateSkillDefinition,
} from './skill-loader';
import type { SkillDefinition, SkillMetadata } from './types';

type CachedSkill = {
  definition: SkillDefinition;
  sourcePath: string;
};

export type SkillsRegistryOptions = {
  directories: string[];
};

export class SkillsRegistry {
  private cache = new Map<string, CachedSkill>();
  private loaded = false;

  constructor(private readonly options: SkillsRegistryOptions) {}

  private async findSkillFiles(directory: string) {
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => path.join(directory, entry.name));
    } catch {
      return [];
    }
  }

  async refresh() {
    const nextCache = new Map<string, CachedSkill>();
    for (const directory of this.options.directories) {
      const files = await this.findSkillFiles(directory);
      for (const file of files) {
        try {
          const definition = await loadSkillFromFile(file);
          nextCache.set(definition.name, {
            definition,
            sourcePath: file,
          });
        } catch {
          // Skip invalid skills so one broken file does not disable the registry.
        }
      }
    }
    this.cache = nextCache;
    this.loaded = true;
    return this.list();
  }

  private async ensureLoaded() {
    if (!this.loaded) {
      await this.refresh();
    }
  }

  async list(): Promise<SkillMetadata[]> {
    await this.ensureLoaded();
    return [...this.cache.values()]
      .map((entry) => toSkillMetadata(entry.definition, entry.sourcePath))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(name: string): Promise<SkillDefinition | null> {
    await this.ensureLoaded();
    return this.cache.get(skillSlug(name))?.definition || null;
  }

  async save(skill: SkillDefinition, directory = this.options.directories[0]) {
    const validated = validateSkillDefinition(skill);
    const outputPath = await saveSkillToFile(directory, validated);
    this.cache.set(validated.name, {
      definition: validated,
      sourcePath: outputPath,
    });
    this.loaded = true;
    return toSkillMetadata(validated, outputPath);
  }

  async delete(name: string) {
    await this.ensureLoaded();
    const key = skillSlug(name);
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }
    await fs.rm(entry.sourcePath, { force: true });
    this.cache.delete(key);
    return true;
  }
}
