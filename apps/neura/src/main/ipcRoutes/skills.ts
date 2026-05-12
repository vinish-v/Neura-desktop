/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { initIpc } from '@neura-desktop/electron-ipc/main';
import type { SkillDefinition } from '@agent-infra/shared';

import { SkillsService } from '@main/services/skills-service';

const t = initIpc.create();

export const skillsRoute = t.router({
  listSkills: t.procedure.input<void>().handle(async () => {
    return SkillsService.getInstance().list();
  }),
  getSkill: t.procedure.input<{ name: string }>().handle(async ({ input }) => {
    return SkillsService.getInstance().get(input.name);
  }),
  saveSkill: t.procedure.input<SkillDefinition>().handle(async ({ input }) => {
    return SkillsService.getInstance().save(input);
  }),
  deleteSkill: t.procedure
    .input<{ name: string }>()
    .handle(async ({ input }) => {
      return SkillsService.getInstance().delete(input.name);
    }),
  executeSkill: t.procedure
    .input<{
      name: string;
      arguments?: Record<string, unknown>;
      goal?: string;
    }>()
    .handle(async ({ input }) => {
      return SkillsService.getInstance().execute(input);
    }),
  saveRunAsSkill: t.procedure
    .input<{ runId: string }>()
    .handle(async ({ input }) => {
      return SkillsService.getInstance().generateFromRun(input.runId);
    }),
});
