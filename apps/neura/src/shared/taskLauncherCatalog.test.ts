import { describe, expect, it } from 'vitest';

import { classifyUserIntent } from './intentClassification';
import { MANUS_STYLE_LAUNCHER_TASKS } from './taskLauncherCatalog';

const expectedTaskTypes = {
  create_slides: 'slide_creation',
  build_website: 'website_build',
  develop_app: 'app_development',
  design_asset: 'design_creation',
  wide_research: 'wide_research',
  browser_operator: 'browser_operator',
  connectors_automations: 'automation',
} as const;

describe('launcher task routing', () => {
  it('keeps every launcher prompt mapped to its intended semantic task type', () => {
    for (const launcher of MANUS_STYLE_LAUNCHER_TASKS) {
      const decision = classifyUserIntent(launcher.prompt);
      expect(decision.contract.taskType, launcher.id).toBe(
        expectedTaskTypes[launcher.id],
      );
      expect(decision.contract.verificationRequired, launcher.id).toBe(true);
      if (launcher.expectedOutcome !== 'browser task') {
        expect(
          decision.contract.completionProof,
          launcher.id,
        ).not.toBe('none');
      }
    }
  });
});
