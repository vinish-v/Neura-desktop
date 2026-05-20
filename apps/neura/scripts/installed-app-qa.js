#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const os = require('os');
const path = require('path');

const appVersion = require('../package.json').version;
const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '..', '..');

const candidates = [
  path.join(root, 'out', 'Neura-win32-x64', 'Neura.exe'),
  path.join(
    os.homedir(),
    'AppData',
    'Local',
    'Neura',
    `app-${appVersion}`,
    'Neura.exe',
  ),
  path.join(os.homedir(), 'AppData', 'Local', 'Neura', 'Neura.exe'),
];

const settingPath = path.join(
  os.homedir(),
  'AppData',
  'Roaming',
  'Neura',
  'neura.setting.json',
);

const result = {
  appVersion,
  repoRoot,
  checkedAt: new Date().toISOString(),
  executableCandidates: candidates.map((candidate) => ({
    path: candidate,
    exists: fs.existsSync(candidate),
  })),
  settings: {
    path: settingPath,
    exists: fs.existsSync(settingPath),
    hasPlannerBaseUrl: false,
    hasPlannerApiKey: false,
    hasPlannerModelName: false,
    hasVlmBaseUrl: false,
    hasVlmApiKey: false,
    hasVlmModelName: false,
    enabledConnectors: [],
    enabledMultimodalProviders: [],
  },
  expectedManualChecks: [
    'Launch the installed Neura.exe listed above, not an older app shortcut.',
    'Start one browser research task and verify live Neura Computer frames, takeover, and resume.',
    'Start one local file/task automation and verify cursor, typing, artifact, and completion proof.',
    'Trigger one disabled connector path and verify Neura reports a setup gap instead of fake success.',
    'Run one long task, pause or kill it, then use Resume and verify checkpoint continuity.',
  ],
};

if (result.settings.exists) {
  try {
    const contents = fs.readFileSync(settingPath, 'utf8').replace(/^\uFEFF/, '');
    const raw = JSON.parse(contents);
    result.settings.hasPlannerBaseUrl = Boolean(raw.plannerBaseUrl?.trim());
    result.settings.hasPlannerApiKey = Boolean(raw.plannerApiKey?.trim());
    result.settings.hasPlannerModelName = Boolean(raw.plannerModelName?.trim());
    result.settings.hasVlmBaseUrl = Boolean(raw.vlmBaseUrl?.trim());
    result.settings.hasVlmApiKey = Boolean(raw.vlmApiKey?.trim());
    result.settings.hasVlmModelName = Boolean(raw.vlmModelName?.trim());
    result.settings.enabledConnectors = (raw.connectors || [])
      .filter((connector) => connector.enabled)
      .map((connector) => ({
        id: connector.id,
        authState: connector.authState,
        tools: connector.tools || [],
      }));
    result.settings.enabledMultimodalProviders = Object.entries(
      raw.multimodalProviders || {},
    )
      .filter(([, provider]) =>
        Boolean(provider && provider.baseUrl && provider.apiKey && provider.model),
      )
      .map(([key]) => key);
  } catch (error) {
    result.settings.readError = error.message;
  }
}

const hasAnyExecutable = result.executableCandidates.some((item) => item.exists);
const hasAnyModel =
  (result.settings.hasPlannerBaseUrl &&
    result.settings.hasPlannerApiKey &&
    result.settings.hasPlannerModelName) ||
  (result.settings.hasVlmBaseUrl &&
    result.settings.hasVlmApiKey &&
    result.settings.hasVlmModelName);

result.status = hasAnyExecutable && hasAnyModel ? 'ready_for_manual_qa' : 'blocked';
result.blockers = [
  hasAnyExecutable ? '' : 'No packaged or installed Neura.exe was found.',
  hasAnyModel
    ? ''
    : 'No complete planner/VLM model configuration was found in the installed settings file.',
].filter(Boolean);

console.log(JSON.stringify(result, null, 2));

if (result.status === 'blocked') {
  process.exitCode = 1;
}
