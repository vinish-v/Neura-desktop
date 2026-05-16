/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const extensionRoot = path.join(__dirname, '..', '..', '..', 'extensions', 'neura-agent');
const { PermissionEngine, redactSecrets } = require(path.join(extensionRoot, 'permissionEngine'));
const { writeArtifactBundle, groupArtifactsByRun } = require(path.join(extensionRoot, 'artifactStore'));
const { modeLabels, editableModes, agentTools } = require(path.join(extensionRoot, 'constants'));

const configProvider = (values) => ({
  workspace: {
    getConfiguration(section) {
      assert.strictEqual(section, 'neura.permissions');
      return {
        get(key, fallback) {
          return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback;
        },
      };
    },
  },
});

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'neura-agent-verify-'));
const engine = new PermissionEngine({
  workspaceRoot: tmpRoot,
  configProvider: configProvider({
    rules: [
      { action: 'command', pattern: 'npm test', effect: 'allow', reason: 'trusted test command' },
      { action: 'mcp', pattern: 'danger/delete', effect: 'deny', reason: 'destructive MCP tool' },
    ],
    'browser.allowedDomains': ['localhost', '*.neura.local'],
  }),
});

assert.strictEqual(engine.evaluate('command', 'npm test').decision, 'allow');
assert.strictEqual(engine.evaluate('command', 'rm -rf .').decision, 'deny');
assert.strictEqual(engine.evaluate('mcp', 'danger/delete').decision, 'deny');
assert.strictEqual(engine.evaluate('browser_url', 'http://localhost:3000').decision, 'allow');
assert.strictEqual(engine.evaluate('browser_url', 'https://docs.neura.local/path').decision, 'allow');
assert.strictEqual(engine.evaluate('browser_url', 'https://example.com').decision, 'ask');
assert.strictEqual(engine.evaluate('file_write', path.join(tmpRoot, 'src', 'index.js')).decision, 'allow');
assert.strictEqual(engine.evaluate('file_write', path.join(os.tmpdir(), 'outside.js')).decision, 'deny');

const redactedText = redactSecrets('apiKey=nvapi-supersecret123456 and token: abcdefghijklmnop');
assert(!redactedText.includes('nvapi-supersecret123456'));
assert(!redactedText.includes('abcdefghijklmnop'));
const redactedObject = redactSecrets({ apiKey: 'secret-value', nested: { Authorization: 'Bearer secret-token-value' } });
assert.strictEqual(redactedObject.apiKey, '<redacted>');
assert.strictEqual(redactedObject.nested.Authorization, '<redacted>');
assert.strictEqual(modeLabels.ship, 'Ship');
assert(editableModes.has('ship'), 'Ship mode must be editable');
assert(agentTools.some((tool) => tool.action === 'production_profile'), 'production_profile tool must be available');

const artifacts = [
  {
    id: 'artifact-1',
    runId: 'run-1',
    sequence: 1,
    kind: 'plan',
    title: 'Implementation plan',
    summary: 'Planned the run.',
    data: {},
    comments: [{ id: 'comment-1', text: 'Looks good', createdAt: '2026-05-15T00:00:00.000Z' }],
    createdAt: '2026-05-15T00:00:00.000Z',
  },
  {
    id: 'artifact-2',
    runId: 'run-1',
    sequence: 2,
    kind: 'terminal',
    title: 'npm test',
    summary: 'Tests passed.',
    data: {},
    comments: [],
    createdAt: '2026-05-15T00:01:00.000Z',
  },
];
assert.strictEqual(groupArtifactsByRun(artifacts).length, 1);

const bundleDir = path.join(tmpRoot, 'proof');
writeArtifactBundle({
  bundleDir,
  baseName: 'run-1',
  bundle: {
    id: 'run-1',
    project: 'verify',
    rootPath: tmpRoot,
    createdAt: '2026-05-15T00:02:00.000Z',
    artifacts,
  },
  markdown: '# Test Report\n',
}).then(({ jsonPath, mdPath, htmlPath }) => {
  assert(fs.existsSync(jsonPath), 'proof JSON should be written');
  assert(fs.existsSync(mdPath), 'proof markdown should be written');
  assert(fs.existsSync(htmlPath), 'proof HTML should be written');
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert(html.includes('Neura Run Report'));
  assert(html.includes('Implementation plan'));
  assert(html.includes('Looks good'));

  const packageJson = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'package.json'), 'utf8'));
  const commands = new Set(packageJson.contributes.commands.map((item) => item.command));
  for (const command of [
    'neura.openMissionControl',
    'neura.configureProviders',
    'neura.shipApp',
    'neura.fixWorkspaceProblems',
    'neura.acceptCurrentFileProposal',
    'neura.openNextPendingEdit',
    'neura.exportProofBundle',
  ]) {
    assert(commands.has(command), `${command} must be contributed`);
  }
  assert(packageJson.contributes.configuration.properties['neura.permissions.rules']);
  assert(packageJson.contributes.configuration.properties['neura.permissions.browser.allowedDomains']);
  assert(packageJson.contributes.configuration.properties['neura.provider.order']);
  assert(packageJson.contributes.configuration.properties['neura.openrouter.apiKey']);
  assert(packageJson.contributes.configuration.properties['neura.openrouter.apiKey'].markdownDescription.includes('OpenRouter API key'));
  assert(packageJson.contributes.configuration.properties['neura.ollama.baseUrl']);
  assert(packageJson.contributes.configuration.properties['neura.ollama.apiKey']);
  assert(packageJson.contributes.configuration.properties['neura.nim.apiKey']);
  console.log('Neura agent policy, artifact, and manifest checks passed.');
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
