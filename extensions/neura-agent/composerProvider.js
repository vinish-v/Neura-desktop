/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
const fs = require('fs/promises');
const fsSync = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const vscode = require('vscode');

const {
  modeLabels,
  reasoningLabels,
  permissionLabels,
  nvidiaModels,
  editableModes,
  ignoredGlob,
  maxContextBytes,
  maxAttachmentBytes,
  defaultNimTimeoutMs,
  agentMaxSteps,
  agentObservationBytes,
  agentSearchFileLimit,
  agentSearchMatchLimit,
  backgroundAgentMaxAttempts,
  agentTools,
  swarmRoles,
  swarmRoleById,
} = require('./constants');
const { findBrowserExecutable } = require('./browser');
const { McpStdioClient, McpSseClient } = require('./mcpClient');
const { PermissionEngine, redactSecrets } = require('./permissionEngine');
const { groupArtifactsByRun, artifactMarkdown, artifactPreviewPath, writeArtifactBundle } = require('./artifactStore');
const {
  logNeura,
  errorMessageFor,
  escapeHtml,
  nowIso,
  id,
  hashKey,
  languageFor,
  normalizeSlashes,
  codingKeywordPattern,
  fileReferencePattern,
  parseJsonObject,
  safeReadJson,
  markdownToHtml,
  execFileAsync,
} = require('./utils');

const localConfigKey = (section, name) => `neura.localConfig.${section}.${name}`;
const secretConfigKey = (section, name) => `neura.secret.${section}.${name}`;

class NeuraComposerProvider {
  constructor(context, statusBarItem = null) {
    this.context = context;
    this.statusBar = statusBarItem;
    this.view = undefined;
    this.missionPanel = undefined;
    this.state = this.defaultState();
    this.config = this.readNimConfig();
    this.suggestions = [];
    this.activeTab = 'chat';
    this.worktrees = [];
    this.mcpServers = [];
    this.plugins = [];
    this.mcpClients = new Map();
    this.loadedPlugins = new Map();
    this.backgroundRuns = new Map();
    this.backgroundCancels = new Map();
    this.swarmRuns = new Map();
    this.toolCache = new Map();
    this.providerStats = new Map();
    this.semanticIndexTimer = null;
    this.permissionEngine = new PermissionEngine({ workspaceRoot: this.rootPath });
    this.proposalDecoration = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      borderWidth: '0 0 0 2px',
      borderStyle: 'solid',
      borderColor: new vscode.ThemeColor('editorGutter.modifiedBackground'),
      overviewRulerColor: new vscode.ThemeColor('editorGutter.modifiedBackground'),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      after: {
        contentText: '  Neura pending edit',
        color: new vscode.ThemeColor('editorCodeLens.foreground'),
        margin: '0 0 0 1.5em',
      },
    });
  }

  defaultState() {
    const session = this.createEmptySession('Session 1');
    return {
      activeSessionId: session.id,
      sessions: [session],
      memory: { facts: [], sessionSummaries: [], updatedAt: nowIso() },
      mode: 'agent',
      reasoning: 'medium',
      permissionMode: 'ask',
      messages: [],
      contextFiles: [],
      proposals: [],
      terminalCards: [],
      checkpoints: [],
      artifacts: [],
      policyAudit: [],
      backgroundAgents: [],
      swarmMissions: [],
      mcpCards: [],
      promptQueue: [],
      stoppedTrajectory: null,
      activeRunId: '',
      semanticIndex: { files: [], symbols: [], updatedAt: '' },
      preview: null,
      updatedAt: nowIso(),
    };
  }

  createEmptySession(title = 'New session') {
    return {
      id: id('session'),
      title,
      mode: 'agent',
      reasoning: 'medium',
      permissionMode: 'ask',
      messages: [],
      contextFiles: [],
      proposals: [],
      terminalCards: [],
      checkpoints: [],
      artifacts: [],
      policyAudit: [],
      backgroundAgents: [],
      swarmMissions: [],
      mcpCards: [],
      promptQueue: [],
      stoppedTrajectory: null,
      activeRunId: '',
      semanticIndex: { files: [], symbols: [], updatedAt: '' },
      preview: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
  }

  sessionTitle(session) {
    const firstUser = (session.messages || []).find((message) => message.role === 'user');
    if (firstUser?.content) {
      return firstUser.content.slice(0, 42);
    }
    return session.title || 'New session';
  }

  activeSession() {
    return (this.state.sessions || []).find((session) => session.id === this.state.activeSessionId);
  }

  copySessionToState(session) {
    this.state.mode = session.mode || 'agent';
    this.state.reasoning = session.reasoning || 'medium';
    this.state.permissionMode = session.permissionMode || 'ask';
    this.state.messages = session.messages || [];
    this.state.contextFiles = session.contextFiles || [];
    this.state.proposals = session.proposals || [];
    this.state.terminalCards = session.terminalCards || [];
    this.state.checkpoints = session.checkpoints || [];
    this.state.artifacts = session.artifacts || [];
    this.state.policyAudit = session.policyAudit || [];
    this.state.backgroundAgents = session.backgroundAgents || [];
    this.state.swarmMissions = session.swarmMissions || [];
    this.state.mcpCards = session.mcpCards || [];
    this.state.promptQueue = session.promptQueue || [];
    this.state.stoppedTrajectory = session.stoppedTrajectory || null;
    this.state.activeRunId = session.activeRunId || '';
    this.state.semanticIndex = session.semanticIndex || { files: [], symbols: [], updatedAt: '' };
    this.state.preview = session.preview || null;
  }

  persistStateToSession() {
    if (!Array.isArray(this.state.sessions)) {
      this.state.sessions = [];
    }
    let session = this.activeSession();
    if (!session) {
      session = this.createEmptySession(`Session ${this.state.sessions.length + 1}`);
      this.state.sessions.unshift(session);
      this.state.activeSessionId = session.id;
    }
    Object.assign(session, {
      title: this.sessionTitle({
        ...session,
        messages: this.state.messages || [],
      }),
      mode: this.state.mode,
      reasoning: this.state.reasoning,
      permissionMode: this.state.permissionMode || 'ask',
      messages: this.state.messages || [],
      contextFiles: this.state.contextFiles || [],
      proposals: this.state.proposals || [],
      terminalCards: this.state.terminalCards || [],
      checkpoints: this.state.checkpoints || [],
      artifacts: this.state.artifacts || [],
      policyAudit: this.state.policyAudit || [],
      backgroundAgents: this.state.backgroundAgents || [],
      swarmMissions: this.state.swarmMissions || [],
      mcpCards: this.state.mcpCards || [],
      promptQueue: this.state.promptQueue || [],
      stoppedTrajectory: this.state.stoppedTrajectory || null,
      activeRunId: this.state.activeRunId || '',
      semanticIndex: this.state.semanticIndex || { files: [], symbols: [], updatedAt: '' },
      preview: this.state.preview || null,
      updatedAt: nowIso(),
    });
  }

  migrateSessionsIfNeeded() {
    if (!Array.isArray(this.state.sessions) || !this.state.sessions.length) {
      const session = this.createEmptySession('Session 1');
      Object.assign(session, {
        mode: this.state.mode || 'agent',
        reasoning: this.state.reasoning || 'medium',
        permissionMode: this.state.permissionMode || 'ask',
        messages: this.state.messages || [],
        contextFiles: this.state.contextFiles || [],
        proposals: this.state.proposals || [],
        terminalCards: this.state.terminalCards || [],
        checkpoints: this.state.checkpoints || [],
        artifacts: this.state.artifacts || [],
        policyAudit: this.state.policyAudit || [],
        backgroundAgents: this.state.backgroundAgents || [],
        swarmMissions: this.state.swarmMissions || [],
        mcpCards: this.state.mcpCards || [],
        promptQueue: this.state.promptQueue || [],
        stoppedTrajectory: this.state.stoppedTrajectory || null,
        activeRunId: this.state.activeRunId || '',
        semanticIndex: this.state.semanticIndex || { files: [], symbols: [], updatedAt: '' },
        preview: this.state.preview || null,
      });
      session.title = this.sessionTitle(session);
      this.state.sessions = [session];
      this.state.activeSessionId = session.id;
    }
    if (!this.state.activeSessionId || !this.activeSession()) {
      this.state.activeSessionId = this.state.sessions[0].id;
    }
    this.copySessionToState(this.activeSession());
    if (!Array.isArray(this.state.artifacts)) this.state.artifacts = [];
    if (!Array.isArray(this.state.policyAudit)) this.state.policyAudit = [];
    if (!Array.isArray(this.state.backgroundAgents)) this.state.backgroundAgents = [];
    if (!Array.isArray(this.state.swarmMissions)) this.state.swarmMissions = [];
    if (!Array.isArray(this.state.mcpCards)) this.state.mcpCards = [];
    if (!Array.isArray(this.state.promptQueue)) this.state.promptQueue = [];
    if (!this.state.semanticIndex) this.state.semanticIndex = { files: [], symbols: [], updatedAt: '' };
  }

  get rootFolder() {
    return vscode.workspace.workspaceFolders?.[0];
  }

  get rootPath() {
    return this.rootFolder?.uri.fsPath || '';
  }

  get projectName() {
    return this.rootFolder?.name || 'No folder open';
  }

  get stateKey() {
    const root = this.rootPath || 'empty';
    return `neura.composer.${hashKey(root)}`;
  }

  async resolveWebviewView(webviewView) {
    this.view = webviewView;
    const localRoots = [
      this.context.extensionUri,
      ...(this.rootFolder ? [this.rootFolder.uri] : []),
      ...(this.neuraDir ? [vscode.Uri.file(this.neuraDir)] : []),
    ];
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: localRoots,
    };
    webviewView.webview.onDidReceiveMessage((message) => {
      void this.handleMessage(message);
    });
    await this.refresh();
  }

  async reveal() {
    await vscode.commands.executeCommand('workbench.view.extension.neura-ai');
    await this.refresh();
  }

  async openMissionControl() {
    if (this.missionPanel) {
      this.missionPanel.reveal(vscode.ViewColumn.One);
      this.missionPanel.webview.html = this.renderMissionControl();
      return;
    }
    this.missionPanel = vscode.window.createWebviewPanel(
      'neuraMissionControl',
      'Neura Mission Control',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          this.context.extensionUri,
          ...(this.rootFolder ? [this.rootFolder.uri] : []),
          ...(this.neuraDir ? [vscode.Uri.file(this.neuraDir)] : []),
        ],
      },
    );
    this.missionPanel.onDidDispose(() => {
      this.missionPanel = undefined;
    });
    this.missionPanel.webview.onDidReceiveMessage((message) => void this.handleMessage(message));
    this.missionPanel.webview.html = this.renderMissionControl();
  }

  async loadState() {
    this.state = this.context.workspaceState.get(this.stateKey, this.defaultState());
    this.permissionEngine = new PermissionEngine({ workspaceRoot: this.rootPath });
    this.migrateSessionsIfNeeded();
    this.state.memory = await this.loadMemory();
    if (!modeLabels[this.state.mode]) {
      this.state.mode = 'agent';
    }
    this.config = await this.readNimConfig();
    await this.restoreBackgroundAgentsFromDisk();
    if (!reasoningLabels[this.state.reasoning]) {
      this.state.reasoning =
        vscode.workspace.getConfiguration('neura.nim').get('reasoning') || 'medium';
    }
    if (!permissionLabels[this.state.permissionMode]) {
      this.state.permissionMode = 'ask';
    }
  }

  canAutoApplyEdits() {
    return this.state.permissionMode === 'terminal' || this.state.permissionMode === 'workspace' || this.state.permissionMode === 'full';
  }

  canAutoRunCommands() {
    return this.state.permissionMode === 'full';
  }

  canProposeWorkspaceChanges() {
    return this.state.permissionMode !== 'read';
  }

  canProposeTerminalCommands() {
    return this.state.permissionMode !== 'read';
  }

  evaluatePolicy(action, resource, metadata = {}) {
    const result = this.permissionEngine.evaluate(action, resource, metadata);
    const entry = {
      id: id('policy'),
      runId: metadata.runId || this.state.activeRunId || this.state.activeSessionId || '',
      action: result.action,
      resource: redactSecrets(result.resource),
      decision: result.decision,
      reason: result.reason,
      createdAt: nowIso(),
    };
    this.state.policyAudit = [entry, ...(this.state.policyAudit || [])].slice(0, 300);
    return { ...result, auditId: entry.id };
  }

  async enforcePolicy(action, resource, metadata = {}) {
    const decision = this.evaluatePolicy(action, resource, metadata);
    if (decision.decision === 'deny') {
      throw new Error(`Neura policy denied ${action}: ${decision.reason}`);
    }
    if (decision.decision === 'ask' && !metadata.skipPrompt) {
      const approval = await vscode.window.showWarningMessage(
        `Allow Neura ${action}?\n\n${resource}\n\n${decision.reason}`,
        { modal: true },
        'Allow Once',
        'Deny',
      );
      if (approval !== 'Allow Once') {
        decision.decision = 'deny';
        decision.reason = 'User denied policy prompt.';
        throw new Error(`Neura policy denied ${action}.`);
      }
    }
    return decision;
  }

  recordArtifact(kind, title, summary, data = {}) {
    const runId = data.runId || this.state.activeRunId || this.state.activeSessionId || 'workspace';
    const redactedData = redactSecrets(data);
    const artifact = {
      id: id('artifact'),
      runId,
      sequence: (this.state.artifacts || []).filter((item) => item.runId === runId).length + 1,
      kind: String(kind || 'note'),
      title: String(title || 'Artifact').slice(0, 140),
      summary: redactSecrets(String(summary || '').slice(0, 800)),
      data: redactedData,
      comments: [],
      createdAt: nowIso(),
    };
    this.state.artifacts = [artifact, ...(this.state.artifacts || [])].slice(0, 80);
    return artifact;
  }

  async writeProofBundle(runId = this.state.activeRunId || this.state.activeSessionId) {
    this.ensureWorkspace();
    const idValue = String(runId || this.state.activeSessionId || 'workspace');
    const artifacts = (this.state.artifacts || [])
      .filter((artifact) => artifact.runId === idValue || (!runId && artifact.runId === this.state.activeRunId))
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    if (!artifacts.length) throw new Error('No artifacts were found for this run yet.');
    const bundleDir = path.join(this.neuraDir, 'proof-bundles');
    await fs.mkdir(bundleDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const baseName = `${stamp}-${idValue.replace(/[^a-zA-Z0-9_.-]+/g, '-')}`;
    const proposals = (this.state.proposals || []).filter((proposal) => artifacts.some((artifact) => artifact.data?.proposalId === proposal.id));
    const terminals = (this.state.terminalCards || []).filter((card) => artifacts.some((artifact) => artifact.data?.terminalId === card.id));
    const previews = artifacts.filter((artifact) => artifact.kind === 'preview');
    const browserArtifacts = artifacts.filter((artifact) => artifact.kind === 'browser-agent' || artifact.kind === 'browser' || artifact.kind === 'browser-verify');
    const bundle = {
      id: idValue,
      project: this.projectName,
      rootPath: this.rootPath,
      createdAt: nowIso(),
      artifacts,
      policyAudit: (this.state.policyAudit || []).filter((entry) => entry.runId === idValue || !entry.runId).slice(-200),
      proposals: proposals.map((proposal) => ({
        id: proposal.id,
        summary: proposal.summary,
        status: proposal.status,
        files: (proposal.edits || []).map((edit) => ({ filePath: edit.filePath, operation: edit.operation, status: edit.status })),
        commands: (proposal.commands || []).map((command) => ({ command: command.command, status: command.status, exitCode: command.exitCode })),
      })),
      terminals: terminals.map((card) => ({
        id: card.id,
        command: card.command,
        status: card.status,
        exitCode: card.exitCode,
        stdoutTail: redactSecrets(String(card.stdout || '').slice(-6000)),
        stderrTail: redactSecrets(String(card.stderr || '').slice(-6000)),
      })),
      previews: previews.map((artifact) => artifact.data || {}),
      browserEvidence: browserArtifacts.map((artifact) => artifact.data || {}),
    };
    const markdown = [
      `# Neura Proof of Work`,
      '',
      `- Project: ${this.projectName}`,
      `- Run: ${idValue}`,
      `- Generated: ${bundle.createdAt}`,
      `- Workspace: ${this.rootPath}`,
      '',
      `## Timeline`,
      ...artifacts.map((artifact) => `\n${artifactMarkdown(artifact)}`),
      '',
      `## Proposals`,
      proposals.length
        ? proposals.map((proposal) => `- ${proposal.status}: ${proposal.summary} (${(proposal.edits || []).length} files, ${(proposal.commands || []).length} commands)`).join('\n')
        : 'No proposals recorded.',
      '',
      `## Terminal Evidence`,
      terminals.length
        ? terminals.map((card) => `### ${card.command}\n- Status: ${card.status}\n- Exit: ${card.exitCode ?? 'unknown'}\n\n\`\`\`\n${String(card.stdout || card.stderr || '').slice(-3000)}\n\`\`\``).join('\n\n')
        : 'No terminal runs recorded.',
      '',
      `## Preview Evidence`,
      previews.length
        ? previews.map((artifact) => `- ${artifact.title}: ${artifact.summary}`).join('\n')
        : 'No preview evidence recorded.',
      '',
      `## Browser Agent Evidence`,
      browserArtifacts.length
        ? browserArtifacts.map((artifact) => [
          `- ${artifact.title}: ${artifact.summary}`,
          artifact.data?.screenshotPath ? `  - Screenshot: ${artifact.data.screenshotPath}` : '',
          artifact.data?.domPath ? `  - DOM: ${artifact.data.domPath}` : '',
          artifact.data?.recordingPath ? `  - Recording: ${artifact.data.recordingPath}` : '',
        ].filter(Boolean).join('\n')).join('\n')
        : 'No browser agent evidence recorded.',
      '',
      `## Policy Audit`,
      bundle.policyAudit.length
        ? bundle.policyAudit.map((entry) => `- ${entry.createdAt}: ${entry.decision} ${entry.action} ${entry.resource} (${entry.reason})`).join('\n')
        : 'No policy decisions recorded.',
      '',
    ].join('\n');
    const { jsonPath, mdPath, htmlPath } = await writeArtifactBundle({ bundleDir, baseName, bundle, markdown });
    const artifact = this.recordArtifact('proof-bundle', 'Proof of work bundle', `Exported ${artifacts.length} artifact(s) for ${idValue}.`, {
      runId: idValue,
      jsonPath,
      mdPath,
      htmlPath,
    });
    await this.saveState();
    return { artifact, jsonPath, mdPath };
  }

  async exportProofBundle() {
    const result = await this.writeProofBundle();
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(result.htmlPath || result.mdPath));
    await vscode.window.showTextDocument(document, { preview: false });
    await vscode.window.showInformationMessage(`Neura proof bundle exported: ${result.htmlPath || result.mdPath}`);
    this.renderIfVisible();
    return result;
  }

  async addArtifactComment(artifactId) {
    const artifact = (this.state.artifacts || []).find((item) => item.id === artifactId);
    if (!artifact) throw new Error('Artifact was not found.');
    const text = await vscode.window.showInputBox({
      title: `Comment on ${artifact.title}`,
      prompt: 'Add reviewer/user context for this trust artifact.',
      ignoreFocusOut: true,
      validateInput: (value) => (String(value || '').trim() ? undefined : 'Enter a comment.'),
    });
    if (!text) return;
    artifact.comments = [
      ...(artifact.comments || []),
      { id: id('comment'), text: redactSecrets(text.trim()).slice(0, 600), createdAt: nowIso() },
    ].slice(-20);
    this.recordArtifact('artifact-comment', `Comment: ${artifact.title}`, text.trim(), {
      artifactId,
      targetKind: artifact.kind,
      targetRunId: artifact.runId,
    });
    await this.saveState();
    this.renderIfVisible();
  }

  async openArtifactFile(artifactId) {
    const artifact = (this.state.artifacts || []).find((item) => item.id === artifactId);
    const target = artifact?.data?.htmlPath || artifact?.data?.mdPath || artifact?.data?.jsonPath || artifactPreviewPath(artifact);
    if (!target) {
      await vscode.window.showInformationMessage('This artifact does not have a local file to open.');
      return;
    }
    const uri = vscode.Uri.file(target);
    if (/\.(png|jpg|jpeg|webp|gif)$/i.test(target)) {
      await vscode.commands.executeCommand('vscode.open', uri);
      return;
    }
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: false });
  }

  webviewFileUri(filePath) {
    if (!filePath || !this.view?.webview) return '';
    try {
      return this.view.webview.asWebviewUri(vscode.Uri.file(filePath)).toString();
    } catch {
      return '';
    }
  }

  async saveState() {
    this.persistStateToSession();
    this.state.updatedAt = nowIso();
    await this.saveMemory();
    await this.context.workspaceState.update(this.stateKey, this.state);
  }

  get memoryPath() {
    return this.rootPath ? path.join(this.rootPath, '.neura', 'neura-memory.json') : '';
  }

  async loadMemory() {
    const fallback = this.state.memory || { facts: [], sessionSummaries: [], updatedAt: nowIso() };
    if (!this.memoryPath) return fallback;
    const fromDisk = await safeReadJson(this.memoryPath);
    return {
      facts: Array.isArray(fromDisk.facts) ? fromDisk.facts : fallback.facts || [],
      sessionSummaries: Array.isArray(fromDisk.sessionSummaries)
        ? fromDisk.sessionSummaries
        : fallback.sessionSummaries || [],
      updatedAt: fromDisk.updatedAt || fallback.updatedAt || nowIso(),
    };
  }

  async saveMemory() {
    if (!this.memoryPath) return;
    const memory = this.state.memory || { facts: [], sessionSummaries: [], updatedAt: nowIso() };
    memory.facts = (memory.facts || []).slice(0, 80);
    memory.sessionSummaries = (memory.sessionSummaries || []).slice(0, 40);
    memory.updatedAt = nowIso();
    await fs.mkdir(path.dirname(this.memoryPath), { recursive: true });
    await fs.writeFile(this.memoryPath, `${JSON.stringify(memory, null, 2)}\n`, 'utf8');
  }

  get neuraDir() {
    return this.rootPath ? path.join(this.rootPath, '.neura') : '';
  }

  get semanticIndexPath() {
    return this.neuraDir ? path.join(this.neuraDir, 'neura-index.json') : '';
  }

  get vectorIndexPath() {
    return this.neuraDir ? path.join(this.neuraDir, 'neura-vector-index.json') : '';
  }

  workspaceRoots() {
    const folders = vscode.workspace.workspaceFolders || [];
    return folders.map((folder) => ({
      name: folder.name,
      uri: folder.uri,
      path: folder.uri.fsPath,
      id: hashKey(folder.uri.fsPath).slice(0, 12),
    }));
  }

  rootForPath(filePath) {
    const roots = this.workspaceRoots();
    const normalized = path.resolve(filePath);
    return roots
      .filter((root) => {
        const relative = path.relative(root.path, normalized);
        return !relative.startsWith('..') && !path.isAbsolute(relative);
      })
      .sort((a, b) => b.path.length - a.path.length)[0] || null;
  }

  indexedPathForUri(uri) {
    const root = this.rootForPath(uri.fsPath) || this.workspaceRoots()[0];
    const relative = root ? normalizeSlashes(path.relative(root.path, uri.fsPath)) : normalizeSlashes(path.relative(this.rootPath, uri.fsPath));
    const multiRoot = this.workspaceRoots().length > 1;
    return {
      root,
      workspacePath: relative,
      filePath: multiRoot && root ? `${root.name}/${relative}` : relative,
    };
  }

  get sharedSemanticIndexPath() {
    const configured = String(vscode.workspace.getConfiguration('neura.index').get('sharedPath') || process.env.NEURA_SHARED_INDEX_PATH || '').trim();
    if (!configured) return '';
    return path.isAbsolute(configured) ? configured : path.join(this.rootPath || process.cwd(), configured);
  }

  get pluginTrustPath() {
    return this.neuraDir ? path.join(this.neuraDir, 'plugin-trust.json') : '';
  }

  get mcpPermissionPath() {
    return this.neuraDir ? path.join(this.neuraDir, 'mcp-permissions.json') : '';
  }

  get backgroundAgentsDir() {
    return this.neuraDir ? path.join(this.neuraDir, 'background-agents') : '';
  }

  get swarmMissionsDir() {
    return this.neuraDir ? path.join(this.neuraDir, 'swarm-missions') : '';
  }

  async refresh() {
    await this.loadState();
    await this.refreshSuggestions();
    await this.refreshWorktrees();
    await this.refreshMcpServers();
    await this.refreshPlugins();
    await this.loadTrustedPlugins();
    if (this.view) {
      this.view.webview.html = this.render();
    }
    this.refreshInlineProposalDecorations();
    this.updateStatusBar();
  }

  refreshInlineProposalDecorations(editor = vscode.window.activeTextEditor) {
    if (!editor || editor.document.uri.scheme !== 'file' || !this.rootPath) return;
    const relative = normalizeSlashes(path.relative(this.rootPath, editor.document.uri.fsPath));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return;
    const pending = (this.state.proposals || [])
      .flatMap((proposal) => proposal.edits || [])
      .filter((edit) => edit.filePath === relative && edit.status === 'proposed');
    if (!pending.length) {
      editor.setDecorations(this.proposalDecoration, []);
      return;
    }
    const lastLine = Math.max(0, editor.document.lineCount - 1);
    const decorations = [
      {
        range: new vscode.Range(0, 0, lastLine, editor.document.lineAt(lastLine).text.length),
        hoverMessage: new vscode.MarkdownString(`Neura has ${pending.length} pending proposed edit(s) for \`${relative}\`.\n\nCommands: \`Neura: Review Pending Edit\`, \`Neura: Accept Current File\`, \`Neura: Reject Current File\`, \`Neura: Reapply Current File\`.`),
      },
    ];
    editor.setDecorations(this.proposalDecoration, decorations);
  }

  pendingProposalForFile(filePath) {
    const normalized = normalizeSlashes(filePath || '');
    return (this.state.proposals || []).find((proposal) =>
      (proposal.edits || []).some((edit) => edit.filePath === normalized && edit.status === 'proposed'),
    );
  }

  hasPendingProposalForDocument(document) {
    if (!document || document.uri.scheme !== 'file' || !this.rootPath) return false;
    const relative = normalizeSlashes(path.relative(this.rootPath, document.uri.fsPath));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
    return Boolean(this.pendingProposalForFile(relative));
  }

  async currentFilePendingEdit() {
    const filePath = await this.activeEditorFile();
    if (!filePath) throw new Error('Open a workspace file with a pending Neura edit first.');
    const proposal = this.pendingProposalForFile(filePath);
    const edit = proposal?.edits?.find((item) => item.filePath === filePath && item.status === 'proposed');
    if (!proposal || !edit) throw new Error('No pending Neura edit was found for the active file.');
    return { proposal, edit, filePath };
  }

  localConfig(section, name) {
    const key = localConfigKey(section, name);
    return this.context.workspaceState.get(key, this.context.globalState.get(key));
  }

  async readSecretConfig(section, name) {
    return (await this.context.secrets.get(secretConfigKey(section, name))) || '';
  }

  async updateConfigOrLocal(section, name, value, target) {
    const normalized = Array.isArray(value) ? value : String(value || '').trim();
    if (!Array.isArray(normalized) && !normalized) return;
    try {
      await vscode.workspace.getConfiguration(section).update(name, normalized, target);
    } catch (error) {
      await this.context.workspaceState.update(localConfigKey(section, name), normalized);
      logNeura('Stored Neura setting in extension workspace storage', {
        section,
        name,
        reason: errorMessageFor(error),
      });
    }
  }

  async readNimConfig() {
    const config = vscode.workspace.getConfiguration('neura.nim');
    const providerConfig = vscode.workspace.getConfiguration('neura.provider');
    const openRouterConfig = vscode.workspace.getConfiguration('neura.openrouter');
    const ollamaConfig = vscode.workspace.getConfiguration('neura.ollama');
    const persisted = await this.readPersistedNeuraSettings();
    const openRouterSecret = await this.readSecretConfig('neura.openrouter', 'apiKey');
    const ollamaSecret = await this.readSecretConfig('neura.ollama', 'apiKey');
    const nimSecret = await this.readSecretConfig('neura.nim', 'apiKey');
    const nimBaseUrl =
      config.get('baseUrl') ||
      this.localConfig('neura.nim', 'baseUrl') ||
      persisted.plannerBaseUrl ||
      persisted.vlmBaseUrl ||
      process.env.PLANNER_BASE_URL ||
      process.env.NVIDIA_NIM_BASE_URL ||
      'https://integrate.api.nvidia.com/v1';
    const nimApiKey =
      nimSecret ||
      config.get('apiKey') ||
      persisted.plannerApiKey ||
      persisted.vlmApiKey ||
      process.env.PLANNER_API_KEY ||
      process.env.NVIDIA_NIM_API_KEY ||
      process.env.NVIDIA_API_KEY ||
      '';
    const nimModel =
      config.get('model') ||
      this.localConfig('neura.nim', 'model') ||
      persisted.plannerModelName ||
      process.env.PLANNER_MODEL ||
      process.env.NVIDIA_NIM_MODEL ||
      'nvidia/nemotron-3-nano-30b-a3b';
    const openRouterBaseUrl = openRouterConfig.get('baseUrl') || this.localConfig('neura.openrouter', 'baseUrl') || process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
    const openRouterApiKey = openRouterSecret || openRouterConfig.get('apiKey') || process.env.OPENROUTER_API_KEY || '';
    const openRouterModel = openRouterConfig.get('model') || this.localConfig('neura.openrouter', 'model') || process.env.OPENROUTER_MODEL || '';
    const ollamaBaseUrl = ollamaConfig.get('baseUrl') || this.localConfig('neura.ollama', 'baseUrl') || process.env.OLLAMA_BASE_URL || 'https://ollama.com';
    const ollamaApiKey = ollamaSecret || ollamaConfig.get('apiKey') || process.env.OLLAMA_API_KEY || process.env.OLLAMA_CLOUD_API_KEY || '';
    const ollamaModel = ollamaConfig.get('model') || this.localConfig('neura.ollama', 'model') || process.env.OLLAMA_MODEL || '';
    const providerOrderRaw = providerConfig.get('order') || this.localConfig('neura.provider', 'order') || process.env.NEURA_PROVIDER_ORDER || ['openrouter', 'ollama', 'nim'];
    const providerOrder = (Array.isArray(providerOrderRaw) ? providerOrderRaw : String(providerOrderRaw).split(','))
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean);
    const openRouterReferer = openRouterConfig.get('httpReferer') || process.env.OPENROUTER_HTTP_REFERER || 'https://neura.local';
    const openRouterTitle = openRouterConfig.get('appTitle') || process.env.OPENROUTER_APP_TITLE || 'Neura IDE';
    const isLocalOllama = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(String(ollamaBaseUrl || ''));
    const isOllamaOpenAiCompat = /\/v1\/?$/i.test(String(ollamaBaseUrl || '').replace(/\/+$/, ''));
    const providersById = {
      openrouter: {
        id: 'openrouter',
        label: 'OpenRouter',
        baseUrl: String(openRouterBaseUrl || '').replace(/\/+$/, ''),
        apiKey: String(openRouterApiKey || ''),
        model: String(openRouterModel || ''),
        headers: {
          'HTTP-Referer': String(openRouterReferer || ''),
          'X-Title': String(openRouterTitle || 'Neura IDE'),
        },
        configured: Boolean(openRouterApiKey && openRouterBaseUrl && openRouterModel),
      },
      ollama: {
        id: 'ollama',
        label: isLocalOllama ? 'Ollama Local' : 'Ollama Cloud',
        baseUrl: String(ollamaBaseUrl || '').replace(/\/+$/, ''),
        apiKey: String(ollamaApiKey || ''),
        model: String(ollamaModel || ''),
        headers: {},
        apiStyle: isOllamaOpenAiCompat ? 'openai' : 'ollama',
        configured: Boolean(ollamaBaseUrl && ollamaModel && (isLocalOllama || ollamaApiKey)),
      },
      nim: {
        id: 'nim',
        label: 'NVIDIA NIM',
        baseUrl: String(nimBaseUrl || '').replace(/\/+$/, ''),
        apiKey: String(nimApiKey || ''),
        model: String(nimModel || ''),
        headers: {},
        configured: Boolean(nimApiKey && nimBaseUrl && nimModel),
      },
    };
    const providers = providerOrder
      .map((providerId) => providersById[providerId])
      .filter((provider) => provider?.configured);
    const activeProvider = providers[0] || providersById.nim;
    const timeoutMs = Number(config.get('timeoutMs') || process.env.NEURA_NIM_TIMEOUT_MS || defaultNimTimeoutMs);
    const embeddingsEnabled = Boolean(config.get('embeddings.enabled') || process.env.NEURA_NIM_EMBEDDINGS === '1');
    const embeddingModel = String(config.get('embeddings.model') || process.env.NVIDIA_NIM_EMBEDDING_MODEL || '').trim();
    const embeddingBaseUrl = String(config.get('embeddings.baseUrl') || process.env.NVIDIA_NIM_EMBEDDING_BASE_URL || nimBaseUrl || '').replace(/\/+$/, '');
    const embeddingApiKey = String(config.get('embeddings.apiKey') || process.env.NVIDIA_NIM_EMBEDDING_API_KEY || nimApiKey || '');
    return {
      provider: activeProvider?.id || 'nim',
      providerLabel: activeProvider?.label || 'NVIDIA NIM',
      providerOrder,
      providers,
      providerStatus: Object.fromEntries(Object.entries(providersById).map(([key, provider]) => [key, {
        configured: provider.configured,
        baseUrl: provider.baseUrl,
        model: provider.model,
        label: provider.label,
      }])),
      baseUrl: activeProvider?.baseUrl || String(nimBaseUrl || '').replace(/\/+$/, ''),
      apiKey: activeProvider?.apiKey || String(nimApiKey || ''),
      model: activeProvider?.model || String(nimModel || ''),
      timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : defaultNimTimeoutMs,
      embeddings: {
        enabled: embeddingsEnabled,
        baseUrl: embeddingBaseUrl,
        apiKey: embeddingApiKey,
        model: embeddingModel,
        configured: Boolean(embeddingsEnabled && embeddingBaseUrl && embeddingApiKey && embeddingModel),
      },
      configured: providers.length > 0,
    };
  }

  providerHeaders(provider) {
    const headers = {
      'content-type': 'application/json',
      ...(provider.headers || {}),
    };
    if (provider.apiKey) {
      headers.authorization = `Bearer ${provider.apiKey}`;
    }
    return headers;
  }

  normalizeOllamaMessages(messages = []) {
    return (messages || []).map((message) => {
      const content = Array.isArray(message.content)
        ? message.content
            .map((part) => {
              if (typeof part === 'string') return part;
              if (part?.type === 'text') return part.text || '';
              return '';
            })
            .filter(Boolean)
            .join('\n')
        : String(message.content || '');
      return {
        role: ['system', 'user', 'assistant'].includes(message.role) ? message.role : 'user',
        content,
      };
    });
  }

  requestBodyForProvider(provider, body, options = {}) {
    if (provider.apiStyle === 'ollama') {
      return {
        model: provider.model,
        messages: this.normalizeOllamaMessages(body.messages),
        stream: Boolean(options.stream),
        options: {
          ...(Number.isFinite(body.temperature) ? { temperature: body.temperature } : {}),
          ...(Number.isFinite(body.max_tokens) ? { num_predict: body.max_tokens } : {}),
        },
      };
    }
    return {
      ...body,
      model: provider.model,
      ...(options.stream ? { stream: true } : {}),
    };
  }

  normalizeProviderPayload(provider, payload) {
    if (provider.apiStyle === 'ollama' && payload?.message) {
      return {
        choices: [{
          index: 0,
          finish_reason: payload.done_reason || (payload.done ? 'stop' : ''),
          message: payload.message,
        }],
        model: payload.model || provider.model,
        usage: {
          prompt_tokens: payload.prompt_eval_count || 0,
          completion_tokens: payload.eval_count || 0,
          total_tokens: Number(payload.prompt_eval_count || 0) + Number(payload.eval_count || 0),
        },
      };
    }
    return payload;
  }

  async readProviderResponseText(response, provider, requestMeta = {}) {
    const canStream = Boolean(requestMeta.stream && response.body);
    if (!canStream) return response.text();
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = '';
    let rawBody = '';
    let content = '';
    const emit = (delta) => {
      if (!delta) return;
      content += delta;
      if (typeof requestMeta.onProgress === 'function') {
        try {
          requestMeta.onProgress(delta, content);
        } catch {}
      }
    };
    const handleLine = (line) => {
      const trimmed = String(line || '').trim();
      if (!trimmed) return;
      if (provider.apiStyle === 'ollama') {
        rawBody += `${trimmed}\n`;
        try {
          const payload = JSON.parse(trimmed);
          emit(payload.message?.content || payload.response || '');
        } catch {}
        return;
      }
      if (!trimmed.startsWith('data:')) return;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') return;
      rawBody += `${data}\n`;
      try {
        const payload = JSON.parse(data);
        const choice = payload.choices?.[0] || {};
        const delta = choice.delta || choice.message || {};
        emit(delta.content || delta.reasoning_content || delta.reasoning || '');
      } catch {}
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) handleLine(line);
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      for (const line of buffer.split(/\r?\n/)) handleLine(line);
    }
    if (!content && rawBody.trim()) return rawBody;
    return JSON.stringify({
      choices: [{
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content },
      }],
      model: provider.model,
      usage: {},
    });
  }

  cacheGet(key, ttlMs = 5000) {
    const entry = this.toolCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > ttlMs) {
      this.toolCache.delete(key);
      return null;
    }
    return entry.value;
  }

  cacheSet(key, value) {
    this.toolCache.set(key, { value, createdAt: Date.now() });
    if (this.toolCache.size > 80) {
      for (const staleKey of [...this.toolCache.keys()].slice(0, this.toolCache.size - 80)) {
        this.toolCache.delete(staleKey);
      }
    }
    return value;
  }

  async cachedTool(key, ttlMs, factory) {
    const cached = this.cacheGet(key, ttlMs);
    if (cached) return { value: cached, cached: true };
    const value = await factory();
    this.cacheSet(key, value);
    return { value, cached: false };
  }

  rememberProviderLatency(provider, ms, ok) {
    const idValue = provider?.id || provider?.label || 'provider';
    const previous = this.providerStats.get(idValue) || { count: 0, failures: 0, avgMs: 0 };
    const count = previous.count + 1;
    this.providerStats.set(idValue, {
      count,
      failures: previous.failures + (ok ? 0 : 1),
      avgMs: Math.round(previous.avgMs ? (previous.avgMs * 0.7 + ms * 0.3) : ms),
      lastMs: ms,
      updatedAt: nowIso(),
    });
  }

  async requestChatCompletion(body, requestMeta = {}) {
    const providers = Array.isArray(this.config.providers) && this.config.providers.length
      ? this.config.providers
      : [{
          id: this.config.provider || 'nim',
          label: this.config.providerLabel || 'NVIDIA NIM',
          baseUrl: this.config.baseUrl,
          apiKey: this.config.apiKey,
          model: this.config.model,
          headers: {},
        }];
    const errors = [];
    for (const provider of providers) {
      const startedAt = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
      const meta = {
        ...requestMeta,
        provider: provider.id,
        providerLabel: provider.label,
        model: provider.model,
        baseUrl: provider.baseUrl,
      };
      try {
        logNeura('Chat completion provider attempt started', meta);
        this.recordArtifact('model-routing', `Model call: ${provider.label}`, `Started ${requestMeta.mode || 'chat'} request with ${provider.model}.`, {
          runId: this.state.activeRunId,
          provider: provider.id,
          model: provider.model,
          mode: requestMeta.mode || '',
        });
        const endpoint = provider.apiStyle === 'ollama'
          ? `${provider.baseUrl}/api/chat`
          : `${provider.baseUrl}/chat/completions`;
        const stream = Boolean(requestMeta.stream);
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: this.providerHeaders(provider),
          signal: controller.signal,
          body: JSON.stringify(this.requestBodyForProvider(provider, body, { stream })),
        });
        const rawBody = await this.readProviderResponseText(response, provider, requestMeta);
        let payload = {};
        try {
          payload = rawBody ? JSON.parse(rawBody) : {};
        } catch {
          payload = {};
        }
        if (!response.ok) {
          const providerMessage = payload.error?.message || rawBody || 'No provider error body.';
          errors.push(`${provider.label} HTTP ${response.status}: ${String(providerMessage).slice(0, 280)}`);
          logNeura('Chat completion provider attempt failed', {
            ...meta,
            status: response.status,
            providerMessage: String(providerMessage).slice(0, 500),
          });
          this.rememberProviderLatency(provider, Date.now() - startedAt, false);
          continue;
        }
        const normalizedPayload = this.normalizeProviderPayload(provider, payload);
        this.rememberProviderLatency(provider, Date.now() - startedAt, true);
        logNeura('Chat completion provider attempt completed', meta);
        return { response, payload: normalizedPayload, rawBody, provider };
      } catch (error) {
        const message = error?.name === 'AbortError'
          ? `${provider.label} timed out after ${Math.round(this.config.timeoutMs / 1000)}s`
          : `${provider.label}: ${errorMessageFor(error)}`;
        errors.push(message);
        logNeura('Chat completion provider attempt error', {
          ...meta,
          error: message,
        });
        this.rememberProviderLatency(provider, Date.now() - startedAt, false);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new Error(`All configured AI providers failed. Tried ${providers.map((provider) => provider.label).join(' -> ')}. ${errors.join(' | ')}`);
  }

  async readPersistedNeuraSettings() {
    const candidates = [
      process.env.APPDATA ? path.join(process.env.APPDATA, 'Neura', 'neura.setting.json') : '',
      path.join(os.homedir(), 'AppData', 'Roaming', 'Neura', 'neura.setting.json'),
    ].filter(Boolean);
    for (const candidate of candidates) {
      if (fsSync.existsSync(candidate)) {
        return safeReadJson(candidate);
      }
    }
    return {};
  }

  ensureWorkspace() {
    if (!this.rootPath) {
      throw new Error('Open a project folder before using Neura Composer.');
    }
  }

  safeRelative(inputPath) {
    this.ensureWorkspace();
    const cleaned = String(inputPath || '')
      .replace(/^@+/, '')
      .replace(/^["']|["']$/g, '')
      .trim();
    if (!cleaned || cleaned === 'codebase' || cleaned === 'workspace') {
      return cleaned;
    }
    const absolute = path.isAbsolute(cleaned) ? cleaned : path.join(this.rootPath, cleaned);
    const relative = path.relative(this.rootPath, absolute);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Path is outside this workspace: ${cleaned}`);
    }
    return normalizeSlashes(relative);
  }

  absoluteFor(relativePath) {
    const safe = this.safeRelative(relativePath);
    if (!safe || safe === 'codebase' || safe === 'workspace') {
      throw new Error(`Invalid file path: ${relativePath}`);
    }
    return path.join(this.rootPath, safe);
  }

  extractMentions(prompt) {
    const mentions = [];
    const regex = /(?:^|\s)@([^\s,;:()"'<>]+)/g;
    let match;
    while ((match = regex.exec(prompt))) {
      const raw = match[1].replace(/[.!?]$/, '');
      if (raw) mentions.push(raw);
    }
    return [...new Set(mentions)];
  }

  parseWorkflowPrompt(prompt, requestedMode) {
    let mode = requestedMode || this.state.mode || 'agent';
    let reasoning = this.state.reasoning || 'medium';
    let cleaned = String(prompt || '').trim();
    let command = '';
    const slash = cleaned.match(/^\/([a-z]+)(?:\s+([a-z]+))?/i);
    if (slash) {
      command = slash[1].toLowerCase();
      const value = String(slash[2] || '').toLowerCase();
      if (command === 'explain' || command === 'ask') mode = 'ask';
      if (command === 'plan') mode = 'plan';
      if (command === 'edit' || command === 'fix') mode = 'agent';
      if (command === 'build' || command === 'app') mode = 'builder';
      if (command === 'ship' || command === 'deploy' || command === 'release' || command === 'production') mode = 'ship';
      if (command === 'reasoning' || command === 'think') {
        if (reasoningLabels[value]) reasoning = value;
        cleaned = cleaned.replace(/^\/[a-z]+(?:\s+[a-z]+)?/i, '').trim();
      } else {
        cleaned = cleaned.replace(/^\/[a-z]+/i, '').trim();
      }
    }
    return { prompt: cleaned, mode, reasoning, command };
  }

  classifyIntent(prompt, context, parsed) {
    const text = String(prompt || '').trim();
    const lower = text.toLowerCase();
    const hasContext =
      (context.files || []).length > 0 ||
      (context.mentions || []).includes('codebase') ||
      (context.mentions || []).includes('workspace');

    if (parsed.command === 'mcp') {
      return { allowed: true, intent: 'mcp', mode: 'ask' };
    }
    if (parsed.command === 'reasoning' || parsed.command === 'think') {
      return { allowed: true, intent: 'reasoning', mode: parsed.mode };
    }
    if (!this.isCodingRequest(text, context)) {
      return {
        allowed: false,
        intent: 'blocked',
        mode: 'ask',
        message:
          'I’m focused on coding inside this workspace. Ask me to explain code, plan a change, edit files, fix errors, run verification, or build an app/site.',
      };
    }

    if (parsed.command === 'plan') return { allowed: true, intent: 'plan', mode: 'plan' };
    if (parsed.command === 'edit' || parsed.command === 'fix') {
      return { allowed: true, intent: 'edit', mode: 'agent' };
    }
    if (parsed.command === 'build' || parsed.command === 'app') {
      return { allowed: true, intent: 'build', mode: 'builder' };
    }
    if (parsed.command === 'ship' || parsed.command === 'deploy' || parsed.command === 'release' || parsed.command === 'production') {
      return { allowed: true, intent: 'ship', mode: 'ship' };
    }
    if (parsed.command === 'explain' || parsed.command === 'ask') {
      return { allowed: true, intent: 'explain', mode: 'ask' };
    }

    if (/\b(ship|deploy|release|publish|production|prod|launch)\b/i.test(text) || /\b(production[-\s]?ready|go live|ready to ship|shipping checklist)\b/i.test(text)) {
      if (/\b(build|create|generate|scaffold|make|start|implement)\b.*\b(app|application|site|website|page|dashboard|landing|ui|form|component|tool|project|todo|to-do|list)\b/i.test(text)) {
        return { allowed: true, intent: 'build', mode: 'builder' };
      }
      return { allowed: true, intent: 'ship', mode: 'ship' };
    }
    if (/\b(build|create|generate|scaffold|make|start|implement)\b.*\b(app|application|site|website|page|dashboard|landing|ui|form|component|tool|project|todo|to-do|list)\b/i.test(text)) {
      return { allowed: true, intent: 'build', mode: 'builder' };
    }
    if (/\b(create|make|build|generate|implement)\b/i.test(text) && /\b(notes?|todo|to-do|calculator|timer|counter|weather|chat|kanban|blog|portfolio|landing|dashboard)\b/i.test(text)) {
      return { allowed: true, intent: 'build', mode: 'builder' };
    }
    if (/\b(todo\s+list|to-do\s+list)\b/i.test(text) && /\b(create|make|build|generate|implement)\b/i.test(text)) {
      return { allowed: true, intent: 'build', mode: 'builder' };
    }
    if (/\b(run|serve|start|open|preview|launch)\b.*\b(site|website|app|application|project|preview)\b/i.test(text)) {
      return { allowed: true, intent: 'run', mode: 'agent' };
    }
    if (/\b(plan|approach|steps|architecture|design)\b/i.test(text)) {
      return { allowed: true, intent: 'plan', mode: 'plan' };
    }
    if (/\b(explain|what does|how does|why does|review|read|understand|summari[sz]e)\b/i.test(text)) {
      return { allowed: true, intent: 'explain', mode: 'ask' };
    }
    if (/\b(fix|edit|update|change|refactor|implement|delete|remove|add|rename|move|optimi[sz]e)\b/i.test(text)) {
      return { allowed: true, intent: 'edit', mode: 'agent' };
    }
    if (hasContext) {
      return { allowed: true, intent: 'explain', mode: 'ask' };
    }
    return { allowed: true, intent: 'edit', mode: parsed.mode || 'agent' };
  }

  rememberFromPrompt(prompt, intent, referencedFiles = []) {
    const text = String(prompt || '').trim();
    if (!text) return;
    const shouldRemember =
      /\b(remember|always|prefer|use|stack|framework|database|style|convention|rule)\b/i.test(text) ||
      referencedFiles.length > 0;
    if (!shouldRemember) return;
    const memory = this.state.memory || { facts: [], sessionSummaries: [], updatedAt: nowIso() };
    const fact = {
      id: id('memory'),
      kind: 'workspace-preference',
      text: text.slice(0, 280),
      intent,
      files: referencedFiles.slice(0, 8),
      createdAt: nowIso(),
    };
    const duplicate = (memory.facts || []).some((item) => item.text === fact.text);
    if (!duplicate) {
      memory.facts = [fact, ...(memory.facts || [])].slice(0, 80);
      memory.updatedAt = nowIso();
      this.state.memory = memory;
    }
  }

  async rememberCurrentSessionSummary() {
    const messages = this.state.messages || [];
    const userMessages = messages.filter((message) => message.role === 'user');
    if (!userMessages.length) return;
    const memory = this.state.memory || { facts: [], sessionSummaries: [], updatedAt: nowIso() };
    const summary = {
      id: id('summary'),
      sessionId: this.state.activeSessionId,
      title: this.sessionTitle({ messages }),
      summary: userMessages
        .slice(-3)
        .map((message) => message.content)
        .join(' | ')
        .slice(0, 500),
      files: [...new Set(messages.flatMap((message) => message.referencedFiles || []))].slice(0, 12),
      updatedAt: nowIso(),
    };
    memory.sessionSummaries = [
      summary,
      ...(memory.sessionSummaries || []).filter((item) => item.sessionId !== summary.sessionId),
    ].slice(0, 40);
    memory.updatedAt = nowIso();
    this.state.memory = memory;
  }

  latestBuildProposal() {
    return (this.state.proposals || []).find(
      (proposal) => proposal.mode === 'builder' || proposal.preview || (proposal.edits || []).length,
    );
  }

  async handleRunIntent(thinkingMessage) {
    const proposal = this.latestBuildProposal();
    if (!proposal) {
      thinkingMessage.content = JSON.stringify({
        kind: 'thinking',
        status: 'done',
        title: 'Thinking',
        text: 'The user asked to run a website, but this workspace does not have a built app proposal yet.',
      });
      this.state.messages.push({
        id: id('msg'),
        role: 'assistant',
        mode: 'agent',
        content:
          'There is no built website to run yet. Ask me to build it first, for example: “create a notes taking app”. I should then show file changes for you to accept.',
        createdAt: nowIso(),
      });
      await this.saveState();
      this.renderIfVisible();
      return true;
    }

    const unapplied = (proposal.edits || []).filter((edit) => edit.status === 'proposed');
    if (unapplied.length) {
      thinkingMessage.content = JSON.stringify({
        kind: 'thinking',
        status: 'done',
        title: 'Thinking',
        text: `Found a build proposal with ${unapplied.length} unapplied file change(s).`,
      });
      this.state.messages.push({
        id: id('msg'),
        role: 'assistant',
        mode: 'agent',
        content: 'The website has proposed file changes that are not applied yet. Accept the file changes first, then run the website.',
        createdAt: nowIso(),
      });
      await this.saveState();
      this.renderIfVisible();
      return true;
    }

    const command = (proposal.commands || []).find((item) =>
      /\b(dev|serve|start|preview|live-server|vite|next dev|npm run)\b/i.test(item.command || ''),
    );
    if (command) {
      thinkingMessage.content = JSON.stringify({
        kind: 'thinking',
        status: 'done',
        title: 'Thinking',
        text: `Running the existing preview command: ${command.command}`,
      });
      await this.runCommand(proposal.id, command.id, command.command);
      await this.saveState();
      this.renderIfVisible();
      return true;
    }

    thinkingMessage.content = JSON.stringify({
      kind: 'thinking',
      status: 'done',
      title: 'Thinking',
      text: 'No preview command exists on the latest build proposal.',
    });
    this.state.messages.push({
      id: id('msg'),
      role: 'assistant',
      mode: 'agent',
      content: 'I found the build proposal, but it does not include a run/preview command. Ask me to add a preview command or run one manually in the terminal.',
      createdAt: nowIso(),
    });
    await this.saveState();
    this.renderIfVisible();
    return true;
  }

  updateThinkingMessage(thinkingMessage, patch) {
    let payload = {};
    try {
      payload = JSON.parse(thinkingMessage.content || '{}');
    } catch {
      payload = {};
    }
    thinkingMessage.content = JSON.stringify({
      kind: 'thinking',
      status: payload.status || 'running',
      title: payload.title || 'Thinking...',
      text: payload.text || '',
      steps: payload.steps || [],
      ...patch,
    });
  }

  async flushThinking(thinkingMessage, patch, isBusy = true) {
    this.updateThinkingMessage(thinkingMessage, patch);
    await this.saveState();
    this.renderIfVisible(isBusy);
  }

  agenticSystemPrompt(mode) {
    const editableInstruction =
      mode === 'ship'
        ? 'You are preparing a production-ready release. A final answer must include production verification, preview, packaging, or deploy command proposals, and must include file edits when deployment/config/readiness files are missing.'
        : mode === 'builder'
        ? 'You are building or extending a production-ready app/site. A final answer without real file edits plus verification/preview command proposals is invalid unless you ask a blocking question.'
        : 'You are editing an existing codebase. A final answer should include file edits or command proposals unless the task is only diagnostic.';
    const toolLines = agentTools.map((tool) => `- ${tool.action}: args ${tool.args} - ${tool.description}`);
    return [
      'You are Neura Agent, an agentic coding runtime inside Neura IDE.',
      'Operate through the provided JSON action protocol. Return exactly one JSON object, no markdown.',
      'Do not reveal private chain-of-thought. The "thought" field must be a short public progress summary.',
      editableInstruction,
      'Available actions:',
      ...toolLines,
      '- ask_user: args {"message":"why blocked","questions":["question"]}',
      '- finish: args {"message":"summary","todos":[{"title":"task","rationale":"why","status":"pending"}],"edits":[{"operation":"create|update|delete","filePath":"relative/path","content":"full file content","rationale":"why"}],"commands":[{"command":"shell command","purpose":"why"}],"preview":{"command":"shell command","url":"http://localhost:port"},"referencedFiles":["path"]}',
      'You may also return {"actions":[...]} or action "tool_batch" to run independent observation tools in the same step.',
      'Use inspect_package_scripts before proposing npm/pnpm/yarn commands. Use git_status before final edits when touching an existing repo.',
      'Use production_profile before finishing Build or Ship mode. Build output must be production-ready by default, not a prototype.',
      'Build and Ship modes should propose a clear preflight sequence: install if needed, lint/typecheck/test/build, preview/browser verification, and deploy/dry-run commands when a deploy target exists.',
      'For production readiness, add or repair real files only when appropriate: package scripts, netlify.toml, vercel.json, Dockerfile, .env.example, GitHub Actions CI, README deploy notes, or accessibility/responsive UI files. Never invent secret values.',
      'Use run_command only for verification in Full Auto mode. In all other permission modes, include terminal commands in finish.commands for approval.',
      'Use read_file/search before changing existing files when the workspace is not empty.',
      'For simple static apps, produce complete index.html, styles.css, and app.js edits with responsive layout, accessible controls, useful empty/error states, durable local state when relevant, and a preview command. Use full-file content for create/update.',
      'If components.json is present, use shadcn_info before proposing shadcn/ui changes. Prefer official shadcn CLI commands as proposed terminal commands instead of inventing registry internals.',
      'Commands are proposals only; the UI asks permission before running unless Full Auto is selected.',
      'Read Only permission forbids edits and command proposals. Ask Permission modes still allow proposals, but the user must approve before writes or commands run.',
      `Reasoning requested by UI: ${reasoningLabels[this.state.reasoning] || 'Medium'}.`,
    ].join('\n');
  }

  agentToolPrompt(prompt, context, attachments) {
    const base = this.contextPrompt(prompt, context, attachments);
    return [
      base,
      '',
      'Start by choosing the next tool action. If enough information is available, finish with concrete edits/commands.',
    ].join('\n');
  }

  async callNimAgentAction(messages, mode, stepIndex, thinkingMessage = null, currentSteps = [], taskGraph = null) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    let lastProgressAt = 0;
    const requestMeta = {
      mode: `${mode}-agent-step`,
      model: this.config.model,
      provider: this.config.provider,
      baseUrl: this.config.baseUrl,
      timeoutMs: this.config.timeoutMs,
      stepIndex,
      stream: true,
      onProgress: (_delta, fullText) => {
        if (!thinkingMessage || Date.now() - lastProgressAt < 700) return;
        lastProgressAt = Date.now();
        thinkingMessage.content = JSON.stringify({
          kind: 'thinking',
          status: 'running',
          title: 'Thinking...',
          text: String(fullText || '').slice(-1200) || `Step ${stepIndex}: receiving model response.`,
          steps: currentSteps,
          taskGraph,
        });
        this.renderIfVisible(true);
      },
    };
    logNeura('Agent step request started', requestMeta);
    try {
      const { payload, rawBody, provider } = await this.requestChatCompletion({
        temperature: 0.12,
        max_tokens: 4500,
        messages,
      }, requestMeta);
      requestMeta.provider = provider.id;
      requestMeta.providerLabel = provider.label;
      requestMeta.model = provider.model;
      void rawBody;
      const choice = payload.choices?.[0] || {};
      const message = choice.message || {};
      const content = typeof message.content === 'string' ? message.content : '';
      const reasoningText =
        typeof message.reasoning_content === 'string'
          ? message.reasoning_content
          : typeof message.reasoning === 'string'
            ? message.reasoning
            : '';
      if (!content) {
        throw new Error(
          reasoningText
            ? `${provider.label} returned reasoning but no agent action for ${provider.model}.`
            : `${provider.label} returned an empty agent action for ${provider.model}.`,
        );
      }
      const action = parseJsonObject(content);
      logNeura('Agent step request completed', {
        ...requestMeta,
        action: action.action,
        replyChars: content.length,
      });
      return action;
    } catch (error) {
      logNeura('Agent step request error', {
        ...requestMeta,
        error: errorMessageFor(error),
      });
      if (error?.name === 'AbortError') {
        throw new Error(
          `No AI provider returned an agent step within the configured timeout. Tried ${this.config.providers?.map((provider) => provider.label).join(' -> ') || this.config.providerLabel || 'the active provider'}.`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  normalizeAgentAction(rawAction) {
    const action = String(rawAction?.action || rawAction?.tool || rawAction?.name || '').trim().toLowerCase();
    const aliases = {
      list: 'list_files',
      listfiles: 'list_files',
      read: 'read_file',
      readfile: 'read_file',
      grep: 'search',
      search_files: 'search',
      question: 'ask_user',
      ask: 'ask_user',
      final: 'finish',
      done: 'finish',
      propose_edits: 'finish',
      write_files: 'finish',
      package_scripts: 'inspect_package_scripts',
      scripts: 'inspect_package_scripts',
      production: 'production_profile',
      production_ready: 'production_profile',
      readiness: 'production_profile',
      deploy_profile: 'production_profile',
      shipping: 'production_profile',
      status: 'git_status',
      shell: 'run_command',
      terminal: 'run_command',
      command: 'run_command',
      batch: 'tool_batch',
      tools: 'tool_batch',
    };
    return {
      thought: String(rawAction?.thought || rawAction?.message || '').slice(0, 500),
      action: aliases[action] || action,
      args: rawAction?.args || rawAction?.arguments || rawAction?.result || rawAction || {},
    };
  }

  normalizeAgentActions(rawAction) {
    const candidates = Array.isArray(rawAction?.actions)
      ? rawAction.actions
      : Array.isArray(rawAction?.toolCalls)
        ? rawAction.toolCalls
        : Array.isArray(rawAction?.tool_calls)
          ? rawAction.tool_calls
          : null;
    if (candidates?.length) {
      return candidates.slice(0, 6).map((item) => this.normalizeAgentAction(item));
    }
    const normalized = this.normalizeAgentAction(rawAction);
    if (normalized.action === 'tool_batch') {
      const actions = Array.isArray(normalized.args?.actions) ? normalized.args.actions : [];
      return actions.slice(0, 6).map((item) => this.normalizeAgentAction(item));
    }
    return [normalized];
  }

  isDangerousCommand(command) {
    const value = String(command || '').trim().toLowerCase();
    return /(^|\s)(rm\s+-rf|del\s+\/[fsq]|rmdir\s+\/s|format\b|diskpart\b|shutdown\b|reboot\b|mkfs\b|dd\s+if=|powershell\s+.*remove-item\s+.*-recurse|remove-item\s+.*-recurse|git\s+reset\s+--hard|git\s+clean\s+-fd|curl\s+.*\|\s*(sh|bash|powershell)|wget\s+.*\|\s*(sh|bash|powershell))/.test(value);
  }

  normalizeCommandForPlatform(command) {
    let value = String(command || '').trim();
    if (!value) return value;
    if (process.platform !== 'win32') return value;
    value = value.replace(/\bmkdir\s+-p\s+([^&|;\r\n]+)/gi, (_match, dirs) => {
      const normalizedDirs = String(dirs || '')
        .split(/\s+/)
        .filter(Boolean)
        .map((dir) => dir.replace(/^['"]|['"]$/g, '').replace(/\//g, '\\'))
        .map((dir) => /\s/.test(dir) ? `"${dir}"` : dir)
        .join(' ');
      return `mkdir ${normalizedDirs}`;
    });
    value = value.replace(/\btouch\s+([^&|;\r\n]+)/gi, (_match, files) => {
      const commands = String(files || '')
        .split(/\s+/)
        .filter(Boolean)
        .map((file) => file.replace(/^['"]|['"]$/g, '').replace(/\//g, '\\'))
        .map((file) => `if not exist ${/\s/.test(file) ? `"${file}"` : file} type nul > ${/\s/.test(file) ? `"${file}"` : file}`);
      return commands.join(' && ');
    });
    value = value.replace(/\bcp\s+-r\s+([^\s&|;]+)\s+([^\s&|;]+)/gi, (_match, from, to) => {
      const source = String(from || '').replace(/\//g, '\\');
      const dest = String(to || '').replace(/\//g, '\\');
      return `xcopy ${source} ${dest} /E /I /Y`;
    });
    value = value.replace(/\bnpm\s+run\s+dev\s+--\s+--host\s+0\.0\.0\.0\b/gi, 'npm run dev -- --host localhost');
    return value;
  }

  async inspectPackageScripts(filePath = 'package.json') {
    const safe = this.safeRelative(filePath || 'package.json');
    const absolute = this.absoluteFor(safe);
    if (!fsSync.existsSync(absolute)) {
      return { exists: false, filePath: safe, scripts: {}, dependencies: {}, devDependencies: {} };
    }
    const pkg = await safeReadJson(absolute);
    return {
      exists: true,
      filePath: safe,
      packageManager: fsSync.existsSync(path.join(this.rootPath, 'pnpm-lock.yaml'))
        ? 'pnpm'
        : fsSync.existsSync(path.join(this.rootPath, 'yarn.lock'))
          ? 'yarn'
          : 'npm',
      scripts: pkg.scripts || {},
      dependencies: Object.keys(pkg.dependencies || {}).slice(0, 80),
      devDependencies: Object.keys(pkg.devDependencies || {}).slice(0, 80),
    };
  }

  async gitStatusSummary() {
    const output = await execFileAsync('git', ['status', '--porcelain=v1', '-uall'], this.rootPath).catch((error) => `git status failed: ${errorMessageFor(error)}`);
    const entries = String(output || '')
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .slice(0, 120)
      .map((line) => ({ status: line.slice(0, 2).trim() || 'modified', filePath: normalizeSlashes(line.slice(3).trim()) }));
    return { clean: entries.length === 0, entries };
  }

  async executeAgentTool(action) {
    const name = action.action;
    const args = action.args || {};
    if (name === 'list_files') {
      const limit = Math.max(20, Math.min(Number(args.limit || 120), 240));
      const cached = await this.cachedTool(`list_files:${limit}`, 6000, async () => this.projectTree(limit));
      const files = cached.value;
      return {
        ok: true,
        summary: `Listed ${files.length} workspace file(s)${cached.cached ? ' from cache' : ''}.`,
        files,
      };
    }
    if (name === 'read_file') {
      const filePath = this.safeRelative(args.filePath);
      const file = await this.readWorkspaceFile(filePath, Math.max(maxContextBytes, 22000));
      return {
        ok: true,
        summary: `Read ${file.filePath}${file.truncated ? ' (truncated)' : ''}.`,
        file,
      };
    }
    if (name === 'search') {
      const matches = await this.searchWorkspace(args.query, Number(args.limit || agentSearchMatchLimit));
      return {
        ok: true,
        summary: `Found ${matches.length} match(es) for "${String(args.query || '').slice(0, 80)}".`,
        matches,
      };
    }
    if (name === 'inspect_package_scripts') {
      const cached = await this.cachedTool(`package:${args.filePath || 'package.json'}`, 8000, async () => this.inspectPackageScripts(args.filePath || 'package.json'));
      const packageInfo = cached.value;
      return {
        ok: true,
        summary: packageInfo.exists
          ? `Read ${packageInfo.filePath}: ${Object.keys(packageInfo.scripts || {}).length} script(s), package manager ${packageInfo.packageManager}.`
          : `${packageInfo.filePath} was not found.`,
        packageInfo,
      };
    }
    if (name === 'production_profile') {
      const cached = await this.cachedTool('production_profile', 8000, async () => this.detectProductionProfile());
      const profile = cached.value;
      return {
        ok: true,
        summary: `Detected ${profile.framework} production profile with ${profile.commands.length} command(s), ${profile.deployTargets.length} deploy target(s), and ${profile.missing.length} readiness gap(s).`,
        profile,
      };
    }
    if (name === 'git_status') {
      const cached = await this.cachedTool('git_status', 3000, async () => this.gitStatusSummary());
      const status = cached.value;
      return {
        ok: true,
        summary: status.clean ? 'Git working tree is clean.' : `Git has ${status.entries.length} changed/untracked file(s).`,
        status,
      };
    }
    if (name === 'get_diagnostics') {
      const cached = await this.cachedTool(`diagnostics:${args.filePath || 'workspace'}`, 2500, async () => this.workspaceDiagnostics(args.filePath || ''));
      const diagnostics = cached.value;
      return {
        ok: true,
        summary: `Read ${diagnostics.length} diagnostic(s).`,
        diagnostics,
      };
    }
    if (name === 'shadcn_info') {
      const shadcn = await this.readShadcnContext();
      return {
        ok: true,
        summary: shadcn ? 'Read shadcn/ui project configuration.' : 'No components.json found in this workspace.',
        shadcn,
      };
    }
    if (name === 'preview_status') {
      return {
        ok: true,
        summary: 'Read latest preview status.',
        status: this.latestPreviewStatus(),
      };
    }
    if (name === 'semantic_search') {
      const cached = await this.cachedTool(`semantic:${String(args.query || '').slice(0, 80)}:${Number(args.limit || 20)}`, 15000, async () => this.semanticSearch(args.query, Number(args.limit || 20)));
      const hits = cached.value;
      return {
        ok: true,
        summary: `Found ${hits.length} semantic index hit(s).`,
        hits,
      };
    }
    if (name === 'browser_verify') {
      const result = await this.browserVerify(args.url || this.state.preview?.url || '');
      return {
        ok: result.ok,
        summary: result.summary,
        result,
      };
    }
    if (name === 'browser_agent') {
      const result = await this.browserAgentInteract({
        url: args.url || this.state.preview?.url || '',
        steps: Array.isArray(args.steps) ? args.steps : [],
        label: args.label || 'agent-tool',
      });
      return {
        ok: result.ok,
        summary: result.summary,
        result,
      };
    }
    if (name === 'run_command') {
      const command = this.normalizeCommandForPlatform(args.command || '');
      if (!command) {
        return { ok: false, summary: 'run_command requires args.command.' };
      }
      if (this.isDangerousCommand(command)) {
        return {
          ok: false,
          summary: 'Command blocked by Neura guardrails. Propose a safer command or ask the user.',
          command,
        };
      }
      if (!this.canAutoRunCommands()) {
        return {
          ok: true,
          summary: `Permission mode is ${permissionLabels[this.state.permissionMode] || this.state.permissionMode}; command was not auto-run. Include it in finish.commands for user approval.`,
          command,
          requiresApproval: true,
        };
      }
      const terminal = await this.runCommand(undefined, undefined, command, {
        skipConfirmation: true,
        waitForExit: true,
      });
      return {
        ok: terminal?.status === 'passed',
        summary: `Command ${terminal?.status || 'unknown'}${Number.isFinite(terminal?.exitCode) ? ` with exit ${terminal.exitCode}` : ''}.`,
        command,
        terminal: terminal ? {
          id: terminal.id,
          status: terminal.status,
          exitCode: terminal.exitCode,
          stdoutTail: String(terminal.stdout || '').slice(-4000),
          stderrTail: String(terminal.stderr || '').slice(-4000),
        } : null,
      };
    }
    return {
      ok: false,
      summary: `Unknown agent action "${name}". Use ${agentTools.map((tool) => tool.action).join(', ')}, ask_user, or finish.`,
    };
  }

  normalizeAgentFinish(mode, action, context) {
    const args = action.args || {};
    const result = args.result && typeof args.result === 'object' ? args.result : args;
    const message = String(result.message || action.thought || 'Neura prepared a coding proposal.');
    return {
      message,
      questions: Array.isArray(result.questions) ? result.questions : [],
      todos: Array.isArray(result.todos) ? result.todos : [],
      edits: Array.isArray(result.edits) ? result.edits : [],
      commands: Array.isArray(result.commands) ? result.commands : [],
      preview: result.preview || null,
      referencedFiles: Array.isArray(result.referencedFiles)
        ? result.referencedFiles
        : context.files.map((file) => file.filePath),
      _thinking: action.thought || '',
      _mode: mode,
    };
  }

  normalizeTaskGraph(rawGraph, previousGraph = null, stage = 'updated') {
    const source = rawGraph && typeof rawGraph === 'object' ? rawGraph : {};
    const previousItems = Array.isArray(previousGraph?.items) ? previousGraph.items : [];
    const rawItems = Array.isArray(source.items)
      ? source.items
      : Array.isArray(source.todos)
        ? source.todos
        : previousItems;
    const allowedStatuses = new Set(['pending', 'running', 'blocked', 'done', 'failed', 'skipped']);
    const listOfStrings = (value, limit = 8) => (Array.isArray(value) ? value.map(String).filter(Boolean).slice(0, limit) : []);
    const items = rawItems
      .slice(0, 18)
      .map((item, index) => {
        const status = String(item.status || previousItems[index]?.status || 'pending').toLowerCase();
        return {
          id: String(item.id || previousItems[index]?.id || `task-${index + 1}`).slice(0, 60),
          title: String(item.title || item.task || previousItems[index]?.title || `Task ${index + 1}`).slice(0, 160),
          status: allowedStatuses.has(status) ? status : 'pending',
          rationale: String(item.rationale || item.reason || item.description || '').slice(0, 320),
          files: listOfStrings(item.files, 8),
          dependsOn: listOfStrings(item.dependsOn, 8),
          ownerRole: String(item.ownerRole || item.role || previousItems[index]?.ownerRole || '').slice(0, 60),
          executorStatus: String(item.executorStatus || item.execution || previousItems[index]?.executorStatus || status).slice(0, 60),
          acceptance: String(item.acceptance || item.acceptanceCriteria || previousItems[index]?.acceptance || '').slice(0, 360),
          handoff: String(item.handoff || item.handoffNote || previousItems[index]?.handoff || '').slice(0, 360),
          priority: Number.isFinite(Number(item.priority)) ? Number(item.priority) : index + 1,
        };
      })
      .filter((item) => item.title);
    const priorUpdates = Array.isArray(previousGraph?.updates) ? previousGraph.updates : [];
    const update = {
      at: nowIso(),
      stage,
      summary: String(source.summary || source.message || `${stage} planner update`).slice(0, 500),
    };
    return {
      id: previousGraph?.id || id('graph'),
      goal: String(source.goal || previousGraph?.goal || '').slice(0, 240),
      status: String(source.status || previousGraph?.status || 'running').slice(0, 40),
      controllerStatus: String(source.controllerStatus || source.status || previousGraph?.controllerStatus || 'running').slice(0, 40),
      version: Number(previousGraph?.version || 0) + 1,
      items,
      nextRoles: listOfStrings(source.nextRoles || source.nextExecutors || previousGraph?.nextRoles, 10),
      blockedReasons: listOfStrings(source.blockedReasons || source.blockers || previousGraph?.blockedReasons, 10),
      risks: listOfStrings(source.risks || previousGraph?.risks, 10),
      updates: [update, ...priorUpdates].slice(0, 30),
      updatedAt: nowIso(),
    };
  }

  async callNimPlannerGraph(mode, prompt, context, currentGraph, observation, stage) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const tree = (context.tree || []).slice(0, 120).join('\n') || '(empty)';
    const diagnostics = (context.diagnostics || [])
      .slice(0, 20)
      .map((item) => `${item.filePath}:${item.line}:${item.column} ${item.severity} ${item.message}`)
      .join('\n') || 'none';
    const selectedFiles = (context.files || []).map((file) => file.filePath).join('\n') || 'none';
    const agents = (context.agents || [])
      .slice(0, 24)
      .map((agent) => [
        `${agent.roleId || agent.id}: ${agent.status || 'ready'}`,
        agent.summary ? `summary=${agent.summary}` : '',
        agent.error ? `error=${agent.error}` : '',
        agent.dependencies?.length ? `depends=${agent.dependencies.join(',')}` : '',
        agent.handoff ? `handoff=${agent.handoff}` : '',
      ].filter(Boolean).join(' | '))
      .join('\n') || 'none';
    try {
      const { payload } = await this.requestChatCompletion({
        temperature: 0.08,
        max_tokens: 1800,
        messages: [
          {
            role: 'system',
            content: [
              'You are Neura Planner, a separate planning loop supervising an executor agent.',
              'Return exactly one JSON object, no markdown.',
              'Maintain a compact task graph that can change as new observations arrive.',
              'When supervising a swarm, act as a controller: choose the next role IDs, identify blockers, update handoffs, and revise acceptance criteria while executors work.',
              'Do not produce file contents. Do not execute commands. Do not reveal private chain-of-thought.',
              'Statuses must be one of: pending, running, blocked, done, failed, skipped.',
              'Use nextRoles only for role IDs that should run now or next. If blocked, include blockedReasons.',
              'Schema: {"goal":"short goal","status":"running|blocked|done|failed","controllerStatus":"running|blocked|done|failed","summary":"what changed in the plan","nextRoles":["frontend"],"blockedReasons":["reason"],"risks":["risk"],"items":[{"id":"stable-id","title":"task","ownerRole":"frontend|backend|qa|...","status":"pending|running|blocked|done|failed|skipped","executorStatus":"ready|running|waiting|done|failed","priority":1,"rationale":"why this task exists or changed","acceptance":"done criteria","handoff":"specific instructions for owner role","files":["relative/path"],"dependsOn":["task-id"]}]}',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              `Stage: ${stage}`,
              `Mode: ${modeLabels[mode] || mode}`,
              `User request:\n${prompt}`,
              `Current task graph:\n${currentGraph ? JSON.stringify(currentGraph).slice(0, 6000) : '(none)'}`,
              `Latest executor observation:\n${observation ? JSON.stringify(observation).slice(0, 5000) : '(initial planning pass)'}`,
              `Swarm agents:\n${agents}`,
              `Selected files:\n${selectedFiles}`,
              `Workspace tree:\n${tree}`,
              `Diagnostics:\n${diagnostics}`,
            ].join('\n\n'),
          },
        ],
      }, {
        mode: 'planner-graph',
        stage,
        timeoutMs: this.config.timeoutMs,
      });
      const content = payload.choices?.[0]?.message?.content || '';
      if (!content) throw new Error('Planner returned an empty response.');
      return this.normalizeTaskGraph(parseJsonObject(content), currentGraph, stage);
    } finally {
      clearTimeout(timeout);
    }
  }

  async reviseTaskGraph(mode, prompt, context, taskGraph, observation, stage) {
    try {
      return await this.callNimPlannerGraph(mode, prompt, context, taskGraph, observation, stage);
    } catch (error) {
      logNeura('Planner graph revision failed', { stage, error: errorMessageFor(error) });
      const graph = this.normalizeTaskGraph(taskGraph || { goal: prompt, items: [] }, taskGraph, stage);
      graph.updates[0].summary = `Planner update failed: ${errorMessageFor(error)}`;
      return graph;
    }
  }

  fallbackSwarmTaskGraph(mission, agents, stage, summary = '') {
    const items = agents.map((agent, index) => {
      const role = swarmRoleById[agent.roleId] || {};
      const statusMap = {
        ready: 'pending',
        queued: 'running',
        running: 'running',
        completed: 'done',
        failed: 'failed',
        cancelled: 'failed',
        interrupted: 'blocked',
        blocked: 'blocked',
      };
      return {
        id: `role-${agent.roleId || index + 1}`,
        title: `${agent.roleLabel || role.label || agent.roleId || 'Agent'}: ${role.mission || agent.task || 'Complete role work'}`,
        ownerRole: agent.roleId || role.id || '',
        status: statusMap[agent.status] || 'pending',
        executorStatus: agent.status || 'ready',
        priority: index + 1,
        rationale: role.focus?.length ? `Focus: ${role.focus.join(', ')}` : 'Role-owned swarm task.',
        acceptance: role.deliverables?.length ? role.deliverables.join('; ') : 'Complete role handoff with evidence.',
        handoff: agent.summary || agent.error || '',
        files: [],
        dependsOn: (agent.dependencies || []).map((dependency) => `role-${dependency}`),
      };
    });
    const runnable = agents
      .filter((agent) => ['ready', 'queued'].includes(agent.status || 'ready'))
      .filter((agent) => (agent.dependencies || []).every((dependency) => agents.some((peer) => peer.roleId === dependency && peer.status === 'completed')))
      .map((agent) => agent.roleId)
      .filter(Boolean)
      .slice(0, 6);
    return this.normalizeTaskGraph({
      goal: mission.task,
      status: mission.status === 'blocked' ? 'blocked' : mission.status === 'completed' ? 'done' : 'running',
      controllerStatus: mission.status || 'ready',
      summary: summary || `Planner controller refreshed ${agents.length} role lane(s).`,
      nextRoles: runnable,
      blockedReasons: mission.error ? [mission.error] : [],
      risks: (mission.conflicts || []).map((conflict) => `Conflict risk: ${conflict.filePath}`),
      items,
    }, mission.taskGraph || null, stage);
  }

  async buildSwarmPlannerContext(mission) {
    const agents = (this.state.backgroundAgents || []).filter((agent) => mission.agentIds?.includes(agent.id));
    const tree = await this.projectTree(160).catch(() => []);
    const diagnostics = await this.workspaceDiagnostics().catch(() => []);
    const semanticHits = await this.semanticSearch(mission.task || '', 16).catch(() => []);
    return {
      mentions: ['codebase'],
      files: [],
      tree,
      diagnostics,
      semanticHits,
      agents: agents.map((agent) => ({
        id: agent.id,
        roleId: agent.roleId,
        roleLabel: agent.roleLabel,
        squad: agent.squad,
        status: agent.status,
        dependencies: agent.dependencies || [],
        ownership: agent.ownership || [],
        summary: agent.summary || '',
        error: agent.error || '',
        edits: (agent.edits || []).slice(-12),
        commands: (agent.commands || []).slice(-6),
        verification: (agent.verification || []).slice(-6),
        attempts: (agent.attempts || []).slice(-3),
        handoff: agent.summary || agent.error || '',
      })),
    };
  }

  async reviseSwarmPlan(mission, observation = {}, stage = 'updated') {
    const agents = (this.state.backgroundAgents || []).filter((agent) => mission.agentIds?.includes(agent.id));
    if (!agents.length) {
      mission.taskGraph = this.fallbackSwarmTaskGraph(mission, [], stage, 'Planner waiting for role agents.');
      return mission.taskGraph;
    }
    let graph;
    if (this.config.configured) {
      const context = await this.buildSwarmPlannerContext(mission);
      graph = await this.reviseTaskGraph(
        'agent',
        mission.task,
        context,
        mission.taskGraph || null,
        {
          ...observation,
          missionStatus: mission.status,
          waves: (mission.waves || []).slice(-6),
          conflicts: mission.conflicts || [],
        },
        stage,
      );
    } else {
      graph = this.fallbackSwarmTaskGraph(mission, agents, stage, 'No AI provider is configured; using dependency-based fallback plan.');
    }
    if (!Array.isArray(graph.items) || !graph.items.length) {
      const failedSummary = graph.updates?.[0]?.summary || 'Planner returned no executable role tasks.';
      graph = this.fallbackSwarmTaskGraph(mission, agents, stage, failedSummary);
    }
    const validRoleIds = new Set(agents.map((agent) => agent.roleId).filter(Boolean));
    graph.nextRoles = (graph.nextRoles || []).filter((roleId) => validRoleIds.has(roleId)).slice(0, 8);
    mission.taskGraph = graph;
    mission.planner = {
      status: graph.controllerStatus || graph.status || 'running',
      version: graph.version,
      nextRoles: graph.nextRoles || [],
      blockedReasons: graph.blockedReasons || [],
      risks: graph.risks || [],
      updatedAt: nowIso(),
    };
    await this.persistSwarmMission(mission, `planner-${stage}`, {
      summary: graph.updates?.[0]?.summary || '',
      nextRoles: graph.nextRoles || [],
      blockedReasons: graph.blockedReasons || [],
      risks: graph.risks || [],
    });
    this.recordArtifact('swarm-planner', `Planner controller: ${mission.task}`, graph.updates?.[0]?.summary || 'Planner controller updated.', {
      missionId: mission.id,
      stage,
      version: graph.version,
      nextRoles: graph.nextRoles || [],
      blockedReasons: graph.blockedReasons || [],
      risks: graph.risks || [],
    });
    return graph;
  }

  plannerSelectedRunnable(mission, dependencyReadyAgents) {
    const nextRoles = (mission.taskGraph?.nextRoles || mission.planner?.nextRoles || []).filter(Boolean);
    if (!nextRoles.length) return dependencyReadyAgents;
    const selected = dependencyReadyAgents.filter((agent) => nextRoles.includes(agent.roleId));
    return selected.length ? selected : dependencyReadyAgents;
  }

  async runAgenticWorkflow(mode, prompt, context, attachments, thinkingMessage, continuation = null) {
    const steps = continuation?.steps ? [...continuation.steps] : [];
    let taskGraph = continuation?.taskGraph || null;
    const messages = continuation?.messages
      ? [
          ...continuation.messages,
          {
            role: 'user',
            content: 'Continue from the stopped trajectory. Use the previous observations, take the next best tool action, and finish with concrete edits/commands when ready.',
          },
        ]
      : [
          { role: 'system', content: this.agenticSystemPrompt(mode) },
          { role: 'user', content: this.agentToolPrompt(prompt, context, attachments) },
        ];
    let result = null;
    if (!taskGraph) {
      taskGraph = await this.reviseTaskGraph(mode, prompt, context, null, null, 'initial');
      await this.flushThinking(thinkingMessage, {
        status: 'running',
        title: 'Planning...',
        text: taskGraph.updates?.[0]?.summary || 'Planner created the initial task graph.',
        steps,
        taskGraph,
      });
    }

    for (let localStep = 1; localStep <= agentMaxSteps; localStep += 1) {
      const stepIndex = steps.length + 1;
      await this.flushThinking(thinkingMessage, {
        status: 'running',
        title: 'Thinking...',
        text: `Step ${stepIndex}: deciding the next workspace action.`,
        steps,
        taskGraph,
      });
      const rawAction = await this.callNimAgentAction(messages, mode, stepIndex, thinkingMessage, steps, taskGraph);
      const actions = this.normalizeAgentActions(rawAction);
      const primaryAction = actions[0] || { action: 'unknown', thought: '' };
      const step = {
        title: primaryAction.thought || `Agent action: ${actions.map((action) => action.action || 'unknown').join(', ')}`,
        action: actions.map((action) => action.action || 'unknown').join(', '),
        status: 'running',
      };
      steps.push(step);
      await this.flushThinking(thinkingMessage, {
        status: 'running',
        title: 'Thinking...',
        text: step.title,
        steps,
        taskGraph,
      });

      if (actions.length === 1 && primaryAction.action === 'ask_user') {
        step.status = 'done';
        step.observation = 'Neura needs user input before changing files.';
        result = {
          message: String(primaryAction.args.message || primaryAction.thought || 'I need a little more information before editing files.'),
          questions: Array.isArray(primaryAction.args.questions) ? primaryAction.args.questions : [],
          referencedFiles: context.files.map((file) => file.filePath),
          _thinking: step.title,
        };
        break;
      }

      if (actions.length === 1 && primaryAction.action === 'finish') {
        step.status = 'done';
        step.observation = 'Prepared final file changes and command proposals.';
        result = this.normalizeAgentFinish(mode, primaryAction, context);
        break;
      }

      const observations = [];
      for (const action of actions) {
        if (action.action === 'finish' || action.action === 'ask_user') {
          observations.push({
            action: action.action,
            ok: false,
            summary: `${action.action} cannot be mixed with other tool calls. Return it as the only action.`,
          });
          continue;
        }
        try {
          const observation = await this.executeAgentTool(action);
          observations.push({ action: action.action, ...observation });
        } catch (error) {
          observations.push({
            action: action.action,
            ok: false,
            summary: errorMessageFor(error),
          });
        }
      }
      const failedObservation = observations.find((observation) => !observation.ok);
      step.status = failedObservation ? 'failed' : 'done';
      step.observation = observations.map((observation) => `${observation.action}: ${observation.summary}`).join(' | ');
      this.recordArtifact('agent-tool-step', `Tool step ${stepIndex}: ${step.action}`, step.observation, {
        runId: this.state.activeRunId,
        step: stepIndex,
        actions: actions.map((action) => ({ action: action.action, args: action.args })),
        observations: observations.map((observation) => ({
          action: observation.action,
          ok: observation.ok,
          summary: observation.summary,
        })),
      });
      taskGraph = await this.reviseTaskGraph(mode, prompt, context, taskGraph, {
        action: step.action,
        step: stepIndex,
        observations,
      }, `after-${primaryAction.action || 'step'}`);
      await this.flushThinking(thinkingMessage, {
        status: 'running',
        title: 'Planning...',
        text: taskGraph.updates?.[0]?.summary || 'Planner revised the task graph.',
        steps,
        taskGraph,
      });
      messages.push({ role: 'assistant', content: JSON.stringify(rawAction) });
      messages.push({
        role: 'user',
        content: `Observation for ${step.action}:\n${JSON.stringify(observations).slice(0, agentObservationBytes)}\n\nContinue with the next JSON action. Finish with edits/commands when ready. If a command required approval, include it in finish.commands instead of trying to run it.`,
      });
    }

    if (!result) {
      result = {
        message: 'The agent reached its step limit before producing final changes.',
        questions: [],
        edits: [],
        commands: [],
        referencedFiles: context.files.map((file) => file.filePath),
        _thinking: 'Reached step limit.',
        _needsContinuation: true,
        _stoppedTrajectory: {
          id: id('trajectory'),
          mode,
          prompt,
          messages,
          steps,
          taskGraph,
          contextFiles: context.files.map((file) => ({ filePath: file.filePath })),
          stoppedAt: nowIso(),
          reason: 'step_limit',
        },
      };
    }

    if (
      editableModes.has(mode) &&
      !result._needsContinuation &&
      !(Array.isArray(result.questions) && result.questions.length) &&
      !(Array.isArray(result.edits) && result.edits.length) &&
      !(Array.isArray(result.commands) && result.commands.length)
    ) {
      if (mode === 'builder') {
        steps.push({
          title: 'Builder produced no files; switching to strict file-generation pass.',
          action: 'strict_builder',
          status: 'running',
        });
        await this.flushThinking(thinkingMessage, {
          status: 'running',
          title: 'Thinking...',
          text: 'The first pass did not produce files, so Neura is forcing a file-generation pass.',
          steps,
          taskGraph,
        });
        result = await this.callNimStrictBuilder(prompt, context);
        steps[steps.length - 1].status = 'done';
        steps[steps.length - 1].observation = `Strict builder returned ${Array.isArray(result.edits) ? result.edits.length : 0} file edit(s).`;
      } else {
        throw new Error('Neura Agent did not return file changes or a blocking question.');
      }
    }

    if (result && !result._needsContinuation) {
      taskGraph = await this.reviseTaskGraph(mode, prompt, context, taskGraph, {
        action: 'finish',
        message: result.message,
        edits: Array.isArray(result.edits) ? result.edits.map((edit) => edit.filePath || edit.path || '') : [],
        commands: Array.isArray(result.commands) ? result.commands.map((command) => command.command || command) : [],
      }, 'final');
    }
    result.taskGraph = taskGraph;
    result._agentSteps = steps;
    return result;
  }

  normalizeAttachments(attachments = []) {
    return attachments
      .filter((item) => item && item.name && item.mimeType && item.dataUrl)
      .slice(0, 6)
      .map((item) => ({
        id: id('attachment'),
        name: String(item.name).slice(0, 160),
        mimeType: String(item.mimeType).slice(0, 80),
        size: Number(item.size || 0),
        dataUrl: String(item.dataUrl),
        text: String(item.text || '').slice(0, maxAttachmentBytes),
      }))
      .filter((item) => item.size <= maxAttachmentBytes || item.text);
  }

  async refreshSuggestions() {
    if (!this.rootPath) {
      this.suggestions = [];
      return;
    }
    try {
      const files = await vscode.workspace.findFiles('**/*', ignoredGlob, 120);
      this.suggestions = files.map((uri) => normalizeSlashes(path.relative(this.rootPath, uri.fsPath)));
    } catch {
      this.suggestions = [];
    }
  }

  async refreshWorktrees() {
    this.worktrees = [];
    if (!this.rootPath) return;
    try {
      const output = await execFileAsync('git', ['worktree', 'list', '--porcelain'], this.rootPath);
      const parsed = [];
      let current = null;
      for (const line of output.split(/\r?\n/)) {
        if (line.startsWith('worktree ')) {
          if (current) parsed.push(current);
          current = { path: line.slice('worktree '.length), branch: '', commit: '', locked: false };
        } else if (current && line.startsWith('HEAD ')) {
          current.commit = line.slice('HEAD '.length);
        } else if (current && line.startsWith('branch ')) {
          current.branch = line.slice('branch '.length).replace('refs/heads/', '');
        } else if (current && line.startsWith('locked')) {
          current.locked = true;
        }
      }
      if (current) parsed.push(current);
      this.worktrees = parsed;
    } catch {
      this.worktrees = [];
    }
  }

  interpolateMcpValue(value) {
    return String(value || '')
      .replace(/\$\{workspaceFolder\}/g, this.rootPath || '')
      .replace(/\$\{env:([^}]+)\}/g, (_match, name) => process.env[String(name)] || '');
  }

  async refreshMcpServers() {
    const servers = vscode.workspace.getConfiguration('neura.mcp').get('servers', []);
    this.mcpServers = [];
    if (!Array.isArray(servers)) return;
    for (const server of servers) {
      const normalized = {
        name: String(server?.name || 'Unnamed MCP'),
        transport: String(server?.transport || 'stdio'),
        command: this.interpolateMcpValue(server?.command || ''),
        url: this.interpolateMcpValue(server?.url || ''),
        args: Array.isArray(server?.args) ? server.args.map((value) => this.interpolateMcpValue(value)) : [],
        env: server?.env && typeof server.env === 'object'
          ? Object.fromEntries(Object.entries(server.env).map(([key, value]) => [key, this.interpolateMcpValue(value)]))
          : {},
        disabledTools: Array.isArray(server?.disabledTools) ? server.disabledTools.map(String) : [],
        capabilities: server?.capabilities && typeof server.capabilities === 'object' ? server.capabilities : {},
        status: 'configured',
        tools: [],
        error: '',
      };
      const canConnect =
        (normalized.transport === 'stdio' && normalized.command) ||
        (normalized.transport === 'sse' && normalized.url);
      if (canConnect) {
        try {
          const client = await this.getMcpClient(normalized);
          const result = await client.request('tools/list', {});
          normalized.tools = (Array.isArray(result?.tools) ? result.tools : [])
            .map((tool) => ({
              ...tool,
              enabled: !normalized.disabledTools.includes(tool.name),
            }));
          normalized.status = 'connected';
        } catch (error) {
          normalized.status = 'failed';
          normalized.error = errorMessageFor(error);
        }
      }
      this.mcpServers.push(normalized);
    }
  }

  async getMcpClient(server) {
    const key = `${server.transport}:${server.name}`;
    let client = this.mcpClients.get(key);
    if (!client) {
      client = server.transport === 'sse' ? new McpSseClient(server) : new McpStdioClient(server);
      this.mcpClients.set(key, client);
    }
    await client.connect();
    return client;
  }

  async createMcpApprovalCard(serverName, toolName, args = {}) {
    const server = this.mcpServers.find((item) => item.name === serverName);
    if (!server) throw new Error(`MCP server not found: ${serverName}`);
    if ((server.disabledTools || []).includes(toolName)) {
      throw new Error(`MCP tool is disabled by configuration: ${serverName}/${toolName}`);
    }
    const policy = this.evaluatePolicy('mcp', `${serverName}/${toolName}`, { args });
    if (policy.decision === 'deny') throw new Error(`Neura policy denied MCP tool: ${policy.reason}`);
    const card = {
      id: id('mcp'),
      serverName,
      toolName,
      args,
      status: 'pending',
      policyDecision: policy.decision,
      policyReason: policy.reason,
      audit: [{ at: nowIso(), event: 'created', policyDecision: policy.decision, policyReason: policy.reason }],
      result: null,
      error: '',
      createdAt: nowIso(),
    };
    this.state.mcpCards = [card, ...(this.state.mcpCards || [])].slice(0, 40);
    this.recordArtifact('mcp', `MCP ${serverName}/${toolName}`, 'Waiting for approval.', {
      serverName,
      toolName,
      args,
    });
    await this.saveState();
    this.renderIfVisible();
    return card;
  }

  async executeMcpCard(cardId) {
    const card = (this.state.mcpCards || []).find((item) => item.id === cardId);
    if (!card) throw new Error('MCP card was not found.');
    const server = this.mcpServers.find((item) => item.name === card.serverName);
    if (!server) throw new Error(`MCP server not found: ${card.serverName}`);
    const policy = this.evaluatePolicy('mcp', `${card.serverName}/${card.toolName}`, { cardId });
    if (policy.decision === 'deny') throw new Error(`Neura policy denied MCP tool: ${policy.reason}`);
    const allowed = await this.confirmMcpExecution(card);
    if (!allowed) return;
    card.status = 'running';
    card.audit = [...(card.audit || []), { at: nowIso(), event: 'approved', policyDecision: policy.decision, policyReason: policy.reason }].slice(-20);
    await this.saveState();
    this.renderIfVisible();
    try {
      const client = await this.getMcpClient(server);
      const result = await client.request('tools/call', {
        name: card.toolName,
        arguments: card.args || {},
      });
      card.status = 'completed';
      card.result = result;
      card.audit = [...(card.audit || []), { at: nowIso(), event: 'completed' }].slice(-20);
      this.recordArtifact('mcp-result', `MCP ${card.toolName}`, 'MCP tool completed.', {
        serverName: card.serverName,
        toolName: card.toolName,
        result,
      });
    } catch (error) {
      card.status = 'failed';
      card.error = errorMessageFor(error);
      card.audit = [...(card.audit || []), { at: nowIso(), event: 'failed', error: card.error }].slice(-20);
      this.recordArtifact('mcp-result', `MCP ${card.toolName} failed`, card.error, {
        serverName: card.serverName,
        toolName: card.toolName,
      });
    }
    await this.saveState();
    await this.refresh();
  }

  async rejectMcpCard(cardId) {
    const card = (this.state.mcpCards || []).find((item) => item.id === cardId);
    if (!card) return;
    card.status = 'rejected';
    card.audit = [...(card.audit || []), { at: nowIso(), event: 'rejected' }].slice(-20);
    await this.saveState();
    this.renderIfVisible();
  }

  async mcpPermissionKey(serverName, toolName) {
    return `${serverName}/${toolName}`;
  }

  async confirmMcpExecution(card) {
    const permissions = await safeReadJson(this.mcpPermissionPath);
    const allowed = permissions.allowed && typeof permissions.allowed === 'object' ? permissions.allowed : {};
    const key = await this.mcpPermissionKey(card.serverName, card.toolName);
    if (allowed[key] === true) return true;
    const approval = await vscode.window.showWarningMessage(
      `Run MCP tool ${card.serverName}/${card.toolName}?\n\nArguments:\n${JSON.stringify(card.args || {}, null, 2).slice(0, 1200)}`,
      { modal: true },
      'Run Once',
      'Always Allow',
    );
    if (approval === 'Always Allow') {
      allowed[key] = true;
      await fs.mkdir(path.dirname(this.mcpPermissionPath), { recursive: true });
      await fs.writeFile(
        this.mcpPermissionPath,
        `${JSON.stringify({ allowed, updatedAt: nowIso() }, null, 2)}\n`,
        'utf8',
      );
      return true;
    }
    return approval === 'Run Once';
  }

  async promptMcpToolCall() {
    await this.refreshMcpServers();
    const tools = [];
    for (const server of this.mcpServers) {
      for (const tool of server.tools || []) {
        tools.push({
          label: `${server.name}: ${tool.name}`,
          description: tool.description || '',
          serverName: server.name,
          toolName: tool.name,
        });
      }
    }
    const picked = await vscode.window.showQuickPick(tools, {
      title: 'Neura: MCP Tool',
      ignoreFocusOut: true,
    });
    if (!picked) return;
    const raw = await vscode.window.showInputBox({
      title: `Arguments for ${picked.label}`,
      prompt: 'JSON arguments object',
      value: '{}',
      ignoreFocusOut: true,
    });
    if (raw == null) return;
    let args = {};
    try {
      args = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      throw new Error('MCP arguments must be valid JSON.');
    }
    await this.createMcpApprovalCard(picked.serverName, picked.toolName, args);
  }

  async setMcpToolEnabled(serverName, toolName, enabled) {
    const config = vscode.workspace.getConfiguration('neura.mcp');
    const servers = config.get('servers', []);
    if (!Array.isArray(servers)) return;
    const updated = servers.map((server) => {
      if (String(server?.name || '') !== serverName) return server;
      const disabled = new Set(Array.isArray(server.disabledTools) ? server.disabledTools.map(String) : []);
      if (enabled) disabled.delete(toolName);
      else disabled.add(toolName);
      return { ...server, disabledTools: [...disabled] };
    });
    await config.update('servers', updated, this.rootPath ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global);
    this.recordArtifact('mcp-policy', `${enabled ? 'Enabled' : 'Disabled'} MCP ${serverName}/${toolName}`, 'Updated MCP per-tool policy.', {
      serverName,
      toolName,
      enabled,
    });
    await this.refresh();
  }

  async refreshPlugins() {
    const pluginRoot = path.join(os.homedir(), '.neura', 'plugins');
    const trust = await safeReadJson(this.pluginTrustPath);
    const trusted = Array.isArray(trust.trusted) ? trust.trusted : [];
    try {
      await fs.mkdir(pluginRoot, { recursive: true });
      const entries = await fs.readdir(pluginRoot, { withFileTypes: true });
      const plugins = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const manifest = await safeReadJson(path.join(pluginRoot, entry.name, 'neura-plugin.json'));
        plugins.push({
          name: manifest.name || entry.name,
          version: manifest.version || '0.0.0',
          description: manifest.description || 'Neura plugin package.',
          permissions: Array.isArray(manifest.permissions) ? manifest.permissions.map(String) : [],
          capabilities: manifest.capabilities && typeof manifest.capabilities === 'object' ? manifest.capabilities : {},
          sandbox: manifest.sandbox || 'restricted-api',
          trusted: trusted.includes(manifest.name || entry.name),
          path: path.join(pluginRoot, entry.name),
          main: manifest.main || 'index.js',
        });
      }
      this.plugins = plugins;
    } catch {
      this.plugins = [];
    }
  }

  async loadTrustedPlugins() {
    const trust = await safeReadJson(this.pluginTrustPath);
    const trusted = Array.isArray(trust.trusted) ? trust.trusted : [];
    for (const plugin of this.plugins) {
      if (!plugin.trusted || this.loadedPlugins.has(plugin.name)) continue;
      const mainPath = path.join(plugin.path, plugin.main || 'index.js');
      if (!fsSync.existsSync(mainPath)) continue;
      try {
        // Trusted local plugins execute with a deliberately small API. Users must explicitly trust first.
        const pluginModule = require(mainPath);
        if (typeof pluginModule.activate === 'function') {
          const permissions = new Set(plugin.permissions || []);
          this.evaluatePolicy('plugin', plugin.name, {
            permissions: plugin.permissions,
            capabilities: plugin.capabilities,
          });
          await pluginModule.activate({
            workspaceRoot: this.rootPath,
            registerCommand: (name, callback) => {
              if (!permissions.has('commands')) {
                throw new Error(`Plugin ${plugin.name} needs "commands" permission to register commands.`);
              }
              const disposable = vscode.commands.registerCommand(name, callback);
              this.context.subscriptions.push(disposable);
              return disposable;
            },
            addContextProvider: (name, callback) => {
              if (!permissions.has('context')) {
                throw new Error(`Plugin ${plugin.name} needs "context" permission to add context providers.`);
              }
              this.loadedPlugins.set(`context:${plugin.name}:${name}`, { callback });
            },
            showInformationMessage: (message) => vscode.window.showInformationMessage(String(message || '').slice(0, 500)),
          });
        }
        this.loadedPlugins.set(plugin.name, pluginModule);
        this.recordArtifact('plugin', `Plugin loaded: ${plugin.name}`, `Trusted plugin ${plugin.name} activated.`, {
          plugin: plugin.name,
          permissions: plugin.permissions,
          capabilities: plugin.capabilities,
          sandbox: plugin.sandbox,
        });
      } catch (error) {
        plugin.error = errorMessageFor(error);
        logNeura('Plugin activation failed', { plugin: plugin.name, error: plugin.error });
      }
    }
  }

  async trustPlugin(pluginName, trusted) {
    const plugin = this.plugins.find((item) => item.name === pluginName);
    if (trusted && plugin) {
      const decision = this.evaluatePolicy('plugin', plugin.name, {
        permissions: plugin.permissions,
        capabilities: plugin.capabilities,
      });
      if (decision.decision === 'deny') throw new Error(`Neura policy denied plugin: ${decision.reason}`);
    }
    const current = await safeReadJson(this.pluginTrustPath);
    const list = new Set(Array.isArray(current.trusted) ? current.trusted : []);
    if (trusted) list.add(pluginName);
    else list.delete(pluginName);
    await fs.mkdir(path.dirname(this.pluginTrustPath), { recursive: true });
    await fs.writeFile(this.pluginTrustPath, `${JSON.stringify({ trusted: [...list], updatedAt: nowIso() }, null, 2)}\n`, 'utf8');
    await this.refresh();
  }

  async removePlugin(pluginName) {
    const plugin = this.plugins.find((item) => item.name === pluginName);
    if (!plugin) return;
    const approval = await vscode.window.showWarningMessage(
      `Remove plugin "${plugin.name}" from ${plugin.path}?`,
      { modal: true },
      'Remove',
    );
    if (approval !== 'Remove') return;
    await fs.rm(plugin.path, { recursive: true, force: true });
    await this.trustPlugin(pluginName, false);
  }

  async readWorkspaceFile(relativePath, byteLimit = maxContextBytes) {
    const readPolicy = this.evaluatePolicy('file_read', relativePath, { skipPrompt: true });
    if (readPolicy.decision === 'deny') throw new Error(`Neura policy denied file read for ${relativePath}: ${readPolicy.reason}`);
    const absolute = this.absoluteFor(relativePath);
    const bytes = await fs.readFile(absolute);
    const clipped = bytes.length > byteLimit ? bytes.subarray(0, byteLimit) : bytes;
    return {
      filePath: this.safeRelative(relativePath),
      content: clipped.toString('utf8'),
      truncated: bytes.length > byteLimit,
    };
  }

  async activeEditorFile() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.rootPath || editor.document.uri.scheme !== 'file') {
      return null;
    }
    const relative = path.relative(this.rootPath, editor.document.uri.fsPath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      return null;
    }
    return normalizeSlashes(relative);
  }

  async projectTree(limit = 80) {
    if (!this.rootPath) return [];
    const files = await vscode.workspace.findFiles('**/*', ignoredGlob, limit);
    return files.map((uri) => this.indexedPathForUri(uri).filePath);
  }

  async searchWorkspace(query, limit = agentSearchMatchLimit) {
    this.ensureWorkspace();
    const needle = String(query || '').trim();
    if (!needle) return [];
    const files = await vscode.workspace.findFiles('**/*', ignoredGlob, agentSearchFileLimit);
    const lowerNeedle = needle.toLowerCase();
    const matches = [];
    for (const uri of files) {
      if (matches.length >= limit) break;
      let content = '';
      try {
        const stat = await fs.stat(uri.fsPath);
        if (stat.size > 350_000) continue;
        content = await fs.readFile(uri.fsPath, 'utf8');
      } catch {
        continue;
      }
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length && matches.length < limit; index += 1) {
        if (lines[index].toLowerCase().includes(lowerNeedle)) {
          matches.push({
            filePath: normalizeSlashes(path.relative(this.rootPath, uri.fsPath)),
            line: index + 1,
            text: lines[index].trim().slice(0, 260),
          });
        }
      }
    }
    return matches;
  }

  semanticStopWords() {
    return new Set([
      'const', 'let', 'var', 'function', 'return', 'import', 'from', 'export', 'class', 'type',
      'interface', 'async', 'await', 'true', 'false', 'null', 'undefined', 'this', 'that', 'with',
      'then', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue', 'default', 'new',
      'public', 'private', 'protected', 'static', 'readonly', 'extends', 'implements',
    ]);
  }

  tokenizeForIndex(text) {
    const stopWords = this.semanticStopWords();
    return [...String(text || '').matchAll(/[A-Za-z_][A-Za-z0-9_]{1,}|[a-z]+(?=[A-Z])|[A-Z]?[a-z]+|[0-9]+/g)]
      .map((match) => match[0].toLowerCase())
      .flatMap((token) => token.split(/(?=[A-Z])|[_\-.]/).filter(Boolean))
      .map((token) => token.toLowerCase())
      .filter((token) => token.length > 1 && !stopWords.has(token));
  }

  sparseEmbedding(tokens, dimensions = 256) {
    const counts = new Map();
    for (const token of tokens) {
      const bucket = parseInt(hashKey(token).slice(0, 8), 16) % dimensions;
      counts.set(bucket, (counts.get(bucket) || 0) + 1);
    }
    const norm = Math.sqrt([...counts.values()].reduce((sum, value) => sum + value * value, 0)) || 1;
    return [...counts.entries()]
      .map(([index, value]) => [index, Number((value / norm).toFixed(6))])
      .sort((a, b) => a[0] - b[0]);
  }

  cosineSparse(left = [], right = []) {
    let i = 0;
    let j = 0;
    let score = 0;
    while (i < left.length && j < right.length) {
      if (left[i][0] === right[j][0]) {
        score += left[i][1] * right[j][1];
        i += 1;
        j += 1;
      } else if (left[i][0] < right[j][0]) {
        i += 1;
      } else {
        j += 1;
      }
    }
    return score;
  }

  extractImports(content) {
    return [
      ...content.matchAll(/\bimport\s+(?:type\s+)?(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g),
      ...content.matchAll(/\bexport\s+[^'"]*\s+from\s+['"]([^'"]+)['"]/g),
      ...content.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g),
      ...content.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map((match) => match[1]).slice(0, 100);
  }

  resolveImportTarget(fromFile, specifier, knownFiles) {
    if (!specifier || !specifier.startsWith('.')) return '';
    const base = normalizeSlashes(path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier)));
    const candidates = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.js`,
      `${base}.jsx`,
      `${base}.mjs`,
      `${base}.cjs`,
      `${base}.json`,
      `${base}/index.ts`,
      `${base}/index.tsx`,
      `${base}/index.js`,
      `${base}/index.jsx`,
    ];
    return candidates.find((candidate) => knownFiles.has(candidate)) || '';
  }

  extractSymbols(relative, content) {
    const symbols = [];
    const lines = content.split(/\r?\n/);
    const exportedNames = new Set();
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const namedExport = line.match(/\bexport\s*\{([^}]+)\}/);
      if (namedExport) {
        for (const name of namedExport[1].split(',')) {
          const cleaned = name.split(/\s+as\s+/i).pop().trim();
          if (cleaned) exportedNames.add(cleaned);
        }
      }
      const match =
        line.match(/\bexport\s+default\s+(?:function|class)\s+([A-Za-z_][A-Za-z0-9_]*)/) ||
        line.match(/\bexport\s+(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/) ||
        line.match(/\b(function|class|interface|type|enum|const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)/) ||
        line.match(/\b([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*(async\s*)?\(/);
      if (match) {
        symbols.push({
          name: match[2] || match[1],
          filePath: relative,
          line: index + 1,
          exported: /\bexport\b/.test(line),
          preview: line.trim().slice(0, 220),
        });
      }
      if (symbols.length > 200) break;
    }
    for (const name of exportedNames) {
      if (!symbols.some((symbol) => symbol.name === name)) {
        symbols.push({
          name,
          filePath: relative,
          line: 1,
          exported: true,
          preview: `export { ${name} }`,
        });
      }
    }
    return symbols;
  }

  async indexFileUri(uri) {
    const stat = await fs.stat(uri.fsPath);
    if (stat.size > 500_000) return null;
    const content = await fs.readFile(uri.fsPath, 'utf8');
    const indexedPath = this.indexedPathForUri(uri);
    const relative = indexedPath.filePath;
    const tokens = this.tokenizeForIndex(`${relative}\n${content}`);
    const termCounts = new Map();
    for (const token of tokens) termCounts.set(token, (termCounts.get(token) || 0) + 1);
    const terms = [...termCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 180)
      .map(([term]) => term);
    const imports = this.extractImports(content);
    const symbols = this.extractSymbols(relative, content);
    return {
      file: {
        filePath: relative,
        workspacePath: indexedPath.workspacePath,
        rootName: indexedPath.root?.name || this.projectName,
        rootId: indexedPath.root?.id || hashKey(this.rootPath).slice(0, 12),
        language: languageFor(relative),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        terms,
        imports,
        embedding: this.sparseEmbedding(tokens),
        exportedSymbols: symbols.filter((symbol) => symbol.exported).map((symbol) => symbol.name).slice(0, 80),
      },
      symbols,
    };
  }

  vectorDot(left = [], right = []) {
    const length = Math.min(left.length, right.length);
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    for (let index = 0; index < length; index += 1) {
      const l = Number(left[index] || 0);
      const r = Number(right[index] || 0);
      dot += l * r;
      leftNorm += l * l;
      rightNorm += r * r;
    }
    if (!leftNorm || !rightNorm) return 0;
    return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
  }

  async callEmbeddingModel(inputs) {
    const embeddingConfig = this.config.embeddings || {};
    if (!embeddingConfig.configured) return null;
    const response = await fetch(`${embeddingConfig.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${embeddingConfig.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: embeddingConfig.model,
        input: inputs,
      }),
    });
    const rawBody = await response.text();
    const payload = rawBody ? JSON.parse(rawBody) : {};
    if (!response.ok) throw new Error(payload.error?.message || rawBody || `HTTP ${response.status}`);
    const values = Array.isArray(payload.data) ? payload.data : [];
    return values.map((item) => Array.isArray(item.embedding) ? item.embedding.map(Number) : []);
  }

  async buildDenseEmbeddings(indexedFiles, previous = {}) {
    const embeddingConfig = this.config.embeddings || {};
    if (!embeddingConfig.configured) {
      return {
        enabled: false,
        vectors: previous?.denseVectors || {},
        changed: 0,
        reused: Object.keys(previous?.denseVectors || {}).length,
        error: '',
      };
    }
    const previousVectors = previous?.denseVectors && typeof previous.denseVectors === 'object' ? previous.denseVectors : {};
    const vectors = {};
    const changedFiles = [];
    for (const file of indexedFiles) {
      const key = `${file.size}:${file.mtimeMs}:${embeddingConfig.model}`;
      const existing = previousVectors[file.filePath];
      if (existing?.key === key && Array.isArray(existing.vector)) {
        vectors[file.filePath] = existing;
      } else {
        changedFiles.push({ file, key });
      }
    }
    const batchSize = 16;
    let embedded = 0;
    for (let index = 0; index < changedFiles.length; index += batchSize) {
      const batch = changedFiles.slice(index, index + batchSize);
      const inputs = batch.map(({ file }) => [
        file.filePath,
        `language:${file.language}`,
        `symbols:${(file.exportedSymbols || []).join(', ')}`,
        `terms:${(file.terms || []).slice(0, 80).join(' ')}`,
        `imports:${(file.imports || []).join(' ')}`,
      ].join('\n'));
      const embeddings = await this.callEmbeddingModel(inputs);
      embeddings.forEach((vector, offset) => {
        const item = batch[offset];
        vectors[item.file.filePath] = {
          key: item.key,
          model: embeddingConfig.model,
          dimensions: vector.length,
          vector,
          updatedAt: nowIso(),
        };
        embedded += 1;
      });
    }
    return {
      enabled: true,
      vectors,
      changed: embedded,
      reused: indexedFiles.length - embedded,
      model: embeddingConfig.model,
      dimensions: Object.values(vectors).find((item) => item?.dimensions)?.dimensions || 0,
      error: '',
    };
  }

  async collectGitHistoryIndex(roots = this.workspaceRoots()) {
    const commits = [];
    const pullRequests = [];
    const issues = [];
    for (const root of roots) {
      const gitDir = path.join(root.path, '.git');
      if (!fsSync.existsSync(gitDir)) continue;
      try {
        const output = await execFileAsync('git', [
          'log',
          '--date=short',
          '--pretty=format:@@commit@@%H%x09%ad%x09%an%x09%s',
          '--name-only',
          '-n',
          '100',
        ], root.path);
        let current = null;
        for (const line of output.split(/\r?\n/)) {
          if (line.startsWith('@@commit@@')) {
            if (current) commits.push(current);
            const [sha, date, author, subject] = line.slice('@@commit@@'.length).split('\t');
            current = {
              kind: 'commit',
              rootName: root.name,
              rootId: root.id,
              sha,
              date,
              author,
              subject,
              files: [],
              refs: [...String(subject || '').matchAll(/#(\d+)/g)].map((match) => Number(match[1])).slice(0, 8),
              terms: this.tokenizeForIndex(`${subject} ${author}`),
            };
          } else if (current && line.trim()) {
            const filePath = normalizeSlashes(line.trim());
            current.files.push(this.workspaceRoots().length > 1 ? `${root.name}/${filePath}` : filePath);
          }
        }
        if (current) commits.push(current);
      } catch (error) {
        logNeura('Git history indexing skipped', { root: root.path, error: errorMessageFor(error) });
      }
      try {
        const prOutput = await execFileAsync('gh', [
          'pr',
          'list',
          '--state',
          'all',
          '--limit',
          '50',
          '--json',
          'number,title,state,updatedAt,headRefName,baseRefName,author',
        ], root.path);
        const prs = JSON.parse(prOutput || '[]');
        for (const pr of prs) {
          pullRequests.push({
            kind: 'pr',
            rootName: root.name,
            rootId: root.id,
            number: pr.number,
            title: pr.title || '',
            state: pr.state || '',
            updatedAt: pr.updatedAt || '',
            headRefName: pr.headRefName || '',
            baseRefName: pr.baseRefName || '',
            author: pr.author?.login || '',
            terms: this.tokenizeForIndex(`${pr.title} ${pr.state} ${pr.headRefName} ${pr.baseRefName} ${pr.author?.login || ''}`),
          });
        }
      } catch {
        // GitHub CLI is optional; local Git history remains available.
      }
      try {
        const issueOutput = await execFileAsync('gh', [
          'issue',
          'list',
          '--state',
          'all',
          '--limit',
          '50',
          '--json',
          'number,title,state,updatedAt,labels,author',
        ], root.path);
        const ghIssues = JSON.parse(issueOutput || '[]');
        for (const issue of ghIssues) {
          issues.push({
            kind: 'issue',
            rootName: root.name,
            rootId: root.id,
            number: issue.number,
            title: issue.title || '',
            state: issue.state || '',
            updatedAt: issue.updatedAt || '',
            labels: (issue.labels || []).map((label) => label.name || '').filter(Boolean),
            author: issue.author?.login || '',
            terms: this.tokenizeForIndex(`${issue.title} ${issue.state} ${(issue.labels || []).map((label) => label.name).join(' ')} ${issue.author?.login || ''}`),
          });
        }
      } catch {
        // GitHub CLI is optional.
      }
    }
    return {
      commits: commits.slice(0, 160),
      pullRequests: pullRequests.slice(0, 80),
      issues: issues.slice(0, 80),
    };
  }

  async rebuildSemanticIndex(options = {}) {
    this.ensureWorkspace();
    const force = Boolean(options.force);
    const roots = this.workspaceRoots();
    const previous = await this.loadSemanticIndex();
    const previousFiles = new Map((previous?.files || []).map((file) => [file.filePath, file]));
    const previousSymbols = new Map();
    for (const symbol of previous?.symbols || []) {
      if (!previousSymbols.has(symbol.filePath)) previousSymbols.set(symbol.filePath, []);
      previousSymbols.get(symbol.filePath).push(symbol);
    }
    const uris = await vscode.workspace.findFiles(
      '**/*.{js,jsx,ts,tsx,mjs,cjs,json,html,css,md,py,rs,go,java,cs,php,rb,yml,yaml,toml,sql,sh,ps1}',
      ignoredGlob,
      1200,
    );
    const knownFiles = new Set(uris.map((uri) => this.indexedPathForUri(uri).filePath));
    const indexedFiles = [];
    const symbols = [];
    let changed = 0;
    let reused = 0;
    for (const uri of uris) {
      const relative = this.indexedPathForUri(uri).filePath;
      try {
        const stat = await fs.stat(uri.fsPath);
        const previousFile = previousFiles.get(relative);
        if (!force && previousFile && previousFile.size === stat.size && previousFile.mtimeMs === stat.mtimeMs && Array.isArray(previousFile.embedding)) {
          indexedFiles.push(previousFile);
          symbols.push(...(previousSymbols.get(relative) || []));
          reused += 1;
          continue;
        }
      } catch {
        continue;
      }
      const indexed = await this.indexFileUri(uri).catch(() => null);
      if (!indexed) continue;
      indexedFiles.push(indexed.file);
      symbols.push(...indexed.symbols);
      changed += 1;
    }
    const symbolByFile = new Map();
    for (const symbol of symbols) {
      if (!symbolByFile.has(symbol.filePath)) symbolByFile.set(symbol.filePath, []);
      symbolByFile.get(symbol.filePath).push(symbol);
    }
    const graph = indexedFiles.map((file) => {
      const edges = (file.imports || [])
        .map((specifier) => ({
          specifier,
          target: this.resolveImportTarget(file.filePath, specifier, knownFiles),
        }));
      return {
        filePath: file.filePath,
        rootName: file.rootName || this.projectName,
        rootId: file.rootId || hashKey(this.rootPath).slice(0, 12),
        imports: file.imports || [],
        edges,
        importedBy: [],
        symbols: (symbolByFile.get(file.filePath) || []).map((symbol) => symbol.name).slice(0, 100),
      };
    });
    const graphByFile = new Map(graph.map((node) => [node.filePath, node]));
    for (const node of graph) {
      for (const edge of node.edges) {
        if (edge.target && graphByFile.has(edge.target)) {
          graphByFile.get(edge.target).importedBy.push(node.filePath);
        }
      }
    }
    for (const node of graph) {
      node.centrality = Math.min(1, ((node.importedBy || []).length + (node.edges || []).filter((edge) => edge.target).length) / 18);
      node.dependents = (node.importedBy || []).length;
      node.dependencies = (node.edges || []).filter((edge) => edge.target).length;
    }
    const history = await this.collectGitHistoryIndex(roots);
    const semanticIndex = {
      version: 3,
      embedding: { kind: 'local-sparse-tf', dimensions: 256 },
      workspace: {
        roots: roots.map((root) => ({ name: root.name, id: root.id, path: root.path })),
        multiRoot: roots.length > 1,
      },
      files: indexedFiles,
      symbols,
      graph,
      history,
      stats: {
        totalFiles: indexedFiles.length,
        changedFiles: changed,
        reusedFiles: reused,
        symbolCount: symbols.length,
        graphEdges: graph.reduce((sum, node) => sum + (node.edges || []).filter((edge) => edge.target).length, 0),
        commits: history.commits.length,
        pullRequests: history.pullRequests.length,
        issues: history.issues.length,
      },
      updatedAt: nowIso(),
    };
    let denseStats = { enabled: false, changed: 0, reused: 0, error: '' };
    try {
      const dense = await this.buildDenseEmbeddings(indexedFiles, previous || {});
      denseStats = {
        enabled: dense.enabled,
        changed: dense.changed,
        reused: dense.reused,
        model: dense.model || '',
        dimensions: dense.dimensions || 0,
        error: dense.error || '',
      };
      if (dense.enabled) {
        semanticIndex.embedding = {
          kind: 'dense+nvidia-nim',
          fallback: 'local-sparse-tf',
          model: dense.model,
          dimensions: dense.dimensions,
        };
        semanticIndex.denseVectors = dense.vectors;
        if (this.vectorIndexPath) {
          await fs.mkdir(path.dirname(this.vectorIndexPath), { recursive: true });
          await fs.writeFile(this.vectorIndexPath, `${JSON.stringify({
            version: 1,
            model: dense.model,
            dimensions: dense.dimensions,
            vectors: dense.vectors,
            updatedAt: nowIso(),
          }, null, 2)}\n`, 'utf8');
        }
      }
    } catch (error) {
      denseStats = { enabled: false, changed: 0, reused: 0, error: errorMessageFor(error) };
      logNeura('Dense embedding index failed; falling back to sparse index', { error: denseStats.error });
    }
    semanticIndex.stats.dense = denseStats;
    this.state.semanticIndex = semanticIndex;
    if (this.semanticIndexPath) {
      await fs.mkdir(path.dirname(this.semanticIndexPath), { recursive: true });
      await fs.writeFile(this.semanticIndexPath, `${JSON.stringify(semanticIndex, null, 2)}\n`, 'utf8');
    }
    const publishShared = Boolean(vscode.workspace.getConfiguration('neura.index').get('publishShared'));
    if (publishShared && this.sharedSemanticIndexPath) {
      await fs.mkdir(path.dirname(this.sharedSemanticIndexPath), { recursive: true });
      await fs.writeFile(this.sharedSemanticIndexPath, `${JSON.stringify(semanticIndex, null, 2)}\n`, 'utf8');
    }
    this.recordArtifact('index', 'Semantic index updated', `${indexedFiles.length} file(s), ${symbols.length} symbol(s), ${changed} changed, ${reused} reused, ${semanticIndex.stats.graphEdges} import edge(s), ${history.commits.length} commit(s)${denseStats.enabled ? `, ${denseStats.changed} dense vectors` : ''}.`, {
      fileCount: indexedFiles.length,
      symbolCount: symbols.length,
      changed,
      reused,
      dense: denseStats,
      roots: semanticIndex.workspace.roots.length,
      graphEdges: semanticIndex.stats.graphEdges,
      history: {
        commits: history.commits.length,
        pullRequests: history.pullRequests.length,
        issues: history.issues.length,
      },
      sharedPath: publishShared ? this.sharedSemanticIndexPath : '',
    });
    await this.saveState();
    return semanticIndex;
  }

  scheduleSemanticIndexUpdate(reason = 'workspace-change') {
    if (!this.rootPath) return;
    if (this.semanticIndexTimer) clearTimeout(this.semanticIndexTimer);
    this.semanticIndexTimer = setTimeout(() => {
      this.semanticIndexTimer = null;
      void this.rebuildSemanticIndex().then((index) => {
        logNeura('Semantic index incrementally updated', {
          reason,
          files: index.files?.length || 0,
          changed: index.stats?.changedFiles || 0,
          reused: index.stats?.reusedFiles || 0,
        });
        this.renderIfVisible();
      }).catch((error) => {
        logNeura('Semantic index incremental update failed', { reason, error: errorMessageFor(error) });
      });
    }, 1200);
  }

  async loadSemanticIndex() {
    const useShared = Boolean(vscode.workspace.getConfiguration('neura.index').get('useShared'));
    if (useShared && this.sharedSemanticIndexPath && fsSync.existsSync(this.sharedSemanticIndexPath)) {
      const shared = await safeReadJson(this.sharedSemanticIndexPath);
      if (Array.isArray(shared.files) && Array.isArray(shared.symbols)) {
        this.state.semanticIndex = {
          ...shared,
          shared: {
            path: this.sharedSemanticIndexPath,
            loadedAt: nowIso(),
          },
        };
        return this.state.semanticIndex;
      }
    }
    if (!this.semanticIndexPath || !fsSync.existsSync(this.semanticIndexPath)) return this.state.semanticIndex;
    const index = await safeReadJson(this.semanticIndexPath);
    if (Array.isArray(index.files) && Array.isArray(index.symbols)) {
      this.state.semanticIndex = index;
    }
    return this.state.semanticIndex;
  }

  graphNeighbors(index, filePath) {
    const node = (index.graph || []).find((item) => item.filePath === filePath);
    if (!node) return [];
    return [
      ...(node.edges || []).map((edge) => edge.target).filter(Boolean),
      ...(node.importedBy || []),
    ];
  }

  graphCentrality(index, filePath) {
    const node = (index.graph || []).find((item) => item.filePath === filePath);
    if (!node) return 0;
    if (Number.isFinite(Number(node.centrality))) return Number(node.centrality);
    return Math.min(1, this.graphNeighbors(index, filePath).length / 18);
  }

  historyScoreForFile(index, filePath, queryTerms) {
    const commits = index.history?.commits || [];
    let score = 0;
    for (const commit of commits.slice(0, 120)) {
      const touches = (commit.files || []).includes(filePath);
      if (!touches) continue;
      const haystack = `${commit.subject || ''} ${(commit.terms || []).join(' ')}`.toLowerCase();
      const lexical = queryTerms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
      score += 0.08 + Math.min(0.6, lexical * 0.12);
    }
    return Math.min(1.2, score);
  }

  historySearchHits(index, queryTerms, needle, limit) {
    const records = [
      ...(index.history?.commits || []),
      ...(index.history?.pullRequests || []),
      ...(index.history?.issues || []),
    ];
    return records
      .map((record) => {
        const haystack = [
          record.subject,
          record.title,
          record.author,
          record.state,
          record.headRefName,
          record.baseRefName,
          ...(record.labels || []),
          ...(record.files || []),
          ...(record.terms || []),
        ].filter(Boolean).join(' ').toLowerCase();
        const score = queryTerms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
        return { record, score };
      })
      .filter((hit) => hit.score > 0 || (needle.length > 3 && JSON.stringify(hit.record).toLowerCase().includes(needle)))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(2, Math.floor(limit / 5)))
      .map((hit) => ({
        kind: hit.record.kind || 'history',
        rootName: hit.record.rootName || '',
        number: hit.record.number || undefined,
        sha: hit.record.sha ? String(hit.record.sha).slice(0, 12) : undefined,
        title: hit.record.title || hit.record.subject || '',
        state: hit.record.state || '',
        date: hit.record.date || hit.record.updatedAt || '',
        files: (hit.record.files || []).slice(0, 12),
        score: Number((hit.score * 0.8).toFixed(4)),
      }));
  }

  async semanticSearch(query, limit = 20) {
    const needle = String(query || '').toLowerCase().trim();
    if (!needle) return [];
    const queryTerms = [...new Set(needle.split(/[^a-z0-9_.-]+/i).filter((term) => term.length > 1))];
    const index = (await this.loadSemanticIndex()) || { files: [], symbols: [] };
    const queryEmbedding = this.sparseEmbedding(this.tokenizeForIndex(query));
    let denseQuery = null;
    if (index.embedding?.kind === 'dense+nvidia-nim' && this.config.embeddings?.configured) {
      try {
        const vectors = await this.callEmbeddingModel([query]);
        denseQuery = vectors?.[0] || null;
      } catch (error) {
        logNeura('Dense query embedding failed; using sparse search only', { error: errorMessageFor(error) });
      }
    }
    const symbolScoreByFile = new Map();
    const symbolHits = (index.symbols || [])
      .map((file) => {
        const haystack = `${file.name} ${file.filePath} ${file.preview}`.toLowerCase();
        const score = queryTerms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
        return { symbol: file, score };
      })
      .filter((hit) => hit.score > 0 || `${hit.symbol.name} ${hit.symbol.filePath} ${hit.symbol.preview}`.toLowerCase().includes(needle))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(4, Math.floor(limit / 2)))
      .map((hit) => {
        symbolScoreByFile.set(hit.symbol.filePath, Math.max(symbolScoreByFile.get(hit.symbol.filePath) || 0, hit.score));
        return { kind: 'symbol', ...hit.symbol, score: Number(hit.score.toFixed(4)) };
      });
    const seedFiles = new Set(symbolHits.map((hit) => hit.filePath));
    const neighborFiles = new Set([...seedFiles].flatMap((filePath) => this.graphNeighbors(index, filePath)));
    const historyHits = this.historySearchHits(index, queryTerms, needle, limit);
    const fileHits = (index.files || [])
      .map((file) => {
        const graphNode = (index.graph || []).find((node) => node.filePath === file.filePath);
        const haystack = `${file.filePath} ${file.rootName || ''} ${(file.terms || []).join(' ')} ${(file.imports || []).join(' ')} ${(file.exportedSymbols || []).join(' ')} ${(graphNode?.symbols || []).join(' ')}`.toLowerCase();
        const lexical = queryTerms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
        const sparseVector = Array.isArray(file.embedding) ? this.cosineSparse(queryEmbedding, file.embedding) : 0;
        const denseVector = denseQuery && index.denseVectors?.[file.filePath]?.vector
          ? this.vectorDot(denseQuery, index.denseVectors[file.filePath].vector)
          : 0;
        const vector = denseVector ? (denseVector * 0.7) + (sparseVector * 0.3) : sparseVector;
        const dependency = seedFiles.has(file.filePath) ? 1 : neighborFiles.has(file.filePath) ? 0.35 : 0;
        const centrality = this.graphCentrality(index, file.filePath);
        const symbolScore = symbolScoreByFile.get(file.filePath) || 0;
        const history = this.historyScoreForFile(index, file.filePath, queryTerms);
        const rootBoost = queryTerms.some((term) => String(file.rootName || '').toLowerCase().includes(term)) ? 0.35 : 0;
        const score = vector * 6 + lexical * 1.4 + symbolScore * 1.2 + dependency + centrality * 0.45 + history * 0.8 + rootBoost;
        return { file, score, vector, lexical, dependency, centrality, history };
      })
      .filter((hit) => hit.score > 0.05 || `${hit.file.filePath} ${(hit.file.terms || []).join(' ')}`.toLowerCase().includes(needle))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, limit - symbolHits.length))
      .map((hit) => ({
        kind: 'file',
        filePath: hit.file.filePath,
        language: hit.file.language,
        terms: (hit.file.terms || []).slice(0, 12),
        imports: (hit.file.imports || []).slice(0, 8),
        exportedSymbols: (hit.file.exportedSymbols || []).slice(0, 8),
        score: Number(hit.score.toFixed(4)),
        vectorScore: Number(hit.vector.toFixed(4)),
        dependencyScore: Number(hit.dependency.toFixed(4)),
        centralityScore: Number(hit.centrality.toFixed(4)),
        historyScore: Number(hit.history.toFixed(4)),
        rootName: hit.file.rootName || '',
        workspacePath: hit.file.workspacePath || hit.file.filePath,
      }));
    return [...symbolHits, ...fileHits, ...historyHits]
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, limit);
  }

  async workspaceDiagnostics(filePath = '') {
    this.ensureWorkspace();
    const diagnostics = [];
    const target = filePath ? this.safeRelative(filePath) : '';
    for (const [uri, items] of vscode.languages.getDiagnostics()) {
      if (uri.scheme !== 'file') continue;
      const relative = normalizeSlashes(path.relative(this.rootPath, uri.fsPath));
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
      if (target && relative !== target) continue;
      for (const item of items.slice(0, 20)) {
        diagnostics.push({
          filePath: relative,
          line: item.range.start.line + 1,
          column: item.range.start.character + 1,
          severity: ['error', 'warning', 'info', 'hint'][item.severity] || 'unknown',
          message: String(item.message || '').slice(0, 500),
          source: item.source || '',
        });
      }
      if (diagnostics.length >= 80) break;
    }
    return diagnostics;
  }

  async discoverVerificationProfile(failedCommand = '') {
    this.ensureWorkspace();
    const pkg = await safeReadJson(path.join(this.rootPath, 'package.json'));
    const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
    const packageManager = fsSync.existsSync(path.join(this.rootPath, 'pnpm-lock.yaml'))
      ? 'pnpm'
      : fsSync.existsSync(path.join(this.rootPath, 'yarn.lock'))
        ? 'yarn'
        : 'npm';
    const runScript = (name) => `${packageManager} run ${name}`;
    const commandSet = new Map();
    const addCommand = (command, reason, kind = 'verify') => {
      const value = String(command || '').trim();
      if (!value || commandSet.has(value)) return;
      commandSet.set(value, { command: value, reason, kind });
    };
    for (const [name, script] of Object.entries(scripts)) {
      const lower = `${name} ${script}`.toLowerCase();
      if (/\b(typecheck|tsc|check-types)\b/.test(lower)) addCommand(runScript(name), `package.json script "${name}" runs TypeScript/type checks.`, 'typecheck');
      if (/\b(lint|eslint|biome|stylelint)\b/.test(lower)) addCommand(runScript(name), `package.json script "${name}" runs lint diagnostics.`, 'lint');
      if (/\b(lint:fix|fix:lint|eslint.*--fix|biome.*--write|format|prettier)\b/.test(lower) || /(^|:)fix$/.test(name)) addCommand(runScript(name), `package.json script "${name}" can repair lint/format issues.`, 'lint-fix');
      if (/\b(test|vitest|jest|playwright|cypress|mocha|ava)\b/.test(lower)) addCommand(runScript(name), `package.json script "${name}" runs tests.`, 'test');
      if (/\b(build|compile)\b/.test(lower)) addCommand(runScript(name), `package.json script "${name}" verifies production build.`, 'build');
    }
    const configFiles = [
      ['eslint.config.js', 'npx eslint .', 'ESLint config detected.', 'lint'],
      ['.eslintrc.js', 'npx eslint .', 'ESLint config detected.', 'lint'],
      ['.eslintrc.cjs', 'npx eslint .', 'ESLint config detected.', 'lint'],
      ['biome.json', 'npx biome check .', 'Biome config detected.', 'lint'],
      ['tsconfig.json', 'npx tsc --noEmit', 'TypeScript config detected.', 'typecheck'],
      ['vitest.config.ts', 'npx vitest run', 'Vitest config detected.', 'test'],
      ['vitest.config.js', 'npx vitest run', 'Vitest config detected.', 'test'],
      ['jest.config.js', 'npx jest', 'Jest config detected.', 'test'],
      ['playwright.config.ts', 'npx playwright test', 'Playwright config detected.', 'test'],
      ['playwright.config.js', 'npx playwright test', 'Playwright config detected.', 'test'],
    ];
    for (const [fileName, command, reason, kind] of configFiles) {
      if (fsSync.existsSync(path.join(this.rootPath, fileName))) addCommand(command, reason, kind);
    }
    if (failedCommand) addCommand(failedCommand, 'Original failed command.', 'rerun');
    const diagnostics = await this.workspaceDiagnostics().catch(() => []);
    const diagnosticFiles = [...new Set(diagnostics.map((item) => item.filePath))].slice(0, 12);
    const failedFiles = this.extractFileMentions(`${failedCommand}\n${diagnostics.map((item) => item.filePath).join('\n')}`);
    const gitStatus = await this.gitStatusSummary().catch(() => ({ entries: [] }));
    const changedFiles = [...new Set((gitStatus.entries || []).map((entry) => entry.filePath).filter(Boolean))].slice(0, 30);
    const likelyFiles = [...new Set([...failedFiles, ...diagnosticFiles, ...changedFiles])].slice(0, 16);
    const testFiles = likelyFiles.filter((filePath) => /\.(test|spec)\.(js|jsx|ts|tsx|mjs|cjs)$/.test(filePath));
    const sourceFiles = likelyFiles.filter((filePath) => /\.(js|jsx|ts|tsx|mjs|cjs)$/.test(filePath));
    const hasVitest = fsSync.existsSync(path.join(this.rootPath, 'vitest.config.ts')) || fsSync.existsSync(path.join(this.rootPath, 'vitest.config.js'));
    const hasJest = fsSync.existsSync(path.join(this.rootPath, 'jest.config.js')) || fsSync.existsSync(path.join(this.rootPath, 'jest.config.ts'));
    const hasPlaywright = fsSync.existsSync(path.join(this.rootPath, 'playwright.config.ts')) || fsSync.existsSync(path.join(this.rootPath, 'playwright.config.js'));
    if (testFiles.length && hasVitest) addCommand(`npx vitest run ${testFiles.slice(0, 4).join(' ')}`, 'Targeted Vitest run for failed/changed test files.', 'targeted-test');
    if (testFiles.length && hasJest) addCommand(`npx jest ${testFiles.slice(0, 4).join(' ')}`, 'Targeted Jest run for failed/changed test files.', 'targeted-test');
    if (hasPlaywright) addCommand('npx playwright test --last-failed', 'Targeted Playwright retry of last failed tests.', 'targeted-test');
    if (sourceFiles.length && hasVitest) addCommand(`npx vitest related ${sourceFiles.slice(0, 4).join(' ')}`, 'Vitest related tests for changed source files.', 'targeted-test');
    if (sourceFiles.length && hasJest) addCommand(`npx jest --findRelatedTests ${sourceFiles.slice(0, 4).join(' ')}`, 'Jest related tests for changed source files.', 'targeted-test');
    return {
      commands: [...commandSet.values()].slice(0, 12),
      diagnostics,
      diagnosticFiles,
      failedFiles,
      changedFiles,
      packageManager,
      scripts,
    };
  }

  async detectProductionProfile() {
    this.ensureWorkspace();
    const root = this.rootPath;
    const exists = (filePath) => fsSync.existsSync(path.join(root, filePath));
    const pkg = await safeReadJson(path.join(root, 'package.json'));
    const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
    const dependencies = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    };
    const packageManager = exists('pnpm-lock.yaml')
      ? 'pnpm'
      : exists('yarn.lock')
        ? 'yarn'
        : 'npm';
    const runScript = (name) => `${packageManager} run ${name}`;
    const hasDep = (name) => Boolean(dependencies[name]);
    const hasScript = (pattern) => Object.entries(scripts).find(([name, script]) => pattern.test(`${name} ${script}`));
    const frameworkSignals = [];
    const addSignal = (name, reason, outputDir = '') => frameworkSignals.push({ name, reason, outputDir });
    if (hasDep('next') || exists('next.config.js') || exists('next.config.mjs') || exists('next.config.ts')) addSignal('next', 'Next.js dependency or config detected.', '.next');
    if (hasDep('@sveltejs/kit') || exists('svelte.config.js')) addSignal('sveltekit', 'SvelteKit dependency or config detected.', 'build');
    if (hasDep('astro') || exists('astro.config.mjs') || exists('astro.config.ts')) addSignal('astro', 'Astro dependency or config detected.', 'dist');
    if (hasDep('nuxt') || exists('nuxt.config.ts') || exists('nuxt.config.js')) addSignal('nuxt', 'Nuxt dependency or config detected.', '.output');
    if (hasDep('@remix-run/dev') || exists('remix.config.js')) addSignal('remix', 'Remix dependency or config detected.', 'build');
    if (hasDep('vite') || exists('vite.config.ts') || exists('vite.config.js') || exists('vite.config.mjs')) addSignal('vite', 'Vite dependency or config detected.', 'dist');
    if (hasDep('react')) addSignal('react', 'React dependency detected.', 'dist');
    if (hasDep('vue')) addSignal('vue', 'Vue dependency detected.', 'dist');
    if (hasDep('@angular/core') || exists('angular.json')) addSignal('angular', 'Angular dependency or config detected.', 'dist');
    if (hasDep('electron') || exists('electron.vite.config.ts')) addSignal('electron', 'Electron dependency or config detected.', 'out');
    if (!frameworkSignals.length && (exists('index.html') || exists('src/index.html'))) addSignal('static', 'Static HTML entry detected.', '.');

    const primaryFramework = frameworkSignals[0] || { name: 'unknown', reason: 'No recognized app framework detected.', outputDir: '' };
    const commands = [];
    const addCommand = (command, purpose, kind = 'ship') => {
      const value = String(command || '').trim();
      if (!value || commands.some((item) => item.command === value)) return;
      commands.push({ command: value, purpose, kind });
    };
    const addScript = (pattern, purpose, kind) => {
      const match = hasScript(pattern);
      if (match) addCommand(runScript(match[0]), purpose.replace('{script}', match[0]), kind);
    };
    if (pkg.name && !exists('node_modules')) {
      addCommand(packageManager === 'npm' ? 'npm install' : `${packageManager} install`, 'Install dependencies before production verification.', 'install');
    }
    addScript(/\b(lint|eslint|biome|stylelint)\b/i, 'Run lint script "{script}" before shipping.', 'lint');
    addScript(/\b(typecheck|tsc|check-types)\b/i, 'Run typecheck script "{script}" before shipping.', 'typecheck');
    addScript(/\b(test|vitest|jest|playwright|cypress)\b/i, 'Run test script "{script}" before shipping.', 'test');
    addScript(/\b(build|compile)\b/i, 'Run production build script "{script}".', 'build');
    addScript(/\b(preview|serve)\b/i, 'Run local production preview script "{script}".', 'preview');

    const deployTargets = [];
    if (exists('netlify.toml')) deployTargets.push({ id: 'netlify', config: 'netlify.toml' });
    if (exists('vercel.json')) deployTargets.push({ id: 'vercel', config: 'vercel.json' });
    if (exists('Dockerfile')) deployTargets.push({ id: 'docker', config: 'Dockerfile' });
    if (exists('render.yaml')) deployTargets.push({ id: 'render', config: 'render.yaml' });
    if (exists('fly.toml')) deployTargets.push({ id: 'fly', config: 'fly.toml' });
    const githubWorkflows = exists('.github/workflows');
    const outputDir = primaryFramework.outputDir || (exists('dist') ? 'dist' : exists('build') ? 'build' : '');
    if (deployTargets.some((target) => target.id === 'netlify')) {
      addCommand('npx netlify deploy --build', 'Create a Netlify draft deploy after local verification.', 'deploy-preview');
      addCommand('npx netlify deploy --prod --build', 'Deploy to Netlify production after approval.', 'deploy-production');
    } else if (['vite', 'react', 'vue', 'astro', 'static'].includes(primaryFramework.name)) {
      const publish = outputDir && outputDir !== '.' ? outputDir : '.';
      addCommand(`npx netlify deploy --dir=${publish}`, 'Create a Netlify draft deploy for static output after build.', 'deploy-preview');
    }
    if (deployTargets.some((target) => target.id === 'vercel')) {
      addCommand('npx vercel build', 'Run Vercel production build locally.', 'deploy-build');
      addCommand('npx vercel deploy --prebuilt', 'Create a Vercel preview deploy from the local build.', 'deploy-preview');
    }
    if (deployTargets.some((target) => target.id === 'docker')) {
      addCommand(`docker build -t ${this.slugForText(pkg.name || this.projectName, 'neura-app')} .`, 'Build the production Docker image.', 'package');
    }

    const missing = [];
    if (pkg.name && !Object.keys(scripts).some((name) => /\bbuild\b/i.test(name))) missing.push('package.json build script');
    if (!Object.keys(scripts).some((name) => /\b(lint|check|typecheck|test)\b/i.test(name))) missing.push('lint/typecheck/test scripts');
    if (!exists('.env.example') && (exists('.env') || /api|auth|database|stripe|supabase|firebase/i.test(JSON.stringify(dependencies)))) missing.push('.env.example without secrets');
    if (!deployTargets.length && ['vite', 'react', 'vue', 'astro', 'static', 'next', 'sveltekit'].includes(primaryFramework.name)) missing.push('deployment config such as netlify.toml or vercel.json');
    if (!githubWorkflows) missing.push('CI workflow for build/test checks');

    const checklist = [
      { title: 'Dependency install is reproducible', status: exists('package-lock.json') || exists('pnpm-lock.yaml') || exists('yarn.lock') ? 'ready' : 'missing', detail: 'A lockfile should exist before shipping.' },
      { title: 'Lint/typecheck/test/build commands are available', status: commands.some((item) => item.kind === 'build') ? 'ready' : 'missing', detail: 'Production release needs repeatable verification commands.' },
      { title: 'Deploy target is configured', status: deployTargets.length ? 'ready' : 'missing', detail: deployTargets.length ? deployTargets.map((target) => target.config).join(', ') : 'No deploy config detected.' },
      { title: 'Secrets are documented safely', status: exists('.env.example') ? 'ready' : 'missing', detail: 'Use .env.example for names only, never real secret values.' },
      { title: 'CI can guard production', status: githubWorkflows ? 'ready' : 'missing', detail: 'A CI workflow should run checks on push/PR.' },
    ];

    return {
      packageName: pkg.name || '',
      packageManager,
      framework: primaryFramework.name,
      frameworkSignals,
      outputDir,
      scripts,
      dependencies: Object.keys(dependencies).slice(0, 80),
      deployTargets,
      githubWorkflows,
      missing,
      checklist,
      commands: commands.slice(0, 14),
      detectedAt: nowIso(),
    };
  }

  extractFileMentions(text) {
    const matches = String(text || '').match(/(?:[\w.-]+[\\/])*[\w.-]+\.(?:js|jsx|ts|tsx|mjs|cjs|json|html|css|scss|md|py|rs|go|java|cs|php|rb|yml|yaml|toml|sql|sh|ps1)/gi) || [];
    return [...new Set(matches.map((item) => normalizeSlashes(item).replace(/^["']|["']$/g, '')))].slice(0, 20);
  }

  rankVerificationCommands(profile, card, proposal) {
    const changedFiles = new Set((proposal?.edits || []).map((edit) => edit.filePath));
    const outputText = `${card?.command || ''}\n${card?.stdout || ''}\n${card?.stderr || ''}`.toLowerCase();
    return (profile.commands || [])
      .map((entry) => {
        let score = 0;
        if (entry.command === card?.command) score += 30;
        if (entry.kind === 'targeted-test') score += 18;
        if (entry.kind === 'lint-fix' && /fix|autofix|lint|eslint|biome|prettier/.test(outputText)) score += 28;
        if (entry.kind === 'lint' && /lint|eslint|biome|stylelint|prettier/.test(outputText)) score += 25;
        if (entry.kind === 'test' && /test|spec|jest|vitest|playwright|cypress|expect|assert/.test(outputText)) score += 25;
        if (entry.kind === 'typecheck' && /tsc|typescript|type error|typecheck/.test(outputText)) score += 25;
        if (entry.kind === 'build' && /build|compile|bundle|vite|next/.test(outputText)) score += 15;
        if (changedFiles.size && entry.kind === 'test') score += 8;
        if (changedFiles.size && entry.kind === 'targeted-test') score += 18;
        if ((profile.diagnosticFiles || []).length && (entry.kind === 'lint' || entry.kind === 'typecheck')) score += 10;
        if (entry.kind === 'rerun') score += 20;
        return { ...entry, score };
      })
      .sort((a, b) => b.score - a.score);
  }

  async readShadcnContext() {
    if (!this.rootPath) return null;
    const configPath = path.join(this.rootPath, 'components.json');
    if (!fsSync.existsSync(configPath)) return null;
    const config = await safeReadJson(configPath);
    const pkg = await safeReadJson(path.join(this.rootPath, 'package.json'));
    const dependencies = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    };
    const uiFiles = [];
    try {
      const files = await vscode.workspace.findFiles(
        '{components,src,app}/**/{ui,components}/**/*.{ts,tsx,js,jsx}',
        ignoredGlob,
        80,
      );
      uiFiles.push(...files.map((uri) => normalizeSlashes(path.relative(this.rootPath, uri.fsPath))));
    } catch {
      // Optional project signal only.
    }
    return {
      configured: true,
      componentsJson: config,
      packageName: pkg.name || '',
      packageManager: fsSync.existsSync(path.join(this.rootPath, 'pnpm-lock.yaml'))
        ? 'pnpm'
        : fsSync.existsSync(path.join(this.rootPath, 'yarn.lock'))
          ? 'yarn'
          : 'npm',
      hasTailwind: Boolean(dependencies.tailwindcss || dependencies['@tailwindcss/vite']),
      hasShadcnCli: Boolean(dependencies.shadcn || dependencies['shadcn-ui']),
      uiFiles,
    };
  }

  latestPreviewStatus() {
    const preview = this.state.preview || null;
    const latestVerification = (this.state.artifacts || []).find((artifact) => artifact.kind === 'preview');
    const latestBrowserAgent = (this.state.artifacts || []).find((artifact) => artifact.kind === 'browser-agent');
    return {
      preview,
      latestVerification: latestVerification || null,
      latestBrowserAgent: latestBrowserAgent || null,
    };
  }

  async collectContext(prompt) {
    this.ensureWorkspace();
    const mentions = this.extractMentions(prompt);
    const contextFiles = new Set(this.state.contextFiles || []);
    const activeFile = await this.activeEditorFile();
    if (activeFile) contextFiles.add(activeFile);
    for (const mention of mentions) {
      if (mention !== 'codebase' && mention !== 'workspace') {
        contextFiles.add(this.safeRelative(mention));
      }
    }

    const selectedPaths = [...contextFiles].slice(0, 12);
    const files = await Promise.all(selectedPaths.map(async (filePath) => {
      try {
        return await this.readWorkspaceFile(filePath);
      } catch (error) {
        return {
          filePath,
          content: `Unable to read file: ${error instanceof Error ? error.message : 'Unknown error'}`,
          truncated: false,
        };
      }
    }));
    const includeTree = mentions.includes('codebase') || mentions.includes('workspace') || !files.length;
    const semanticIndex = await this.loadSemanticIndex();
    const [
      treeResult,
      shadcn,
      diagnostics,
      semanticHits,
      production,
      gitStatus,
      packageInfo,
    ] = await Promise.all([
      this.cachedTool(`tree:${includeTree ? 120 : 40}`, 6000, async () => this.projectTree(includeTree ? 120 : 40)).then((result) => result.value),
      this.cachedTool('shadcn', 12000, async () => this.readShadcnContext()).then((result) => result.value),
      this.cachedTool('diagnostics:workspace', 2500, async () => this.workspaceDiagnostics().catch(() => [])).then((result) => result.value),
      semanticIndex?.updatedAt
        ? this.cachedTool(`semantic-context:${String(prompt || '').slice(0, 120)}`, 15000, async () => this.semanticSearch(prompt, 12)).then((result) => result.value)
        : Promise.resolve([]),
      this.cachedTool('production_profile', 8000, async () => this.detectProductionProfile().catch((error) => ({ error: errorMessageFor(error) }))).then((result) => result.value),
      this.cachedTool('git_status', 3000, async () => this.gitStatusSummary()).then((result) => result.value),
      this.cachedTool('package:package.json', 8000, async () => this.inspectPackageScripts('package.json')).then((result) => result.value),
    ]);
    return {
      mentions,
      files,
      tree: treeResult,
      shadcn,
      diagnostics,
      semanticHits,
      production,
      gitStatus,
      packageInfo,
    };
  }

  async enqueuePrompt(content, mode = this.state.mode, rawAttachments = []) {
    const prompt = String(content || '').trim();
    const attachments = this.normalizeAttachments(rawAttachments);
    if (!prompt && !attachments.length) return;
    this.state.promptQueue = [
      ...(this.state.promptQueue || []),
      {
        id: id('queue'),
        content: prompt,
        mode: mode || this.state.mode || 'agent',
        attachments,
        createdAt: nowIso(),
      },
    ].slice(-20);
    await this.saveState();
    this.renderIfVisible(true);
  }

  async removeQueuedPrompt(queueId) {
    this.state.promptQueue = (this.state.promptQueue || []).filter((item) => item.id !== queueId);
    await this.saveState();
    this.renderIfVisible(this.isProcessing);
  }

  async clearPromptQueue() {
    if (!(this.state.promptQueue || []).length) return;
    this.state.promptQueue = [];
    await this.saveState();
    this.renderIfVisible(this.isProcessing);
  }

  async drainPromptQueue() {
    if (this.isProcessing) return;
    const next = (this.state.promptQueue || [])[0];
    if (!next) return;
    this.state.promptQueue = (this.state.promptQueue || []).slice(1);
    await this.saveState();
    await this.sendPrompt(next.content, next.mode || this.state.mode, next.attachments || [], { fromQueue: true });
  }

  async continueStoppedTrajectory() {
    const trajectory = this.state.stoppedTrajectory;
    if (!trajectory?.messages?.length) {
      await vscode.window.showInformationMessage('There is no stopped Neura trajectory to continue.');
      return;
    }
    if (this.isProcessing) {
      await this.enqueuePrompt('/continue', trajectory.mode || this.state.mode, []);
      return;
    }
    this.isProcessing = true;
    const mode = trajectory.mode || this.state.mode || 'agent';
    const context = {
      mentions: [],
      files: trajectory.contextFiles || [],
      tree: [],
      shadcn: null,
      diagnostics: [],
      semanticHits: [],
    };
    const thinkingMessage = {
      id: id('thinking'),
      role: 'tool',
      mode,
      content: JSON.stringify({
        kind: 'thinking',
        status: 'running',
        title: 'Continuing...',
        text: 'Neura is resuming the last stopped agent trajectory.',
        steps: trajectory.steps || [],
      }),
      createdAt: nowIso(),
    };
    this.state.messages.push(thinkingMessage);
    await this.saveState();
    this.renderIfVisible(true);
    try {
      const result = await this.runAgenticWorkflow(
        mode,
        trajectory.prompt || 'Continue the previous task.',
        context,
        [],
        thinkingMessage,
        trajectory,
      );
      thinkingMessage.content = JSON.stringify({
        kind: 'thinking',
        status: result._needsContinuation ? 'stopped' : 'done',
        title: result._needsContinuation ? 'Thinking paused' : 'Thinking',
        text: result._thinking || 'Continued the previous agent trajectory.',
        steps: result._agentSteps || [],
      });
      if (result._needsContinuation && result._stoppedTrajectory) {
        this.state.stoppedTrajectory = result._stoppedTrajectory;
      } else {
        this.state.stoppedTrajectory = null;
      }
      await this.acceptModelResult(mode, result, context);
    } catch (error) {
      thinkingMessage.content = JSON.stringify({
        kind: 'thinking',
        status: 'failed',
        title: 'Continuation stopped',
        text: errorMessageFor(error),
      });
      this.state.messages.push({
        id: id('msg'),
        role: 'assistant',
        mode,
        content: error instanceof Error ? error.message : 'Neura continuation failed.',
        createdAt: nowIso(),
      });
    } finally {
      this.isProcessing = false;
      await this.saveState();
      this.renderIfVisible();
      await this.drainPromptQueue();
    }
  }

  async sendPrompt(content, mode = this.state.mode, rawAttachments = [], options = {}) {
    const text = String(content || '').trim();
    if (/^\/?continue$/i.test(text) && this.state.stoppedTrajectory) {
      await this.continueStoppedTrajectory();
      return;
    }
    if (this.isProcessing && !options.fromQueue) {
      await this.enqueuePrompt(content, mode, rawAttachments);
      return;
    }
    this.isProcessing = true;
    try {
      await this.executePromptNow(content, mode, rawAttachments);
    } finally {
      this.isProcessing = false;
      await this.saveState();
      this.renderIfVisible();
      await this.drainPromptQueue();
    }
  }

  async executePromptNow(content, mode = this.state.mode, rawAttachments = []) {
    const parsed = this.parseWorkflowPrompt(content, mode);
    let prompt = parsed.prompt;
    mode = parsed.mode;
    const attachments = this.normalizeAttachments(rawAttachments);
    this.ensureWorkspace();
    const previousRunId = this.state.activeRunId;
    this.state.activeRunId = id('run');
    this.recordArtifact('run', `Run started: ${prompt.slice(0, 80) || parsed.command || mode}`, `Started ${modeLabels[mode] || mode} workflow.`, {
      runId: this.state.activeRunId,
      mode,
      prompt,
      attachmentCount: attachments.length,
    });

    if (/^(do it|build it|create it|make it|implement it|go ahead|continue)$/i.test(prompt.trim())) {
      const previousUserRequest = [...(this.state.messages || [])]
        .reverse()
        .find((message) => message.role === 'user' && !/^(do it|build it|create it|make it|implement it|go ahead|continue)$/i.test(String(message.content || '').trim()));
      if (previousUserRequest?.content) {
        prompt = `Build the previously requested project now: ${previousUserRequest.content}`;
      }
    }

    if (!prompt && (parsed.command === 'reasoning' || parsed.command === 'think')) {
      this.state.mode = mode;
      this.state.reasoning = parsed.reasoning;
      this.state.messages.push({
        id: id('msg'),
        role: 'assistant',
        mode,
        content: `Reasoning level set to ${reasoningLabels[this.state.reasoning]}. Add a coding task or use /plan, /edit, /build, or @file next.`,
        createdAt: nowIso(),
      });
      await this.saveState();
      this.renderIfVisible();
      return;
    }
    if (!prompt && parsed.command === 'mcp') {
      prompt = '/mcp';
    }
    if (!prompt) return;

    const context = await this.collectContext(prompt);
    const intent = this.classifyIntent(prompt, context, parsed);
    mode = intent.mode;
    this.state.mode = mode;
    if (mode === 'ship' && context.production) {
      this.recordArtifact('production-profile', `Production profile: ${this.projectName}`, `Detected ${context.production.framework || 'unknown'} shipping profile.`, {
        runId: this.state.activeRunId,
        profile: context.production,
      });
    }
    this.state.reasoning = parsed.reasoning;
    this.state.messages.push({
      id: id('msg'),
      role: 'user',
      mode,
      content: prompt,
      referencedFiles: this.extractMentions(prompt).filter((mention) => mention !== 'codebase'),
      attachments: attachments.map((attachment) => ({
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
      })),
      createdAt: nowIso(),
    });
    const thinkingMessage = {
      id: id('thinking'),
      role: 'tool',
      mode,
      content: JSON.stringify({
        kind: 'thinking',
        status: 'running',
        title: 'Thinking...',
        text: `Neura is analyzing the request with ${this.config.model || 'the selected model'}.`,
      }),
      createdAt: nowIso(),
    };
    this.state.messages.push(thinkingMessage);
    await this.saveState();
    this.renderIfVisible(true);

    if (parsed.command === 'mcp') {
      thinkingMessage.content = JSON.stringify({
        kind: 'thinking',
        status: 'done',
        title: 'Thinking',
        text: 'Detected an MCP workflow request and opened the approval flow.',
      });
      await this.saveState();
      this.renderIfVisible();
      await this.promptMcpToolCall();
      return;
    }

    if (!intent.allowed) {
      thinkingMessage.content = JSON.stringify({
        kind: 'thinking',
        status: 'done',
        title: 'Thinking',
        text: `Intent classified as ${intent.intent}. Neura Composer only handles coding work inside the workspace.`,
      });
      this.state.messages.push({
        id: id('msg'),
        role: 'assistant',
        mode,
        content: intent.message,
        createdAt: nowIso(),
      });
      await this.saveState();
      this.renderIfVisible();
      return;
    }

    this.rememberFromPrompt(prompt, intent.intent, context.files.map((file) => file.filePath));

    if (intent.intent === 'run') {
      const handled = await this.handleRunIntent(thinkingMessage);
      if (handled) return;
    }

    if (!this.config.configured) {
      thinkingMessage.content = JSON.stringify({
        kind: 'thinking',
        status: 'failed',
        title: 'Thinking stopped',
        text: 'No AI provider is configured, so Neura cannot start a coding request.',
      });
      this.state.messages.push({
        id: id('msg'),
        role: 'assistant',
        mode,
        content:
          'No AI provider is configured for Neura IDE. Configure OpenRouter first, or Ollama, or NVIDIA NIM in Settings. Env fallbacks: OPENROUTER_API_KEY/OPENROUTER_MODEL, OLLAMA_API_KEY/OLLAMA_MODEL, or NVIDIA_NIM_API_KEY/NVIDIA_NIM_MODEL.',
        createdAt: nowIso(),
      });
      await this.saveState();
      this.renderIfVisible();
      return;
    }

    if (editableModes.has(mode)) {
      await this.runAutoSwarmForPrompt(prompt, mode, context, thinkingMessage);
      this.recordArtifact('run-complete', `Run delegated to swarm: ${prompt.slice(0, 80) || mode}`, `Started an automatic ${modeLabels[mode] || mode} swarm workflow.`, {
        runId: this.state.activeRunId || previousRunId,
        mode,
        prompt,
        status: 'swarm-running',
      });
      await this.saveState();
      this.renderIfVisible(true);
      return;
    }

    let runStatus = 'completed';
    try {
      let result = editableModes.has(mode)
        ? await this.runAgenticWorkflow(mode, prompt, context, attachments, thinkingMessage)
        : await this.callNim(mode, prompt, context, attachments);
      result = this.ensureProductionReadyResult(mode, result, context);
      if (mode === 'builder' && !this.hasResultEditLike(result)) {
        throw new Error(
          `Builder did not return file changes for "${prompt}". I rejected that response because Build mode must create or update files. Retry the same request, or add more detail if you want a specific framework.`,
        );
      }
      if (
        mode === 'ship' &&
        !(Array.isArray(result.questions) && result.questions.length) &&
        !this.hasResultEditLike(result) &&
        !this.normalizeResultCommands(result).length
      ) {
        throw new Error(
          `Ship mode did not return production edits or approval-gated commands for "${prompt}". I rejected that response because shipping must produce a concrete preflight/deploy path.`,
        );
      }
      thinkingMessage.content = JSON.stringify({
        kind: 'thinking',
        status: result._needsContinuation ? 'stopped' : 'done',
        title: result._needsContinuation ? 'Thinking paused' : 'Thinking',
        text:
          result._thinking ||
          `Analyzed the workspace context and selected the ${modeLabels[mode] || mode} workflow.`,
        steps: result._agentSteps || [],
      });
      if (result._needsContinuation && result._stoppedTrajectory) {
        this.state.stoppedTrajectory = result._stoppedTrajectory;
      } else {
        this.state.stoppedTrajectory = null;
      }
      await this.acceptModelResult(mode, result, context);
    } catch (error) {
      runStatus = 'failed';
      thinkingMessage.content = JSON.stringify({
        kind: 'thinking',
        status: 'failed',
        title: 'Thinking stopped',
        text: errorMessageFor(error),
      });
      this.state.messages.push({
        id: id('msg'),
        role: 'assistant',
        mode,
        content: error instanceof Error ? error.message : 'Neura Composer failed.',
        createdAt: nowIso(),
      });
    }
    await this.saveState();
    this.renderIfVisible();
    this.recordArtifact('run-complete', `Run ${runStatus}: ${prompt.slice(0, 80) || mode}`, `Finished ${modeLabels[mode] || mode} workflow with status ${runStatus}.`, {
      runId: this.state.activeRunId || previousRunId,
      mode,
      prompt,
      status: runStatus,
    });
    await this.saveState();
  }

  async setMode(mode) {
    if (!modeLabels[mode]) return;
    this.state.mode = mode;
    await this.saveState();
    this.renderIfVisible();
  }

  async setReasoning(reasoning) {
    if (!reasoningLabels[reasoning]) return;
    this.state.reasoning = reasoning;
    const target = this.rootPath
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    await vscode.workspace.getConfiguration('neura.nim').update('reasoning', reasoning, target);
    await this.saveState();
    this.renderIfVisible();
  }

  async setPermissionMode(permissionMode) {
    if (!permissionLabels[permissionMode]) return;
    this.state.permissionMode = permissionMode;
    await this.saveState();
    this.renderIfVisible();
  }

  async setModel(model) {
    const selected = String(model || '').trim();
    if (!selected) return;
    const target = this.rootPath
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    const provider = this.config.provider || 'nim';
    const section = provider === 'openrouter'
      ? 'neura.openrouter'
      : provider === 'ollama'
        ? 'neura.ollama'
        : 'neura.nim';
    await vscode.workspace.getConfiguration(section).update('model', selected, target);
    this.config = await this.readNimConfig();
    logNeura('Model switched', {
      provider: this.config.provider,
      model: this.config.model,
      baseUrl: this.config.baseUrl,
      configured: this.config.configured,
    });
    await this.saveState();
    this.renderIfVisible();
  }

  async editSelectionFromEditor() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') throw new Error('Open a file before using Neura inline edit.');
    const selectedText = editor.selection && !editor.selection.isEmpty
      ? editor.document.getText(editor.selection)
      : editor.document.getText();
    const relative = this.rootPath
      ? normalizeSlashes(path.relative(this.rootPath, editor.document.uri.fsPath))
      : editor.document.fileName;
    const instruction = await vscode.window.showInputBox({
      title: 'Neura: Edit Selection',
      prompt: 'Describe the edit Neura should make.',
      ignoreFocusOut: true,
    });
    if (!instruction) return;
    await this.reveal();
    await this.sendPrompt(
      [
        `/edit ${instruction}`,
        `@${relative}`,
        '',
        'Selected code/context:',
        selectedText.slice(0, 12000),
      ].join('\n'),
      'agent',
    );
  }

  async explainCurrentFile() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') throw new Error('Open a file before asking Neura to explain it.');
    const relative = this.rootPath
      ? normalizeSlashes(path.relative(this.rootPath, editor.document.uri.fsPath))
      : editor.document.fileName;
    await this.reveal();
    await this.sendPrompt(`/explain @${relative} Explain this file and call out important structure, risks, and likely edit points.`, 'ask');
  }

  isCodingRequest(prompt, context) {
    const text = String(prompt || '').trim();
    if (!text) return false;
    const mentions = context.mentions || [];
    if (mentions.includes('codebase') || mentions.includes('workspace')) return true;
    if ((context.files || []).length > 0) return true;
    if (fileReferencePattern.test(text)) return true;
    if (codingKeywordPattern.test(text)) return true;
    return false;
  }

  async addContext(filePath) {
    const safe = this.safeRelative(filePath);
    if (!safe || safe === 'codebase' || safe === 'workspace') return;
    this.state.contextFiles = [...new Set([...(this.state.contextFiles || []), safe])];
    await this.saveState();
    this.renderIfVisible();
  }

  async removeContext(filePath) {
    this.state.contextFiles = (this.state.contextFiles || []).filter((item) => item !== filePath);
    await this.saveState();
    this.renderIfVisible();
  }

  async callNim(mode, prompt, context, attachments = []) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const userContent = this.buildUserContent(prompt, context, attachments);
    const requestMeta = {
      mode,
      model: this.config.model,
      provider: this.config.provider,
      baseUrl: this.config.baseUrl,
      timeoutMs: this.config.timeoutMs,
      contextFiles: context.files.length,
      treeFiles: context.tree.length,
      attachments: attachments.length,
    };
    logNeura('AI request started', requestMeta);
    try {
      const { payload, provider } = await this.requestChatCompletion({
        temperature: mode === 'ask' ? 0.15 : 0.2,
        max_tokens: editableModes.has(mode) ? 6000 : 3500,
        messages: [
          { role: 'system', content: this.systemPrompt(mode) },
          { role: 'user', content: userContent },
        ],
      }, requestMeta);
      requestMeta.provider = provider.id;
      requestMeta.providerLabel = provider.label;
      requestMeta.model = provider.model;
      const choice = payload.choices?.[0] || {};
      const message = choice.message || {};
      const content = typeof message.content === 'string' ? message.content : '';
      const reasoningText =
        typeof message.reasoning_content === 'string'
          ? message.reasoning_content
          : typeof message.reasoning === 'string'
            ? message.reasoning
            : '';
      if (!content) {
        logNeura('AI request returned no final content', {
          ...requestMeta,
          finishReason: choice.finish_reason,
          reasoningChars: reasoningText.length,
          reasoningPreview: reasoningText.slice(0, 500),
        });
        if (reasoningText) {
          throw new Error(
            `${provider.label} returned reasoning output but no final Composer response for ${provider.model}. Finish reason: ${choice.finish_reason || 'unknown'}. The fallback chain was already attempted. Details are in Output: Neura Composer.`,
          );
        }
        throw new Error(
          `${provider.label} returned an empty response for ${provider.model}. The fallback chain was already attempted. Details are in Output: Neura Composer.`,
        );
      }
      logNeura('AI request completed', {
        ...requestMeta,
        replyChars: String(content).length,
      });
      try {
        const parsed = parseJsonObject(content);
        if (reasoningText) {
          parsed._thinking = reasoningText;
        }
        parsed._finishReason = choice.finish_reason || '';
        return parsed;
      } catch (error) {
        logNeura('AI response JSON parse failed', {
          ...requestMeta,
          replyPreview: String(content).slice(0, 700),
          error: errorMessageFor(error),
        });
        throw new Error(
          `${provider.label} returned text that Neura could not parse as a coding response. Try a stricter coding model or ask again. Details are in Output: Neura Composer.`,
        );
      }
    } catch (error) {
      const message = errorMessageFor(error);
      logNeura('AI request error', {
        ...requestMeta,
        error: message,
      });
      if (error?.name === 'AbortError') {
        throw new Error(
          `No AI provider replied within ${Math.round(this.config.timeoutMs / 1000)}s for the active fallback chain.`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async callNimStrictBuilder(prompt, context) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const requestMeta = {
      mode: 'builder-strict',
      model: this.config.model,
      provider: this.config.provider,
      baseUrl: this.config.baseUrl,
      timeoutMs: this.config.timeoutMs,
      treeFiles: context.tree.length,
    };
    const userContent = this.contextPrompt(prompt, context, []);
    const systemContent = [
      'You are Neura Builder, a code generator inside Neura IDE.',
      'Return exactly one JSON object. No markdown. No explanation outside JSON.',
      'Create real working project files for the user request.',
      'The result must be production-ready by default, not a prototype.',
      'The edits array is mandatory unless you ask a blocking clarification question.',
      'Include verification and preview commands so the user can approve and run them.',
      'For simple static websites/apps, create complete index.html, styles.css, and app.js files with responsive layout, accessible controls, durable local state when useful, and real empty/error states.',
      'If components.json is present, respect the existing shadcn/ui and Tailwind setup. Propose package/CLI commands instead of silently assuming dependencies.',
      'Add package scripts, deploy config, .env.example without secrets, CI, or README deploy notes only when they are genuinely useful for production readiness.',
      'Use full-file contents for every create/update edit. Use relative workspace paths.',
      'Do not claim files were created. Only propose edits.',
      'Schema: {"message":"summary","questions":["only if blocked"],"todos":[{"title":"task","rationale":"why","status":"pending"}],"edits":[{"operation":"create|update|delete","filePath":"path","content":"full file content","rationale":"why"}],"commands":[{"command":"shell command","purpose":"why"}],"preview":{"command":"shell command","url":"http://localhost:port"},"referencedFiles":["path"]}',
    ].join('\n');
    logNeura('Strict builder request started', requestMeta);
    try {
      const { payload, provider } = await this.requestChatCompletion({
        temperature: 0.1,
        max_tokens: 7000,
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: userContent },
        ],
      }, requestMeta);
      requestMeta.provider = provider.id;
      requestMeta.providerLabel = provider.label;
      requestMeta.model = provider.model;
      const choice = payload.choices?.[0] || {};
      const message = choice.message || {};
      const content = typeof message.content === 'string' ? message.content : '';
      if (!content) {
        throw new Error('Strict Builder returned no final content.');
      }
      logNeura('Strict builder request completed', {
        ...requestMeta,
        replyChars: content.length,
      });
      const parsed = parseJsonObject(content);
      parsed._finishReason = choice.finish_reason || '';
      return parsed;
    } catch (error) {
      logNeura('Strict builder request error', {
        ...requestMeta,
        error: errorMessageFor(error),
      });
      if (error?.name === 'AbortError') {
        throw new Error(`Strict Builder timed out after ${Math.round(this.config.timeoutMs / 1000)}s.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  buildUserContent(prompt, context, attachments) {
    const text = this.contextPrompt(prompt, context, attachments);
    const images = attachments.filter((item) => item.mimeType.startsWith('image/') && item.dataUrl);
    if (!images.length) return text;
    return [
      { type: 'text', text },
      ...images.map((image) => ({
        type: 'image_url',
        image_url: { url: image.dataUrl },
      })),
    ];
  }

  systemPrompt(mode) {
    const base = [
      'You are Neura Composer, an independent AI coding assistant inside Neura IDE.',
      'You are optimized only for software engineering tasks: reading code, explaining code, planning changes, editing files, building apps/sites, proposing terminal verification commands, and debugging errors.',
      'If the user asks anything outside coding or the current workspace, refuse briefly and redirect them to a coding task.',
      'Return exactly one JSON object. Do not wrap it in prose.',
      'Never include secrets. Do not claim a file was changed; only propose edits.',
      'Use full-file contents for every create/update edit. Use relative workspace paths.',
      'Commands are proposals only. The IDE asks the user before any command runs.',
      'Prefer small, coherent change batches with clear rationale.',
      'First think through whether the request is actionable. If critical requirements are missing, ask concise questions instead of inventing details.',
      'If there is enough information, proceed with real build/edit proposals immediately. Do not stop at a plan for app/site creation requests.',
      'When asking questions, return {"message":"what you need clarified","questions":["question"],"referencedFiles":["path"]} and no edits.',
      `Reasoning level requested by UI: ${reasoningLabels[this.state.reasoning] || 'Medium'}. For high reasoning, inspect context carefully and produce a stronger plan before edits; do not reveal private chain-of-thought.`,
    ];
    if (mode === 'ask') {
      base.push(
        'Mode: Explain. Read-only codebase Q&A. Explain code, architecture, errors, APIs, or project structure. Do not answer general knowledge. Do not propose edits or commands.',
        'Schema: {"message":"coding answer or brief refusal","referencedFiles":["path"]}',
      );
    } else if (mode === 'plan') {
      base.push(
        'Mode: Plan. Produce an implementation plan and todo list for coding work. Do not propose file contents.',
        'Schema: {"message":"summary","todos":[{"title":"task","rationale":"why","status":"pending"}],"referencedFiles":["path"]}',
      );
    } else if (mode === 'builder') {
      base.push(
        'Mode: Build. Create or extend production-ready websites/apps from natural language. Propose files, package changes, preview/build commands, verification steps, and deploy-ready configuration when appropriate.',
        'For a simple website/app request, create individual files such as index.html, styles.css, script.js, package.json, or framework files as appropriate. Include complete file contents and make the result responsive, accessible, durable, and ready to verify.',
        'Builder must include at least one edit and approval-gated verification/preview commands unless it asks a blocking clarification question. A plan without edits is invalid in Build mode.',
        'Use the production shipping profile in context. If deploy, CI, .env.example, package scripts, or README ship notes are missing and relevant, propose real edits. Never use fake secrets.',
        'Schema: {"message":"summary","questions":["only if blocked"],"todos":[{"title":"task","rationale":"why","status":"pending"}],"edits":[{"operation":"create|update|delete","filePath":"path","content":"full content for create/update","rationale":"why"}],"commands":[{"command":"shell command","purpose":"why"}],"preview":{"command":"dev server command","url":"http://localhost:port"},"referencedFiles":["path"]}',
      );
    } else if (mode === 'ship') {
      base.push(
        'Mode: Ship. Prepare the workspace for production release. Inspect the production shipping profile, fix real readiness gaps, and propose an approval-gated preflight/deploy sequence.',
        'Ship mode should cover dependency install, lint/typecheck/test/build, local preview or browser verification, deploy preview, production deploy, and proof/report artifacts where applicable.',
        'When deployment, CI, or environment documentation is missing, propose real file edits such as netlify.toml, vercel.json, Dockerfile, .env.example without secrets, GitHub Actions CI, README deploy notes, or package scripts. Do not add fake secret values.',
        'Ship mode must include command proposals unless it asks a blocking clarification question. Prefer deploy preview or dry-run commands before production deploy commands.',
        'Schema: {"message":"production readiness summary","questions":["only if blocked"],"todos":[{"title":"task","rationale":"why","status":"pending"}],"edits":[{"operation":"create|update|delete","filePath":"path","content":"full content for create/update","rationale":"why"}],"commands":[{"command":"shell command","purpose":"why"}],"preview":{"command":"production preview command","url":"http://localhost:port"},"referencedFiles":["path"]}',
      );
    } else {
      base.push(
        'Mode: Edit. Implement coding tasks by proposing multi-file edits and verification commands.',
        'Schema: {"message":"summary","questions":["only if blocked"],"todos":[{"title":"task","rationale":"why","status":"pending"}],"edits":[{"operation":"create|update|delete","filePath":"path","content":"full content for create/update","rationale":"why"}],"commands":[{"command":"shell command","purpose":"why"}],"referencedFiles":["path"]}',
      );
    }
    return base.join('\n');
  }

  contextPrompt(prompt, context, attachments = []) {
    const files = context.files
      .map(
        (file) =>
          `--- ${file.filePath}${file.truncated ? ' (truncated)' : ''} ---\n${file.content}`,
      )
      .join('\n\n');
    const textAttachments = attachments
      .filter((item) => item.text && !item.mimeType.startsWith('image/'))
      .map((item) => `--- attachment: ${item.name} (${item.mimeType}) ---\n${item.text}`)
      .join('\n\n');
    const mediaAttachments = attachments
      .filter((item) => item.mimeType.startsWith('image/'))
      .map((item) => `${item.name} (${item.mimeType}, ${Math.round(item.size / 1024)} KB)`)
      .join('\n');
    const shadcnText = context.shadcn
      ? [
          `packageManager: ${context.shadcn.packageManager}`,
          `hasTailwind: ${context.shadcn.hasTailwind}`,
          `components.json: ${JSON.stringify(context.shadcn.componentsJson).slice(0, 1600)}`,
          context.shadcn.uiFiles?.length
            ? `uiFiles:\n${context.shadcn.uiFiles.join('\n')}`
            : 'uiFiles: none detected',
        ].join('\n')
      : '';
    const diagnosticText = (context.diagnostics || [])
      .slice(0, 30)
      .map((item) => `${item.filePath}:${item.line}:${item.column} ${item.severity} ${item.message}`)
      .join('\n');
    const semanticText = (context.semanticHits || [])
      .slice(0, 12)
      .map((hit) => hit.kind === 'symbol'
        ? `${hit.filePath}:${hit.line} symbol ${hit.name} - ${hit.preview}`
        : `${hit.filePath} terms ${(hit.terms || []).join(', ')}`)
      .join('\n');
    const production = context.production || null;
    const productionText = production
      ? [
          production.error ? `error: ${production.error}` : '',
          production.framework ? `framework: ${production.framework}` : '',
          production.packageManager ? `packageManager: ${production.packageManager}` : '',
          production.outputDir ? `outputDir: ${production.outputDir}` : '',
          production.deployTargets?.length
            ? `deployTargets: ${production.deployTargets.map((target) => target.id || target.config).join(', ')}`
            : 'deployTargets: none detected',
          production.missing?.length ? `readinessGaps:\n${production.missing.map((item) => `- ${item}`).join('\n')}` : 'readinessGaps: none detected',
          production.commands?.length
            ? `recommendedCommands:\n${production.commands.map((item) => `- ${item.command} (${item.kind}): ${item.purpose}`).join('\n')}`
            : 'recommendedCommands: none detected',
          production.checklist?.length
            ? `checklist:\n${production.checklist.map((item) => `- [${item.status}] ${item.title}: ${item.detail}`).join('\n')}`
            : '',
        ].filter(Boolean).join('\n')
      : '';
    const memory = this.state.memory || {};
    const memoryText = [
      ...(memory.facts || [])
        .slice(0, 12)
        .map((fact) => `- ${fact.text}${fact.files?.length ? ` [files: ${fact.files.join(', ')}]` : ''}`),
      ...(memory.sessionSummaries || [])
        .slice(0, 5)
        .map((summary) => `- Previous session "${summary.title}": ${summary.summary}`),
    ].join('\n');
    return [
      `Project: ${this.projectName}`,
      'Scope: coding work only. Ignore or refuse non-coding requests.',
      `Workflow: ${modeLabels[this.state.mode] || 'Edit'}`,
      `Reasoning: ${reasoningLabels[this.state.reasoning] || 'Medium'}`,
      `Permission mode: ${permissionLabels[this.state.permissionMode] || 'Ask Permission'}`,
      memoryText ? `Persistent workspace memory:\n${memoryText}` : 'Persistent workspace memory: none',
      `User request:\n${prompt}`,
      `Workspace file tree:\n${context.tree.join('\n') || '(empty)'}`,
      shadcnText ? `shadcn/ui project context:\n${shadcnText}` : 'shadcn/ui project context: not configured',
      diagnosticText ? `Current editor diagnostics:\n${diagnosticText}` : 'Current editor diagnostics: none',
      semanticText ? `Semantic index hits:\n${semanticText}` : 'Semantic index hits: none',
      productionText ? `Production shipping profile:\n${productionText}` : 'Production shipping profile: unavailable',
      files ? `Selected context files:\n${files}` : 'Selected context files: none',
      textAttachments ? `Attached text files:\n${textAttachments}` : 'Attached text files: none',
      mediaAttachments ? `Attached media:\n${mediaAttachments}` : 'Attached media: none',
    ].join('\n\n');
  }

  firstString(...values) {
    for (const value of values) {
      if (typeof value === 'string' && value.length) return value;
    }
    return '';
  }

  normalizeEditLike(item, fallbackPath = '') {
    if (!item || typeof item !== 'object') return null;
    const filePath = this.firstString(
      item.filePath,
      item.path,
      item.filename,
      item.name,
      item.uri,
      fallbackPath,
    );
    if (!filePath) return null;
    const rawOperation = this.firstString(item.operation, item.type, item.action, item.kind).toLowerCase();
    const operation =
      rawOperation === 'delete' || rawOperation === 'remove'
        ? 'delete'
        : rawOperation === 'create' || rawOperation === 'add' || item.newFile === true
          ? 'create'
          : 'update';
    return {
      operation,
      filePath,
      content:
        operation === 'delete'
          ? ''
          : this.firstString(
              item.content,
              item.contents,
              item.code,
              item.text,
              item.newContent,
              item.fullContent,
              item.body,
            ),
      rationale: this.firstString(item.rationale, item.reason, item.summary, item.description),
    };
  }

  normalizeResultEdits(result) {
    const edits = [];
    const add = (item, fallbackPath = '') => {
      const normalized = this.normalizeEditLike(item, fallbackPath);
      if (normalized) edits.push(normalized);
    };
    if (Array.isArray(result?.edits)) result.edits.forEach((item) => add(item));
    if (Array.isArray(result?.fileChanges)) result.fileChanges.forEach((item) => add(item));
    if (Array.isArray(result?.changes)) result.changes.forEach((item) => add(item));
    if (Array.isArray(result?.files)) result.files.forEach((item) => add(item));
    if (result?.files && typeof result.files === 'object' && !Array.isArray(result.files)) {
      for (const [filePath, value] of Object.entries(result.files)) {
        if (typeof value === 'string') add({ filePath, content: value, operation: 'create' });
        else add(value, filePath);
      }
    }
    const seen = new Set();
    return edits.filter((edit) => {
      if (!edit.filePath || seen.has(edit.filePath)) return false;
      seen.add(edit.filePath);
      return true;
    });
  }

  normalizeResultCommands(result) {
    const values = [];
    if (Array.isArray(result?.commands)) values.push(...result.commands);
    if (Array.isArray(result?.terminalCommands)) values.push(...result.terminalCommands);
    if (Array.isArray(result?.runCommands)) values.push(...result.runCommands);
    return values
      .map((command) => {
        if (typeof command === 'string') return { command, purpose: 'Suggested command.' };
        if (!command || typeof command !== 'object') return null;
        return {
          command: this.firstString(command.command, command.cmd, command.shell, command.run),
          purpose: this.firstString(command.purpose, command.reason, command.description),
        };
      })
      .filter((command) => command?.command);
  }

  hasResultEditLike(result) {
    return this.normalizeResultEdits(result).length > 0;
  }

  ensureProductionReadyResult(mode, result, context) {
    if (!result || !['builder', 'ship'].includes(mode)) return result;
    if (Array.isArray(result.questions) && result.questions.length) return result;
    const profile = context.production && !context.production.error ? context.production : null;
    const normalizedEdits = this.normalizeResultEdits(result);
    const existingCommands = this.normalizeResultCommands(result);
    const commands = Array.isArray(result.commands) ? [...result.commands] : [];
    const addCommand = (command, purpose) => {
      const value = String(command || '').trim();
      if (!value || existingCommands.some((item) => item.command === value) || commands.some((item) => String(item.command || item) === value)) return;
      commands.push({ command: value, purpose });
    };

    const proposedPackage = normalizedEdits.find((edit) => normalizeSlashes(edit.filePath).toLowerCase() === 'package.json');
    let proposedScripts = {};
    if (proposedPackage?.content) {
      try {
        const parsedPackage = JSON.parse(proposedPackage.content);
        proposedScripts = parsedPackage.scripts && typeof parsedPackage.scripts === 'object' ? parsedPackage.scripts : {};
      } catch {
        proposedScripts = {};
      }
    }
    const packageManager = profile?.packageManager || 'npm';
    const runScript = (name) => `${packageManager} run ${name}`;
    const addScriptCommand = (scripts, pattern, purpose) => {
      const match = Object.entries(scripts || {}).find(([name, script]) => pattern.test(`${name} ${script}`));
      if (match) addCommand(runScript(match[0]), purpose.replace('{script}', match[0]));
    };

    if (!existingCommands.length && profile?.commands?.length) {
      for (const entry of profile.commands) {
        if (mode === 'builder' && /^deploy-production$/.test(entry.kind || '')) continue;
        addCommand(entry.command, entry.purpose);
      }
    }
    if (proposedPackage) {
      addCommand(packageManager === 'npm' ? 'npm install' : `${packageManager} install`, 'Install the proposed app dependencies before verification.');
      addScriptCommand(proposedScripts, /\b(lint|eslint|biome|stylelint)\b/i, 'Run lint script "{script}" before accepting the build.');
      addScriptCommand(proposedScripts, /\b(typecheck|tsc|check-types)\b/i, 'Run typecheck script "{script}" before accepting the build.');
      addScriptCommand(proposedScripts, /\b(test|vitest|jest|playwright|cypress)\b/i, 'Run test script "{script}" before accepting the build.');
      addScriptCommand(proposedScripts, /\b(build|compile)\b/i, 'Run production build script "{script}".');
      addScriptCommand(proposedScripts, /\b(preview|serve)\b/i, 'Run local production preview script "{script}".');
    }
    const createsStaticEntry = normalizedEdits.some((edit) => /(^|\/)index\.html$/i.test(normalizeSlashes(edit.filePath)));
    if (!commands.length && createsStaticEntry) {
      addCommand('npx serve . -l 4173', 'Serve the static app locally for production smoke testing.');
    }

    if (commands.length) {
      result.commands = commands;
    }
    if (!result.preview && commands.some((item) => /\b(preview|serve|http-server|vite --host|next start)\b/i.test(String(item.command || item)))) {
      const previewCommand = commands.find((item) => /\b(preview|serve|http-server|vite --host|next start)\b/i.test(String(item.command || item)));
      result.preview = {
        command: String(previewCommand.command || previewCommand),
        url: 'http://localhost:4173',
      };
    }

    const readinessTodos = (profile?.checklist || [])
      .filter((item) => item.status !== 'ready')
      .slice(0, 5)
      .map((item) => ({
        title: item.title,
        rationale: item.detail,
        status: 'pending',
      }));
    if (readinessTodos.length) {
      const existingTodos = Array.isArray(result.todos) ? result.todos : [];
      result.todos = [...existingTodos, ...readinessTodos].slice(0, 12);
    }
    return result;
  }

  async acceptModelResult(mode, result, context) {
    const message = String(result.message || result.answer || 'Done.');
    const questions = Array.isArray(result.questions)
      ? result.questions.map((question) => String(question || '').trim()).filter(Boolean)
      : [];
    this.state.messages.push({
      id: id('msg'),
      role: 'assistant',
      mode,
      content: questions.length
        ? `${message}\n\n${questions.map((question, index) => `${index + 1}. ${question}`).join('\n')}`
        : message,
      referencedFiles: result.referencedFiles || context.files.map((file) => file.filePath),
      createdAt: nowIso(),
    });

    if (questions.length) {
      return;
    }

    const todos = Array.isArray(result.todos) ? result.todos : [];
    const normalizedResultEdits = this.normalizeResultEdits(result);
    const normalizedResultCommands = this.normalizeResultCommands(result);
    const hasProposedWork =
      editableModes.has(mode) &&
      (normalizedResultEdits.length || normalizedResultCommands.length);

    if (todos.length && !hasProposedWork) {
      this.state.messages.push({
        id: id('todo'),
        role: 'tool',
        mode,
        content: JSON.stringify({ kind: result.taskGraph ? 'taskGraph' : 'todos', items: todos, graph: result.taskGraph || null }),
        createdAt: nowIso(),
      });
    }

    if (!editableModes.has(mode)) {
      return;
    }

    if (!this.canProposeWorkspaceChanges()) {
      if (normalizedResultEdits.length || normalizedResultCommands.length) {
        this.state.messages.push({
          id: id('msg'),
          role: 'assistant',
          mode,
          content: 'Read Only permission is enabled, so I did not create edit or terminal proposals. Switch permission mode to Ask Before Write, Workspace Auto, or Full Auto to build files.',
          createdAt: nowIso(),
        });
      }
      return;
    }

    const edits = normalizedResultEdits
      .map((edit) => ({
        id: id('edit'),
        operation: ['create', 'update', 'delete'].includes(edit.operation) ? edit.operation : 'update',
        filePath: this.safeRelative(edit.filePath),
        content: edit.operation === 'delete' ? '' : String(edit.content ?? ''),
        rationale: String(edit.rationale || ''),
        status: 'proposed',
      }))
      .filter((edit) => edit.filePath && edit.filePath !== 'codebase' && edit.filePath !== 'workspace');
    const commands = normalizedResultCommands
      .filter(() => this.canProposeTerminalCommands())
      .filter((command) => command?.command)
      .map((command) => ({
        id: id('cmd'),
        command: String(command.command),
        purpose: String(command.purpose || 'Suggested verification or setup command.'),
        status: 'proposed',
      }));

    if (edits.length || commands.length) {
      const proposal = {
        id: id('proposal'),
        summary: message,
        mode,
        status: 'proposed',
        todos,
        taskGraph: result.taskGraph || null,
        edits,
        commands,
        preview: result.preview || null,
        createdAt: nowIso(),
      };
      this.state.proposals.unshift(proposal);
      this.recordArtifact('proposal', `${modeLabels[mode] || 'Agent'} proposal`, message, {
        proposalId: proposal.id,
        files: edits.map((edit) => edit.filePath),
        commands: commands.map((command) => command.command),
      });
      if (this.canAutoApplyEdits()) {
        if (edits.length) {
          await this.applyProposal(proposal.id, undefined, { skipConfirmation: true, skipRefresh: true });
        }
      }
      if (this.canAutoRunCommands()) {
        for (const command of commands) {
          await this.runCommand(proposal.id, command.id, command.command, { skipConfirmation: true });
        }
      }
    }
  }

  async createCheckpoint(label, edits) {
    const files = [];
    for (const edit of edits) {
      const absolute = this.absoluteFor(edit.filePath);
      const existed = fsSync.existsSync(absolute);
      files.push({
        filePath: edit.filePath,
        existed,
        content: existed ? await fs.readFile(absolute, 'utf8') : '',
      });
    }
    const checkpoint = {
      id: id('checkpoint'),
      label,
      files,
      createdAt: nowIso(),
    };
    this.state.checkpoints.unshift(checkpoint);
    this.state.checkpoints = this.state.checkpoints.slice(0, 20);
    this.recordArtifact('checkpoint', label, `${files.length} file snapshot(s) saved before applying changes.`, {
      checkpointId: checkpoint.id,
      files: files.map((file) => file.filePath),
    });
    return checkpoint;
  }

  async applyProposal(proposalId, filePath, options = {}) {
    const proposal = this.state.proposals.find((item) => item.id === proposalId);
    if (!proposal) throw new Error('Change proposal was not found.');
    const edits = proposal.edits.filter(
      (edit) => edit.status === 'proposed' && (!filePath || edit.filePath === filePath),
    );
    if (!edits.length) return;

    for (const edit of edits) {
      const policy = this.evaluatePolicy('file_write', edit.filePath, {
        proposalId,
        operation: edit.operation,
        auto: Boolean(options.skipConfirmation),
      });
      if (policy.decision === 'deny') throw new Error(`Neura policy denied file write for ${edit.filePath}: ${policy.reason}`);
      if (policy.decision === 'ask' && options.skipConfirmation) {
        throw new Error(`Neura policy requires approval before writing ${edit.filePath}.`);
      }
    }

    if (!options.skipConfirmation) {
      const approval = await vscode.window.showWarningMessage(
        `${filePath ? `Apply ${filePath}` : `Apply ${edits.length} file change(s)`}? Neura will create a local checkpoint first.`,
        { modal: true },
        'Apply',
      );
      if (approval !== 'Apply') return;
    }

    const checkpoint = await this.createCheckpoint(`Before ${proposal.summary.slice(0, 80)}`, edits);
    proposal.lastCheckpointId = checkpoint.id;
    const beforeFiles = new Map((checkpoint.files || []).map((file) => [file.filePath, file]));
    const beforeAfter = [];
    for (const edit of edits) {
      const absolute = this.absoluteFor(edit.filePath);
      if (edit.operation === 'delete') {
        if (fsSync.existsSync(absolute)) await fs.unlink(absolute);
      } else {
        await fs.mkdir(path.dirname(absolute), { recursive: true });
        await fs.writeFile(absolute, edit.content, 'utf8');
      }
      const afterExists = fsSync.existsSync(absolute);
      const afterContent = afterExists && edit.operation !== 'delete' ? await fs.readFile(absolute, 'utf8') : '';
      const before = beforeFiles.get(edit.filePath);
      beforeAfter.push({
        filePath: edit.filePath,
        operation: edit.operation,
        existedBefore: Boolean(before?.existed),
        existsAfter: afterExists && edit.operation !== 'delete',
        beforeHash: hashKey(before?.content || ''),
        afterHash: hashKey(afterContent || ''),
      });
      edit.status = 'applied';
    }
    this.recordArtifact('apply', proposal.summary, `${edits.length} file change(s) applied.`, {
      proposalId: proposal.id,
      files: edits.map((edit) => ({ filePath: edit.filePath, operation: edit.operation })),
      beforeAfter,
      checkpointId: checkpoint.id,
    });
    proposal.status = proposal.edits.every((edit) => edit.status === 'applied')
      ? 'applied'
      : 'partially_applied';
    await this.saveState();
    if (!options.skipRefresh) {
      await this.refresh();
    }
  }

  async rejectProposal(proposalId, filePath) {
    const proposal = this.state.proposals.find((item) => item.id === proposalId);
    if (!proposal) return;
    for (const edit of proposal.edits) {
      if (!filePath || edit.filePath === filePath) {
        edit.status = 'rejected';
      }
    }
    for (const command of proposal.commands || []) {
      if (!filePath) command.status = 'rejected';
    }
    proposal.status = proposal.edits.every((edit) => edit.status === 'rejected')
      ? 'rejected'
      : 'partially_rejected';
    await this.saveState();
    await this.refresh();
  }

  async undoProposal(proposalId) {
    const proposal = this.state.proposals.find((item) => item.id === proposalId);
    if (!proposal?.lastCheckpointId) {
      throw new Error('No checkpoint is attached to this proposal yet.');
    }
    await this.restoreCheckpoint(proposal.lastCheckpointId);
  }

  async restoreCheckpoint(checkpointId) {
    const checkpoint = this.state.checkpoints.find((item) => item.id === checkpointId);
    if (!checkpoint) throw new Error('Checkpoint was not found.');
    const approval = await vscode.window.showWarningMessage(
      `Restore checkpoint "${checkpoint.label}"? Current matching files will be replaced.`,
      { modal: true },
      'Restore',
    );
    if (approval !== 'Restore') return;
    for (const file of checkpoint.files) {
      const absolute = this.absoluteFor(file.filePath);
      if (file.existed) {
        await fs.mkdir(path.dirname(absolute), { recursive: true });
        await fs.writeFile(absolute, file.content, 'utf8');
      } else if (fsSync.existsSync(absolute)) {
        await fs.unlink(absolute);
      }
    }
    await this.saveState();
    await this.refresh();
  }

  async openDiff(proposalId, filePath) {
    const proposal = this.state.proposals.find((item) => item.id === proposalId);
    const edit = proposal?.edits.find((item) => item.filePath === filePath);
    if (!edit) return;
    const absolute = this.absoluteFor(edit.filePath);
    const originalContent = fsSync.existsSync(absolute) ? await fs.readFile(absolute, 'utf8') : '';
    const original = await vscode.workspace.openTextDocument({
      content: originalContent,
      language: languageFor(edit.filePath),
    });
    const proposed = await vscode.workspace.openTextDocument({
      content: edit.operation === 'delete' ? '' : edit.content,
      language: languageFor(edit.filePath),
    });
    await vscode.commands.executeCommand(
      'vscode.diff',
      original.uri,
      proposed.uri,
      `${edit.filePath}: Current vs Neura`,
    );
  }

  buildLineHunks(originalContent, proposedContent, contextLines = 2) {
    const original = String(originalContent || '').split(/\r?\n/);
    const proposed = String(proposedContent || '').split(/\r?\n/);
    const max = Math.max(original.length, proposed.length);
    const changed = [];
    for (let index = 0; index < max; index += 1) {
      if ((original[index] ?? '') !== (proposed[index] ?? '')) changed.push(index);
    }
    if (!changed.length) return [];
    const ranges = [];
    for (const line of changed) {
      const start = Math.max(0, line - contextLines);
      const end = Math.min(max - 1, line + contextLines);
      const last = ranges[ranges.length - 1];
      if (last && start <= last.end + 1) last.end = Math.max(last.end, end);
      else ranges.push({ start, end });
    }
    return ranges.map((range, index) => {
      const originalLines = original.slice(range.start, Math.min(range.end + 1, original.length));
      const proposedLines = proposed.slice(range.start, Math.min(range.end + 1, proposed.length));
      const preview = proposedLines.find((line, offset) => line !== (originalLines[offset] ?? '')) || proposedLines[0] || originalLines[0] || '';
      return {
        id: `hunk-${index + 1}`,
        index,
        start: range.start,
        end: range.end,
        originalLines,
        proposedLines,
        title: `Lines ${range.start + 1}-${range.end + 1}: ${preview.slice(0, 80)}`,
      };
    });
  }

  async selectCurrentFileHunk(title = 'Select Neura hunk') {
    const filePath = await this.activeEditorFile();
    if (!filePath) throw new Error('Open a workspace file with a pending Neura edit first.');
    const proposal = this.pendingProposalForFile(filePath);
    const edit = proposal?.edits?.find((item) => item.filePath === filePath && item.status === 'proposed');
    if (!proposal || !edit) throw new Error('No pending Neura edit was found for the active file.');
    if (edit.operation !== 'update') throw new Error('Partial hunk review is only available for update edits. Use Accept/Reject for create or delete edits.');
    const absolute = this.absoluteFor(filePath);
    const currentContent = fsSync.existsSync(absolute) ? await fs.readFile(absolute, 'utf8') : '';
    const hunks = this.buildLineHunks(currentContent, edit.content);
    if (!hunks.length) throw new Error('No remaining hunks were found for this file.');
    const picked = await vscode.window.showQuickPick(
      hunks.map((hunk) => ({
        label: hunk.title,
        description: `${hunk.proposedLines.length} proposed line(s)`,
        detail: hunk.proposedLines.join('\n').slice(0, 500),
        hunk,
      })),
      { title, matchOnDescription: true, matchOnDetail: true },
    );
    if (!picked) return null;
    return { proposal, edit, filePath, currentContent, hunk: picked.hunk };
  }

  spliceLines(content, start, end, replacementLines) {
    const lines = String(content || '').split(/\r?\n/);
    const before = lines.slice(0, start);
    const after = lines.slice(Math.min(end + 1, lines.length));
    return [...before, ...replacementLines, ...after].join('\n');
  }

  async acceptCurrentFileHunk() {
    const selection = await this.selectCurrentFileHunk('Accept Neura hunk');
    if (!selection) return;
    const { proposal, edit, filePath, currentContent, hunk } = selection;
    const checkpoint = await this.createCheckpoint(`Before hunk ${filePath}:${hunk.start + 1}`, [edit]);
    proposal.lastCheckpointId = checkpoint.id;
    await fs.writeFile(this.absoluteFor(filePath), this.spliceLines(currentContent, hunk.start, hunk.end, hunk.proposedLines), 'utf8');
    edit.acceptedHunks = [...(edit.acceptedHunks || []), { id: hunk.id, start: hunk.start, end: hunk.end, acceptedAt: nowIso() }].slice(-40);
    const updatedContent = await fs.readFile(this.absoluteFor(filePath), 'utf8');
    if (!this.buildLineHunks(updatedContent, edit.content).length) {
      edit.status = 'applied';
    }
    proposal.status = proposal.edits.every((item) => item.status === 'applied') ? 'applied' : 'partially_applied';
    this.recordArtifact('inline-hunk', `Accepted hunk: ${filePath}`, `Accepted lines ${hunk.start + 1}-${hunk.end + 1}.`, {
      proposalId: proposal.id,
      filePath,
      hunk: { start: hunk.start + 1, end: hunk.end + 1 },
    });
    await this.saveState();
    await this.refresh();
  }

  async rejectCurrentFileHunk() {
    const selection = await this.selectCurrentFileHunk('Reject Neura hunk');
    if (!selection) return;
    const { proposal, edit, filePath, hunk } = selection;
    edit.content = this.spliceLines(edit.content, hunk.start, hunk.end, hunk.originalLines);
    edit.rejectedHunks = [...(edit.rejectedHunks || []), { id: hunk.id, start: hunk.start, end: hunk.end, rejectedAt: nowIso() }].slice(-40);
    const absolute = this.absoluteFor(filePath);
    const currentContent = fsSync.existsSync(absolute) ? await fs.readFile(absolute, 'utf8') : '';
    if (!this.buildLineHunks(currentContent, edit.content).length) {
      edit.status = 'rejected';
    }
    proposal.status = proposal.edits.every((item) => item.status === 'rejected') ? 'rejected' : 'partially_rejected';
    this.recordArtifact('inline-hunk', `Rejected hunk: ${filePath}`, `Rejected lines ${hunk.start + 1}-${hunk.end + 1}.`, {
      proposalId: proposal.id,
      filePath,
      hunk: { start: hunk.start + 1, end: hunk.end + 1 },
    });
    await this.saveState();
    await this.refresh();
  }

  async reviewCurrentFileProposal() {
    let selection;
    try {
      selection = await this.currentFilePendingEdit();
    } catch {
      await vscode.window.showInformationMessage('No pending Neura edit was found for the active file.');
      return;
    }
    const { proposal, filePath } = selection;
    await this.openDiff(proposal.id, filePath);
  }

  async acceptCurrentFileProposal() {
    const { proposal, filePath } = await this.currentFilePendingEdit();
    await this.applyProposal(proposal.id, filePath);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(this.absoluteFor(filePath)));
    await vscode.window.showTextDocument(document, { preview: false });
  }

  async rejectCurrentFileProposal() {
    const { proposal, filePath } = await this.currentFilePendingEdit();
    await this.rejectProposal(proposal.id, filePath);
    await vscode.window.showInformationMessage(`Rejected Neura edit for ${filePath}.`);
  }

  async reapplyCurrentFileProposal() {
    const { proposal, edit, filePath } = await this.currentFilePendingEdit();
    const checkpoint = await this.createCheckpoint(`Before reapply ${filePath}`, [edit]);
    proposal.lastCheckpointId = checkpoint.id;
    const absolute = this.absoluteFor(filePath);
    if (edit.operation === 'delete') {
      if (fsSync.existsSync(absolute)) await fs.unlink(absolute);
    } else {
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, edit.content, 'utf8');
    }
    edit.status = 'applied';
    proposal.status = proposal.edits.every((item) => item.status === 'applied') ? 'applied' : 'partially_applied';
    this.recordArtifact('editor-native-edit', `Reapplied file: ${filePath}`, `Reapplied Neura proposal from the editor for ${filePath}.`, {
      proposalId: proposal.id,
      filePath,
      checkpointId: checkpoint.id,
    });
    await this.saveState();
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(absolute));
    await vscode.window.showTextDocument(document, { preview: false });
    await this.refresh();
  }

  async openNextPendingEdit() {
    const proposal = (this.state.proposals || []).find((item) => (item.edits || []).some((edit) => edit.status === 'proposed'));
    const edit = proposal?.edits?.find((item) => item.status === 'proposed');
    if (!proposal || !edit) {
      await vscode.window.showInformationMessage('No pending Neura edits are waiting.');
      return;
    }
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(this.absoluteFor(edit.filePath)));
    await vscode.window.showTextDocument(document, { preview: false });
    await this.openDiff(proposal.id, edit.filePath);
  }

  async applyAndRunProposal(proposalId) {
    const proposal = this.state.proposals.find((item) => item.id === proposalId);
    if (!proposal) throw new Error('Change proposal was not found.');
    const pendingEdits = (proposal.edits || []).filter((edit) => edit.status === 'proposed');
    if (pendingEdits.length) {
      await this.applyProposal(proposal.id, undefined, { skipRefresh: true });
    }
    const command =
      (proposal.commands || []).find((item) => /\b(dev|serve|start|preview|live-server|vite|next dev|npm run)\b/i.test(item.command || '')) ||
      (proposal.commands || [])[0];
    if (command) {
      await this.runCommand(proposal.id, command.id, command.command);
    } else if (proposal.preview?.url) {
      await this.openPreview(proposal.id);
    } else {
      await vscode.window.showInformationMessage('Applied the proposal. No run command was included.');
    }
    await this.refresh();
  }

  async runCommand(proposalId, commandId, commandText, options = {}) {
    this.ensureWorkspace();
    const originalCommand = String(commandText || '').trim();
    const command = this.normalizeCommandForPlatform(originalCommand);
    if (!command) return;
    const policy = this.evaluatePolicy('command', command, {
      proposalId,
      commandId,
      auto: Boolean(options.skipConfirmation && this.canAutoRunCommands()),
    });
    if (policy.decision === 'deny') {
      throw new Error(`Neura policy denied command: ${policy.reason}`);
    }
    if (policy.decision === 'ask' && options.skipConfirmation) {
      throw new Error(`Neura policy requires approval before running: ${command}`);
    }
    if (!options.skipConfirmation) {
      const approval = await vscode.window.showWarningMessage(
        `Run this command in ${this.rootPath}?\n\n${command}\n\nPolicy: ${policy.reason}`,
        { modal: true },
        'Run',
      );
      if (approval !== 'Run') return;
    }

    const card = {
      id: id('terminal'),
      proposalId,
      commandId,
      command,
      originalCommand: originalCommand !== command ? originalCommand : '',
      status: 'running',
      stdout: '',
      stderr: '',
      exitCode: null,
      fixAttempts: 0,
      fixHistory: [],
      createdAt: nowIso(),
    };
    this.state.terminalCards.unshift(card);
    await this.saveState();
    this.renderIfVisible();

    const shell = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : process.env.SHELL || 'sh';
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-lc', command];
    const child = spawn(shell, args, { cwd: this.rootPath, windowsHide: true });
    const completion = new Promise((resolve) => {
      child.on('close', () => resolve(card));
      child.on('error', () => resolve(card));
    });
    child.stdout.on('data', (chunk) => {
      card.stdout += chunk.toString();
      this.renderIfVisible();
    });
    child.stderr.on('data', (chunk) => {
      card.stderr += chunk.toString();
      this.renderIfVisible();
    });
    child.on('error', async (error) => {
      card.status = 'failed';
      card.stderr += error.message;
      await this.saveState();
      this.renderIfVisible();
    });
    child.on('close', async (code) => {
      card.status = code === 0 ? 'passed' : 'failed';
      card.exitCode = code;
      const proposal = this.state.proposals.find((item) => item.id === proposalId);
      const commandCard = proposal?.commands?.find((item) => item.id === commandId);
      if (commandCard) {
        commandCard.status = card.status;
        commandCard.exitCode = code;
      }
      this.recordArtifact('terminal', command, `Command ${card.status} with exit code ${code}.`, {
        terminalId: card.id,
        proposalId,
        commandId,
        originalCommand: card.originalCommand || '',
        exitCode: code,
        stdout: card.stdout.slice(-3000),
        stderr: card.stderr.slice(-3000),
      });
      await this.saveState();
      this.renderIfVisible();
    });
    return options.waitForExit ? completion : card;
  }

  async fixTerminalFailure(cardId) {
    const card = (this.state.terminalCards || []).find((item) => item.id === cardId);
    if (!card) throw new Error('Terminal result was not found.');
    const profile = await this.discoverVerificationProfile(card.command).catch(() => ({ commands: [], diagnostics: [] }));
    const diagnostics = profile.diagnostics || [];
    const semanticHits = await this.semanticSearch(`${card.command}\n${card.stderr || card.stdout || ''}`, 10).catch(() => []);
    const output = `${card.stdout || ''}${card.stderr ? `\n${card.stderr}` : ''}`.slice(-6000);
    await this.sendPrompt(
      [
        'Fix the failed verification command below. Inspect diagnostics and relevant files, propose code edits, and include the most targeted next verification command.',
        `Command: ${card.command}`,
        `Exit code: ${card.exitCode ?? 'unknown'}`,
        `Discovered verification commands:\n${(profile.commands || []).map((item) => `- [${item.kind}] ${item.command} — ${item.reason}`).join('\n') || '(none)'}`,
        `Likely affected files:\n${[...(profile.failedFiles || []), ...(profile.diagnosticFiles || [])].slice(0, 20).join('\n') || '(none)'}`,
        `Changed files:\n${(profile.changedFiles || []).slice(0, 30).join('\n') || '(none)'}`,
        `Diagnostics:\n${diagnostics.slice(0, 40).map((item) => `${item.filePath}:${item.line}:${item.column} ${item.severity} ${item.message}`).join('\n') || '(none)'}`,
        `Semantic hits:\n${semanticHits.map((hit) => `${hit.kind} ${hit.filePath}${hit.line ? `:${hit.line}` : ''} score=${hit.score ?? ''}`).join('\n') || '(none)'}`,
        `Output:\n${output || '(no output)'}`,
      ].join('\n\n'),
      'agent',
    );
  }

  async fixWorkspaceProblems() {
    const diagnostics = await this.workspaceDiagnostics().catch(() => []);
    if (!diagnostics.length) {
      await vscode.window.showInformationMessage('No workspace Problems diagnostics are currently reported.');
      return;
    }
    const profile = await this.discoverVerificationProfile('').catch(() => ({ commands: [], diagnostics, changedFiles: [] }));
    const diagnosticText = diagnostics
      .slice(0, 60)
      .map((item) => `${item.filePath}:${item.line}:${item.column} ${item.severity} ${item.source ? `[${item.source}] ` : ''}${item.message}`)
      .join('\n');
    const semanticHits = await this.semanticSearch(diagnosticText, 12).catch(() => []);
    await this.sendPrompt(
      [
        'Fix the current VS Code Problems diagnostics. Use targeted file inspection, propose minimal code edits, and include the most relevant lint/typecheck/test command to verify.',
        `Diagnostics:\n${diagnosticText}`,
        `Changed files:\n${(profile.changedFiles || []).slice(0, 30).join('\n') || '(none)'}`,
        `Discovered verification commands:\n${(profile.commands || []).map((item) => `- [${item.kind}] ${item.command} — ${item.reason}`).join('\n') || '(none)'}`,
        `Semantic hits:\n${semanticHits.map((hit) => `${hit.kind} ${hit.filePath}${hit.line ? `:${hit.line}` : ''} score=${hit.score ?? ''}`).join('\n') || '(none)'}`,
      ].join('\n\n'),
      'agent',
    );
  }

  terminalSignature(card) {
    return hashKey([
      card.command || '',
      card.exitCode ?? '',
      String(card.stdout || '').slice(-2000),
      String(card.stderr || '').slice(-4000),
    ].join('\n'));
  }

  proposalSignature(proposal) {
    return hashKey(JSON.stringify({
      edits: (proposal?.edits || []).map((edit) => ({
        operation: edit.operation,
        filePath: edit.filePath,
        contentHash: hashKey(edit.content || ''),
      })),
      commands: (proposal?.commands || []).map((command) => command.command),
    }));
  }

  async executeAutoFixAttempt(card, attempt) {
    const beforeSignature = this.terminalSignature(card);
    const beforeProposalCount = (this.state.proposals || []).length;
    const verificationProfile = await this.discoverVerificationProfile(card.command).catch(() => ({ commands: [], diagnostics: [] }));
    const diagnostics = verificationProfile.diagnostics || [];
    const beforeDiagnosticErrors = diagnostics.filter((item) => item.severity === 'error').length;
    const startedAt = nowIso();
    await this.fixTerminalFailure(card.id);
    const latestProposal = (this.state.proposals || [])[0];
    const proposalCreated = (this.state.proposals || []).length > beforeProposalCount;
    const proposalSignature = this.proposalSignature(latestProposal);
    const attemptRecord = {
      attempt,
      startedAt,
      completedAt: '',
      status: 'proposed',
      stopReason: '',
      beforeSignature,
      proposalId: latestProposal?.id || '',
      proposalSignature,
      diagnostics: diagnostics.slice(0, 25),
      verificationProfile: {
        commands: (verificationProfile.commands || []).slice(0, 8),
        diagnosticFiles: verificationProfile.diagnosticFiles || [],
        failedFiles: verificationProfile.failedFiles || [],
        changedFiles: verificationProfile.changedFiles || [],
      },
      beforeDiagnosticErrors,
      afterDiagnosticErrors: null,
      appliedFiles: [],
      command: '',
      resultTerminalId: '',
      resultSignature: '',
      exitCode: null,
    };
    card.fixHistory = [...(card.fixHistory || []), attemptRecord].slice(-10);

    if (!latestProposal || !proposalCreated) {
      attemptRecord.status = 'stopped';
      attemptRecord.stopReason = 'No new repair proposal was produced.';
      attemptRecord.completedAt = nowIso();
      return attemptRecord;
    }

    if (this.canAutoApplyEdits() && (latestProposal.edits || []).some((edit) => edit.status === 'proposed')) {
      await this.applyProposal(latestProposal.id, undefined, { skipConfirmation: true, skipRefresh: true });
      attemptRecord.appliedFiles = (latestProposal.edits || [])
        .filter((edit) => edit.status === 'applied')
        .map((edit) => edit.filePath);
    }

    const rankedCommands = this.rankVerificationCommands(verificationProfile, card, latestProposal);
    const command =
      (latestProposal.commands || []).find((item) => item.command === card.command) ||
      (latestProposal.commands || []).find((item) => rankedCommands.some((ranked) => ranked.command === item.command)) ||
      rankedCommands[0] ||
      (latestProposal.commands || [])[0] ||
      { id: undefined, command: card.command };
    attemptRecord.command = command.command;

    if (!this.canAutoRunCommands()) {
      attemptRecord.status = 'waiting';
      attemptRecord.stopReason = 'Permission mode does not allow automatic terminal reruns.';
      attemptRecord.completedAt = nowIso();
      return attemptRecord;
    }

    const rerun = await this.runCommand(latestProposal.id, command.id, command.command, {
      skipConfirmation: true,
      waitForExit: true,
    });
    attemptRecord.resultTerminalId = rerun?.id || '';
    attemptRecord.resultSignature = this.terminalSignature(rerun || {});
    attemptRecord.exitCode = rerun?.exitCode ?? null;
    attemptRecord.status = rerun?.status === 'passed' ? 'passed' : 'failed';
    const afterDiagnostics = await this.workspaceDiagnostics().catch(() => []);
    attemptRecord.afterDiagnosticErrors = afterDiagnostics.filter((item) => item.severity === 'error').length;
    if (attemptRecord.resultSignature === beforeSignature && rerun?.status !== 'passed') {
      attemptRecord.stopReason = 'Verification output did not change after repair.';
      attemptRecord.status = 'stopped';
    } else if (
      rerun?.status !== 'passed' &&
      attemptRecord.afterDiagnosticErrors !== null &&
      attemptRecord.afterDiagnosticErrors > beforeDiagnosticErrors
    ) {
      attemptRecord.stopReason = 'Diagnostics got worse after repair.';
      attemptRecord.status = 'stopped';
    }
    attemptRecord.completedAt = nowIso();
    return attemptRecord;
  }

  async autoFixTerminalFailure(cardId, maxAttempts = 3) {
    const card = (this.state.terminalCards || []).find((item) => item.id === cardId);
    if (!card) throw new Error('Terminal result was not found.');
    const approval = await vscode.window.showWarningMessage(
      `Let Neura attempt up to ${maxAttempts} fix cycle(s) for this failed command?`,
      { modal: true },
      'Auto-fix',
    );
    if (approval !== 'Auto-fix') return;
    card.fixHistory = card.fixHistory || [];
    const seenProposalSignatures = new Set(card.fixHistory.map((item) => item.proposalSignature).filter(Boolean));
    let currentCard = card;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (currentCard.status === 'passed') break;
      currentCard.fixHistory = card.fixHistory;
      currentCard.fixAttempts = attempt;
      card.fixAttempts = attempt;
      const attemptRecord = await this.executeAutoFixAttempt(currentCard, attempt);
      card.fixHistory = currentCard.fixHistory || card.fixHistory;
      if (attemptRecord.proposalSignature) {
        if (seenProposalSignatures.has(attemptRecord.proposalSignature)) {
          attemptRecord.status = 'stopped';
          attemptRecord.stopReason = 'Repair proposal repeated a previous attempt.';
          break;
        }
        seenProposalSignatures.add(attemptRecord.proposalSignature);
      }
      if (attemptRecord.status === 'passed') break;
      if (attemptRecord.status === 'waiting' || attemptRecord.status === 'stopped') break;
      const rerunCard = attemptRecord.resultTerminalId
        ? (this.state.terminalCards || []).find((item) => item.id === attemptRecord.resultTerminalId)
        : null;
      if (rerunCard?.status === 'failed') {
        rerunCard.fixHistory = card.fixHistory;
        currentCard = rerunCard;
      }
    }
    this.recordArtifact('terminal-autofix', `Auto-fix ${card.command}`, `${card.fixAttempts} attempt(s) completed.`, {
      terminalId: card.id,
      history: card.fixHistory,
    });
    await this.saveState();
    this.renderIfVisible();
  }

  async openPreview(proposalId) {
    const proposal = this.state.proposals.find((item) => item.id === proposalId);
    const url = proposal?.preview?.url || this.state.preview?.url;
    if (!url) {
      await vscode.window.showInformationMessage('No preview URL is available yet. Run the proposed dev server command first.');
      return;
    }
    await this.enforcePolicy('browser_url', url);
    try {
      await vscode.commands.executeCommand('simpleBrowser.show', url);
    } catch {
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }
  }

  async browserVerify(url) {
    if (!url) {
      return { ok: false, summary: 'No preview URL is available.' };
    }
    await this.enforcePolicy('browser_url', url, { skipPrompt: false });
    const browser = findBrowserExecutable();
    if (!browser) {
      return {
        ok: false,
        summary: 'No Chrome or Edge executable was found for screenshot verification.',
        url,
      };
    }
    const screenshotDir = path.join(this.neuraDir || this.rootPath, 'preview-screenshots');
    await fs.mkdir(screenshotDir, { recursive: true });
    const screenshotPath = path.join(screenshotDir, `preview-${Date.now()}.png`);
    const screenshotArgs = [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--window-size=1366,900',
      `--screenshot=${screenshotPath}`,
      url,
    ];
    await execFileAsync(browser, screenshotArgs, this.rootPath);
    let dom = '';
    try {
      dom = await execFileAsync(
        browser,
        ['--headless=new', '--disable-gpu', '--virtual-time-budget=5000', '--dump-dom', url],
        this.rootPath,
      );
    } catch (error) {
      logNeura('Browser DOM verification failed', { url, error: errorMessageFor(error) });
    }
    const stat = await fs.stat(screenshotPath);
    const title = dom.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() || '';
    const bodyText = dom
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1200);
    const domSignals = {
      hasRoot: /id=["']root["']|id=["']app["']|<main\b|<body\b/i.test(dom),
      hasButton: /<button\b/i.test(dom),
      hasInput: /<input\b|<textarea\b/i.test(dom),
      scriptCount: (dom.match(/<script\b/gi) || []).length,
      styleCount: (dom.match(/<style\b|rel=["']stylesheet["']/gi) || []).length,
    };
    return {
      ok: stat.size > 0 && Boolean(dom ? bodyText || title || domSignals.hasRoot : true),
      summary: stat.size > 0
        ? `Browser screenshot captured (${Math.round(stat.size / 1024)} KB).${title ? ` Title: ${title}.` : ''}`
        : 'Browser screenshot was empty.',
      url,
      browser,
      screenshotPath,
      bytes: stat.size,
      title,
      bodyText,
      domSignals,
    };
  }

  async waitForJsonEndpoint(url, timeoutMs = 8000) {
    const started = Date.now();
    let lastError = null;
    while (Date.now() - started < timeoutMs) {
      try {
        const response = await fetch(url);
        if (response.ok) return await response.json();
        lastError = new Error(`HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw lastError || new Error(`Timed out waiting for ${url}`);
  }

  async connectCdp(webSocketDebuggerUrl) {
    if (typeof WebSocket !== 'function') {
      throw new Error('This Neura IDE runtime does not expose WebSocket, so DevTools browser automation is unavailable.');
    }
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(webSocketDebuggerUrl);
      const pending = new Map();
      const listeners = new Set();
      let nextId = 1;
      const timeout = setTimeout(() => reject(new Error('Timed out connecting to Chrome DevTools.')), 8000);
      socket.addEventListener('open', () => {
        clearTimeout(timeout);
        resolve({
          send(method, params = {}) {
            return new Promise((sendResolve, sendReject) => {
              const messageId = nextId++;
              pending.set(messageId, { resolve: sendResolve, reject: sendReject, method });
              socket.send(JSON.stringify({ id: messageId, method, params }));
              setTimeout(() => {
                if (pending.has(messageId)) {
                  pending.delete(messageId);
                  sendReject(new Error(`CDP timeout: ${method}`));
                }
              }, 12000);
            });
          },
          onEvent(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
          close() {
            try {
              socket.close();
            } catch {
              // ignore close races
            }
          },
        });
      });
      socket.addEventListener('message', (event) => {
        let payload;
        try {
          payload = JSON.parse(String(event.data || ''));
        } catch {
          return;
        }
        if (payload.id && pending.has(payload.id)) {
          const entry = pending.get(payload.id);
          pending.delete(payload.id);
          if (payload.error) entry.reject(new Error(payload.error.message || entry.method));
          else entry.resolve(payload.result);
          return;
        }
        if (payload.method) {
          for (const listener of listeners) listener(payload);
        }
      });
      socket.addEventListener('error', () => reject(new Error('Chrome DevTools WebSocket failed.')));
    });
  }

  normalizeBrowserAgentSteps(steps = []) {
    const normalized = Array.isArray(steps) ? steps : [];
    const safeSteps = normalized
      .slice(0, 12)
      .map((step) => ({
        action: String(step.action || step.type || 'capture').toLowerCase(),
        selector: String(step.selector || '').slice(0, 240),
        text: String(step.text || step.value || '').slice(0, 1000),
        x: Number(step.x || 0),
        y: Number(step.y || 0),
        ms: Math.min(Math.max(Number(step.ms || step.waitMs || 800), 0), 8000),
        label: String(step.label || '').slice(0, 80),
      }))
      .filter((step) => ['capture', 'click', 'type', 'scroll', 'wait'].includes(step.action));
    return safeSteps.length ? safeSteps : [
      { action: 'capture', label: 'initial', selector: '', text: '', x: 0, y: 0, ms: 0 },
      { action: 'scroll', label: 'scroll-smoke', selector: '', text: '', x: 0, y: 700, ms: 600 },
      { action: 'capture', label: 'after-scroll', selector: '', text: '', x: 0, y: 0, ms: 0 },
    ];
  }

  async cdpCaptureSnapshot(cdp, outputDir, label) {
    const safeLabel = String(label || 'capture').replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 60);
    const evaluated = await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      awaitPromise: true,
      expression: `(() => {
        const visibleText = document.body ? document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 4000) : '';
        const pick = (selector) => Array.from(document.querySelectorAll(selector)).slice(0, 30).map((el) => ({
          selector,
          text: (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').replace(/\\s+/g, ' ').trim().slice(0, 160),
          id: el.id || '',
          className: String(el.className || '').slice(0, 120),
          disabled: Boolean(el.disabled),
        }));
        return {
          url: location.href,
          title: document.title,
          html: document.documentElement ? document.documentElement.outerHTML.slice(0, 120000) : '',
          text: visibleText,
          viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY, scrollHeight: document.documentElement.scrollHeight },
          controls: {
            buttons: pick('button,[role="button"],a'),
            inputs: pick('input,textarea,select,[contenteditable="true"]'),
            forms: pick('form'),
          },
        };
      })()`,
    });
    const snapshot = evaluated.result?.value || {};
    const screenshot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    const screenshotPath = path.join(outputDir, `${safeLabel}.png`);
    const domPath = path.join(outputDir, `${safeLabel}.html`);
    await fs.writeFile(screenshotPath, screenshot.data || '', 'base64');
    await fs.writeFile(domPath, snapshot.html || '', 'utf8');
    return {
      label: safeLabel,
      url: snapshot.url || '',
      title: snapshot.title || '',
      text: snapshot.text || '',
      viewport: snapshot.viewport || {},
      controls: snapshot.controls || {},
      screenshotPath,
      domPath,
    };
  }

  async runBrowserAgentStep(cdp, step) {
    if (step.action === 'wait') {
      await new Promise((resolve) => setTimeout(resolve, step.ms || 800));
      return { ok: true, summary: `Waited ${step.ms || 800}ms.` };
    }
    if (step.action === 'scroll') {
      await cdp.send('Runtime.evaluate', {
        awaitPromise: true,
        expression: `window.scrollBy(${Number(step.x || 0)}, ${Number(step.y || 0)}); new Promise((resolve) => setTimeout(resolve, ${step.ms || 300}))`,
      });
      return { ok: true, summary: `Scrolled by ${step.x || 0}, ${step.y || 0}.` };
    }
    if (step.action === 'click') {
      const result = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        awaitPromise: true,
        expression: `(() => {
          const selector = ${JSON.stringify(step.selector)};
          const el = document.querySelector(selector);
          if (!el) return { ok: false, summary: 'Selector not found: ' + selector };
          el.scrollIntoView({ block: 'center', inline: 'center' });
          el.click();
          return { ok: true, summary: 'Clicked ' + selector };
        })()`,
      });
      await new Promise((resolve) => setTimeout(resolve, step.ms || 700));
      return result.result?.value || { ok: false, summary: `Click failed for ${step.selector}.` };
    }
    if (step.action === 'type') {
      const result = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        awaitPromise: true,
        expression: `(() => {
          const selector = ${JSON.stringify(step.selector)};
          const el = document.querySelector(selector);
          if (!el) return { ok: false, summary: 'Selector not found: ' + selector };
          el.scrollIntoView({ block: 'center', inline: 'center' });
          el.focus();
          if ('value' in el) el.value = ${JSON.stringify(step.text)};
          else el.textContent = ${JSON.stringify(step.text)};
          el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(step.text)} }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true, summary: 'Typed into ' + selector };
        })()`,
      });
      await new Promise((resolve) => setTimeout(resolve, step.ms || 500));
      return result.result?.value || { ok: false, summary: `Type failed for ${step.selector}.` };
    }
    return { ok: true, summary: 'Captured browser state.' };
  }

  async browserAgentInteract({ url, steps = [], label = 'browser-agent', missionId = '', agentId = '' } = {}) {
    if (!url) return { ok: false, summary: 'No preview URL is available for the browser agent.' };
    await this.enforcePolicy('browser_url', url, { missionId, agentId });
    const browser = findBrowserExecutable();
    if (!browser) {
      return { ok: false, summary: 'No Chrome or Edge executable was found for browser agent automation.', url };
    }
    const stamp = `${Date.now()}-${id('browser').replace(/[^a-zA-Z0-9_.-]+/g, '-')}`;
    const outputDir = path.join(this.neuraDir || this.rootPath, 'browser-agent-runs', stamp);
    const profileDir = path.join(outputDir, 'profile');
    await fs.mkdir(profileDir, { recursive: true });
    const port = 45000 + Math.floor(Math.random() * 10000);
    const consoleEvents = [];
    const stepRecords = [];
    let child = null;
    let cdp = null;
    try {
      child = spawn(browser, [
        '--headless=new',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=1366,900',
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profileDir}`,
        'about:blank',
      ], { cwd: this.rootPath, windowsHide: true, stdio: 'ignore' });
      const pages = await this.waitForJsonEndpoint(`http://127.0.0.1:${port}/json/list`, 10000);
      const page = Array.isArray(pages) ? pages.find((item) => item.type === 'page') || pages[0] : null;
      if (!page?.webSocketDebuggerUrl) throw new Error('Chrome DevTools page target was not available.');
      cdp = await this.connectCdp(page.webSocketDebuggerUrl);
      cdp.onEvent((event) => {
        if (event.method === 'Runtime.consoleAPICalled') {
          consoleEvents.push({
            type: event.params?.type || 'log',
            text: (event.params?.args || []).map((arg) => arg.value ?? arg.description ?? '').join(' ').slice(0, 1000),
            timestamp: nowIso(),
          });
        }
        if (event.method === 'Runtime.exceptionThrown') {
          consoleEvents.push({
            type: 'exception',
            text: event.params?.exceptionDetails?.text || event.params?.exceptionDetails?.exception?.description || 'Runtime exception',
            timestamp: nowIso(),
          });
        }
        if (event.method === 'Log.entryAdded') {
          consoleEvents.push({
            type: event.params?.entry?.level || 'log',
            text: event.params?.entry?.text || '',
            timestamp: nowIso(),
          });
        }
      });
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await cdp.send('Log.enable').catch(() => {});
      await cdp.send('Page.navigate', { url });
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const normalizedSteps = this.normalizeBrowserAgentSteps(steps);
      for (const [index, step] of normalizedSteps.entries()) {
        const actionResult = await this.runBrowserAgentStep(cdp, step);
        const capture = await this.cdpCaptureSnapshot(cdp, outputDir, `${String(index + 1).padStart(2, '0')}-${step.label || step.action}`);
        stepRecords.push({
          index: index + 1,
          action: step.action,
          selector: step.selector || '',
          result: actionResult,
          capture,
          at: nowIso(),
        });
      }
      const consoleErrors = consoleEvents.filter((event) => /error|exception|assert|severe/i.test(event.type) || /\b(error|exception|failed)\b/i.test(event.text));
      const latest = stepRecords[stepRecords.length - 1]?.capture || {};
      const recording = {
        id: stamp,
        label,
        url,
        missionId,
        agentId,
        browser,
        ok: stepRecords.length > 0 && consoleErrors.length === 0,
        summary: '',
        consoleEvents,
        consoleErrors,
        steps: stepRecords,
        createdAt: nowIso(),
      };
      recording.summary = `${stepRecords.length} browser step(s), ${consoleErrors.length} console/runtime issue(s), title "${latest.title || ''}".`;
      const recordingPath = path.join(outputDir, 'recording.json');
      await fs.writeFile(recordingPath, `${JSON.stringify(recording, null, 2)}\n`, 'utf8');
      const result = {
        ok: recording.ok,
        summary: recording.summary,
        url,
        browser,
        recordingPath,
        outputDir,
        screenshotPath: latest.screenshotPath || '',
        domPath: latest.domPath || '',
        title: latest.title || '',
        bodyText: latest.text || '',
        consoleEvents: consoleEvents.slice(-40),
        consoleErrors,
        steps: stepRecords.map((step) => ({
          action: step.action,
          selector: step.selector,
          ok: step.result?.ok !== false,
          summary: step.result?.summary || '',
          screenshotPath: step.capture?.screenshotPath || '',
          domPath: step.capture?.domPath || '',
        })),
      };
      this.recordArtifact('browser-agent', `Browser agent: ${label}`, result.summary, {
        runId: this.state.activeRunId,
        missionId,
        agentId,
        ...result,
      });
      return result;
    } catch (error) {
      const result = {
        ok: false,
        summary: `Browser agent failed: ${errorMessageFor(error)}`,
        url,
        browser,
        outputDir,
        consoleEvents,
      };
      this.recordArtifact('browser-agent', `Browser agent failed: ${label}`, result.summary, {
        runId: this.state.activeRunId,
        missionId,
        agentId,
        ...result,
      });
      return result;
    } finally {
      if (cdp) cdp.close();
      if (child) {
        try {
          child.kill();
        } catch {
          // ignore process shutdown races
        }
      }
    }
  }

  resolveBrowserAgentUrl(agent = {}) {
    const candidates = [
      agent.previewUrl,
      this.state.preview?.url,
      ...(this.state.proposals || []).map((proposal) => proposal.preview?.url),
      ...(this.state.artifacts || []).filter((artifact) => artifact.kind === 'preview').map((artifact) => artifact.data?.url),
      String(agent.task || '').match(/https?:\/\/[^\s)'"]+/i)?.[0],
      String(agent.missionTask || '').match(/https?:\/\/[^\s)'"]+/i)?.[0],
    ].filter(Boolean);
    return candidates[0] || '';
  }

  async executeBrowserBackgroundAgent(agent, controller) {
    const url = this.resolveBrowserAgentUrl(agent);
    if (!url) {
      const summary = 'Browser Agent is waiting for a preview URL. It will run after the app starts a local preview.';
      agent.browserEvidence = { ok: true, skipped: true, summary };
      agent.commands = [];
      agent.verification = [{
        command: 'browser_agent',
        status: 'skipped',
        output: summary,
        completedAt: nowIso(),
      }];
      agent.summary = summary;
      agent.status = 'completed';
      agent.updatedAt = nowIso();
      await this.persistBackgroundAgent(agent, 'browser-agent-waiting-for-preview', { summary });
      this.recordArtifact('browser-agent', `Browser agent waiting: ${agent.roleLabel || 'Browser Agent'}`, summary, {
        runId: this.state.activeRunId,
        missionId: agent.missionId || '',
        agentId: agent.id,
        skipped: true,
      });
      return;
    }
    await this.persistBackgroundAgent(agent, 'browser-agent-started', { url });
    const result = await this.browserAgentInteract({
      url,
      label: agent.roleLabel || 'Browser Agent',
      missionId: agent.missionId || '',
      agentId: agent.id,
    });
    if (controller.signal.aborted || agent.cancelRequested) throw new Error('Browser agent was cancelled.');
    agent.browserEvidence = result;
    agent.commands = [{ command: `browser_agent ${url}`, purpose: 'Interact with the local preview and capture proof.' }];
    agent.verification = [{
      command: `browser_agent ${url}`,
      status: result.ok ? 'passed' : 'failed',
      output: result.summary,
      screenshotPath: result.screenshotPath || '',
      recordingPath: result.recordingPath || '',
      completedAt: nowIso(),
    }];
    agent.summary = result.ok
      ? `Browser Agent passed: ${result.summary}`
      : `Browser Agent found issues: ${result.summary}`;
    agent.status = result.ok ? 'completed' : 'failed';
    agent.updatedAt = nowIso();
    await this.persistBackgroundAgent(agent, result.ok ? 'browser-agent-passed' : 'browser-agent-failed', {
      url,
      summary: result.summary,
      screenshotPath: result.screenshotPath || '',
      domPath: result.domPath || '',
      recordingPath: result.recordingPath || '',
      consoleErrors: result.consoleErrors || [],
    });
    if (!result.ok) {
      throw new Error(agent.summary);
    }
  }

  async verifyPreview(proposalId) {
    const proposal = this.state.proposals.find((item) => item.id === proposalId);
    const url = proposal?.preview?.url || this.state.preview?.url;
    if (!url) {
      await vscode.window.showInformationMessage('No preview URL is available yet.');
      return;
    }
    const startedAt = nowIso();
    try {
      const response = await fetch(url, { method: 'GET' });
      const contentType = response.headers.get('content-type') || '';
      const body = await response.text().catch(() => '');
      const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() || '';
      const summary = response.ok
        ? `Preview responded HTTP ${response.status}${title ? ` with title "${title}"` : ''}.`
        : `Preview returned HTTP ${response.status}.`;
      const verification = {
        url,
        ok: response.ok,
        status: response.status,
        contentType,
        title,
        checkedAt: startedAt,
      };
      const browserResult = await this.browserVerify(url).catch((error) => ({
        ok: false,
        summary: errorMessageFor(error),
      }));
      verification.browser = browserResult;
      if (proposal) proposal.previewVerification = verification;
      this.state.preview = { ...(this.state.preview || {}), url, verification };
      this.recordArtifact('preview', `Preview ${response.status}`, `${summary} ${browserResult.summary || ''}`.trim(), verification);
      await this.saveState();
      await vscode.window.showInformationMessage(summary);
    } catch (error) {
      const summary = `Preview verification failed: ${errorMessageFor(error)}`;
      const verification = { url, ok: false, error: errorMessageFor(error), checkedAt: startedAt };
      if (proposal) proposal.previewVerification = verification;
      this.state.preview = { ...(this.state.preview || {}), url, verification };
      this.recordArtifact('preview', 'Preview failed', summary, verification);
      await this.saveState();
      await vscode.window.showWarningMessage(summary);
    } finally {
      this.renderIfVisible();
    }
  }

  async openSettings() {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'neura provider');
  }

  async configureProviders() {
    this.activeTab = 'settings';
    this.renderIfVisible();
  }

  async saveProviderSettings(settings = {}) {
    const workspaceTarget = this.rootPath
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    const providerOrder = Array.isArray(settings.providerOrder)
      ? settings.providerOrder
      : String(settings.providerOrder || '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
    const normalizedOrder = providerOrder
      .map((item) => String(item || '').trim().toLowerCase())
      .filter((item, index, all) => ['openrouter', 'ollama', 'nim'].includes(item) && all.indexOf(item) === index);
    if (normalizedOrder.length) {
      await this.updateConfigOrLocal('neura.provider', 'order', normalizedOrder, workspaceTarget);
    }

    const updateProvider = async (section, values = {}) => {
      if (String(values.baseUrl || '').trim()) {
        await this.updateConfigOrLocal(section, 'baseUrl', String(values.baseUrl).trim(), workspaceTarget);
      }
      if (String(values.model || '').trim()) {
        await this.updateConfigOrLocal(section, 'model', String(values.model).trim(), workspaceTarget);
      }
      if (String(values.apiKey || '').trim()) {
        await this.context.secrets.store(secretConfigKey(section, 'apiKey'), String(values.apiKey).trim());
      }
    };

    await updateProvider('neura.openrouter', settings.openrouter || {});
    await updateProvider('neura.ollama', settings.ollama || {});
    await updateProvider('neura.nim', settings.nim || {});

    this.config = await this.readNimConfig();
    await this.saveState();
    this.activeTab = 'settings';
    await vscode.window.showInformationMessage('Neura AI provider settings saved.');
    this.renderIfVisible();
  }

  async toggleInlineCompletions() {
    const current = vscode.workspace.getConfiguration('neura').get('inlineCompletions', false);
    await vscode.workspace
      .getConfiguration('neura')
      .update('inlineCompletions', !current, vscode.ConfigurationTarget.Workspace);
    await vscode.window.showInformationMessage(`Neura inline completions ${!current ? 'enabled' : 'disabled'}.`);
    await this.refresh();
  }

  async addWorktree() {
    this.ensureWorkspace();
    await execFileAsync('git', ['rev-parse', '--show-toplevel'], this.rootPath);
    const branch = await vscode.window.showInputBox({
      title: 'Neura: Add Git Worktree',
      prompt: 'Branch name to check out or create.',
      ignoreFocusOut: true,
      validateInput: (value) => (String(value || '').trim() ? undefined : 'Enter a branch name.'),
    });
    if (!branch) return;
    const mode = await vscode.window.showQuickPick(
      [
        { label: 'Create new branch', value: 'new' },
        { label: 'Use existing branch', value: 'existing' },
      ],
      { title: 'Worktree branch mode', ignoreFocusOut: true },
    );
    if (!mode) return;
    const safeBranch = branch.trim().replace(/[\\/:*?"<>|]/g, '-');
    const defaultPath = path.join(path.dirname(this.rootPath), `${path.basename(this.rootPath)}-${safeBranch}`);
    const destination = await vscode.window.showInputBox({
      title: 'Neura: Worktree Folder',
      prompt: 'Folder path for the new worktree.',
      value: defaultPath,
      ignoreFocusOut: true,
      validateInput: (value) => (String(value || '').trim() ? undefined : 'Enter a destination folder.'),
    });
    if (!destination) return;
    const args =
      mode.value === 'new'
        ? ['worktree', 'add', '-b', branch.trim(), destination.trim()]
        : ['worktree', 'add', destination.trim(), branch.trim()];
    await execFileAsync('git', args, this.rootPath);
    const open = await vscode.window.showInformationMessage(
      `Created worktree at ${destination.trim()}.`,
      'Open',
    );
    if (open === 'Open') {
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(destination.trim()), true);
    }
  }

  async openWorktree(worktreePath) {
    if (!worktreePath) return;
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(worktreePath), true);
  }

  async removeWorktree(worktreePath) {
    this.ensureWorkspace();
    if (!worktreePath) return;
    const approval = await vscode.window.showWarningMessage(
      `Remove worktree?\n\n${worktreePath}`,
      { modal: true },
      'Remove',
    );
    if (approval !== 'Remove') return;
    await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], this.rootPath);
    await this.refresh();
  }

  slugForText(value, fallback = 'task', limit = 36) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, limit) || fallback;
  }

  async environmentSnapshot(cwd = this.rootPath) {
    const run = async (command, args = []) => execFileAsync(command, args, cwd).catch(() => '');
    return {
      cwd,
      gitHead: await run('git', ['rev-parse', '--short', 'HEAD']),
      gitBranch: await run('git', ['branch', '--show-current']),
      node: await run('node', ['--version']),
      npm: await run('npm', ['--version']),
      packageManager: fsSync.existsSync(path.join(cwd, 'pnpm-lock.yaml'))
        ? 'pnpm'
        : fsSync.existsSync(path.join(cwd, 'yarn.lock'))
          ? 'yarn'
          : 'npm',
      capturedAt: nowIso(),
    };
  }

  async createBackgroundAgentRecord(task, options = {}) {
    this.ensureWorkspace();
    await execFileAsync('git', ['rev-parse', '--show-toplevel'], this.rootPath);
    const role = swarmRoleById[options.roleId] || null;
    const slug = this.slugForText(`${role?.id || ''}-${task}`, 'task');
    const stamp = options.stamp || new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 12);
    const branchPrefix = options.missionId ? `neura-swarm/${this.slugForText(options.missionId, 'mission', 18)}` : 'neura-agent';
    const branch = `${branchPrefix}/${stamp}-${slug}`;
    const destination = path.join(path.dirname(this.rootPath), `${path.basename(this.rootPath)}-${stamp}-${slug}`);
    await execFileAsync('git', ['worktree', 'add', '-b', branch, destination], this.rootPath);
    const agent = {
      id: id('bg'),
      task: String(task || '').trim(),
      roleId: role?.id || 'agent',
      roleLabel: role?.label || 'Agent',
      squad: role?.squad || 'Solo',
      missionId: options.missionId || '',
      missionTask: options.missionTask || '',
      dependencies: options.dependencies || [],
      writes: role ? Boolean(role.writes) : true,
      ownership: Array.isArray(role?.ownership) ? role.ownership : [],
      branch,
      path: destination,
      baseBranch: await execFileAsync('git', ['branch', '--show-current'], this.rootPath).catch(() => ''),
      baseHead: await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], this.rootPath).catch(() => ''),
      lifecycle: 'worktree-created',
      environment: await this.environmentSnapshot(destination),
      status: 'ready',
      priority: options.priority || 0,
      followUps: [],
      events: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.state.backgroundAgents = [agent, ...(this.state.backgroundAgents || [])].slice(0, 80);
    await this.persistBackgroundAgent(agent, 'created', {
      roleId: agent.roleId,
      squad: agent.squad,
      missionId: agent.missionId,
    });
    this.recordArtifact('background-agent', agent.task, `Created isolated ${agent.roleLabel} worktree ${branch}.`, agent);
    this.recordArtifact('environment-snapshot', `Environment snapshot: ${agent.roleLabel}`, `Captured isolated worktree environment for ${branch}.`, {
      agentId: agent.id,
      missionId: agent.missionId,
      branch,
      path: destination,
      environment: agent.environment,
    });
    return agent;
  }

  autoSwarmRoleIdsFor(mode, prompt = '', context = {}) {
    const text = String(prompt || '').toLowerCase();
    const roles = new Set(['orchestrator', 'planner', 'context']);
    const isBuild = mode === 'builder' || mode === 'ship' || /\b(build|create|generate|scaffold|make|site|website|app|landing|dashboard)\b/i.test(text);
    const isFrontend = isBuild || /\b(ui|ux|frontend|react|vite|next|page|component|style|css|html|landing|form|pricing|faq|responsive)\b/i.test(text);
    const isBackend = /\b(api|backend|server|auth|login|database|db|postgres|supabase|stripe|webhook|endpoint|ipc)\b/i.test(text);
    const isData = /\b(schema|migration|database|db|localstorage|state|store|cache|persistence|persist)\b/i.test(text);
    if (isFrontend) roles.add('frontend');
    if (isBackend) roles.add('backend');
    if (isData) roles.add('data-state');
    if (isBuild || isBackend || isData || mode === 'agent') roles.add('integration');
    roles.add('qa');
    if (isFrontend || /\b(preview|browser|screenshot|dom|visual)\b/i.test(text)) roles.add('browser');
    roles.add('reviewer');
    roles.add('ship');
    if ((context.files || []).some((file) => /\.(test|spec)\./i.test(file.filePath))) roles.add('qa');
    return [...roles].filter((roleId) => swarmRoleById[roleId]);
  }

  async createSwarmMissionFromPrompt(task, mode = 'agent', context = {}, options = {}) {
    this.ensureWorkspace();
    const selectedRoles = this.autoSwarmRoleIdsFor(mode, task, context)
      .map((roleId) => swarmRoleById[roleId])
      .filter(Boolean);
    const selectedIds = new Set(selectedRoles.map((role) => role.id));
    const mission = {
      id: id('swarm'),
      task: String(task || '').trim(),
      source: options.source || 'composer-auto',
      sourceMode: mode,
      status: 'ready',
      roles: selectedRoles.map((role) => role.id),
      agentIds: [],
      events: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 12);
    for (const [index, role] of selectedRoles.entries()) {
      const dependencies = (role.dependencies || []).filter((dependency) => selectedIds.has(dependency));
      const agentTask = [
        `Mission: ${mission.task}`,
        `Role: ${role.label} (${role.squad} squad).`,
        `Responsibility: ${role.mission}`,
        `This is part of Neura's default Windsurf-style swarm workflow. Coordinate through artifacts and stay inside your ownership lane.`,
        role.ownership?.length ? `Ownership lane: ${role.ownership.join(', ')}` : 'Read/review role; do not write files unless this role explicitly allows writes.',
        dependencies.length ? `Wait for roles: ${dependencies.join(', ')}.` : '',
      ].filter(Boolean).join('\n');
      const agent = await this.createBackgroundAgentRecord(agentTask, {
        roleId: role.id,
        missionId: mission.id,
        missionTask: mission.task,
        dependencies,
        priority: index,
        stamp,
      });
      mission.agentIds.push(agent.id);
    }
    this.state.swarmMissions = [mission, ...(this.state.swarmMissions || [])].slice(0, 30);
    await this.persistSwarmMission(mission, 'auto-created', {
      roles: mission.roles,
      agentIds: mission.agentIds,
      mode,
    });
    await this.reviseSwarmPlan(mission, {
      event: 'auto-created',
      roles: mission.roles,
      agentIds: mission.agentIds,
      mode,
    }, 'auto-created');
    this.recordArtifact('swarm', `Auto swarm mission: ${mission.task}`, `Created ${mission.agentIds.length} role agent(s) for the Composer request.`, {
      missionId: mission.id,
      roles: mission.roles,
      agentIds: mission.agentIds,
      mode,
    });
    await this.saveState();
    return mission;
  }

  async runAutoSwarmForPrompt(prompt, mode, context, thinkingMessage) {
    const mission = await this.createSwarmMissionFromPrompt(prompt, mode, context);
    this.activeTab = 'agents';
    thinkingMessage.content = JSON.stringify({
      kind: 'thinking',
      status: 'running',
      title: 'Swarm running',
      text: `Created a ${mission.roles.length}-agent swarm: ${mission.roles.join(', ')}. Agents are working in isolated git worktrees and will produce merge-review proposals after completion.`,
    });
    this.state.messages.push({
      id: id('msg'),
      role: 'assistant',
      mode,
      content: `I created a Neura agent swarm for this task and started it. Open the Agents tab or Mission Control to watch role status, artifacts, logs, and merge reviews.`,
      referencedFiles: [],
      createdAt: nowIso(),
    });
    await this.saveState();
    this.renderIfVisible(true);
    const run = (async () => {
      try {
        await this.runSwarmMission(mission.id, { skipApproval: true });
        await this.reviewSwarmMission(mission.id).catch((error) => {
          logNeura('Auto swarm merge review skipped', {
            missionId: mission.id,
            error: errorMessageFor(error),
          });
        });
        thinkingMessage.content = JSON.stringify({
          kind: 'thinking',
          status: mission.status === 'completed' ? 'done' : 'stopped',
          title: mission.status === 'completed' ? 'Swarm complete' : 'Swarm stopped',
          text: mission.status === 'completed'
            ? 'The swarm completed. Review the generated merge proposals before applying changes.'
            : `The swarm finished with status ${mission.status}. ${mission.error || ''}`.trim(),
        });
        await this.saveState();
        this.renderIfVisible();
      } catch (error) {
        thinkingMessage.content = JSON.stringify({
          kind: 'thinking',
          status: 'failed',
          title: 'Swarm failed',
          text: errorMessageFor(error),
        });
        this.state.messages.push({
          id: id('msg'),
          role: 'assistant',
          mode,
          content: `The swarm stopped: ${errorMessageFor(error)}`,
          createdAt: nowIso(),
        });
        await this.saveState();
        this.renderIfVisible();
      }
    })();
    return { mission, run };
  }

  async createBackgroundAgent() {
    const task = await vscode.window.showInputBox({
      title: 'Neura: Background Agent Task',
      prompt: 'Describe the coding task to isolate in a new worktree.',
      ignoreFocusOut: true,
      validateInput: (value) => (String(value || '').trim() ? undefined : 'Enter a task.'),
    });
    if (!task) return;
    const agent = await this.createBackgroundAgentRecord(task, {});
    await this.saveState();
    const open = await vscode.window.showInformationMessage(
      `Created background agent worktree ${agent.branch}.`,
      'Open',
    );
    if (open === 'Open') {
      await this.openBackgroundAgent(agent.id);
    }
    await this.refresh();
  }

  async openBackgroundAgent(agentId) {
    const agent = (this.state.backgroundAgents || []).find((item) => item.id === agentId);
    if (!agent?.path) return;
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(agent.path), true);
  }

  async openBackgroundAgentLog(agentId) {
    const agent = (this.state.backgroundAgents || []).find((item) => item.id === agentId);
    if (!agent?.logFile || !fsSync.existsSync(agent.logFile)) return;
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(agent.logFile));
    await vscode.window.showTextDocument(document, { preview: false });
  }

  appendBackgroundAgentEvent(agent, event = 'updated', details = {}) {
    const entry = {
      at: nowIso(),
      event,
      status: agent.status,
      summary: agent.summary || '',
      error: agent.error || '',
      details,
    };
    agent.events = [entry, ...(agent.events || [])].slice(0, 80);
    agent.lastEvent = entry;
    return entry;
  }

  async persistBackgroundAgent(agent, event = 'updated', details = {}) {
    if (!this.backgroundAgentsDir || !agent?.id) return;
    await fs.mkdir(this.backgroundAgentsDir, { recursive: true });
    const filePath = path.join(this.backgroundAgentsDir, `${agent.id}.json`);
    const logPath = path.join(this.backgroundAgentsDir, `${agent.id}.log`);
    const logEntry = this.appendBackgroundAgentEvent(agent, event, details);
    await fs.writeFile(filePath, `${JSON.stringify(agent, null, 2)}\n`, 'utf8');
    await fs.appendFile(
      logPath,
      `${JSON.stringify(logEntry)}\n`,
      'utf8',
    );
    agent.stateFile = filePath;
    agent.logFile = logPath;
  }

  async restoreBackgroundAgentsFromDisk() {
    if (!this.backgroundAgentsDir || !fsSync.existsSync(this.backgroundAgentsDir)) return;
    const entries = await fs.readdir(this.backgroundAgentsDir).catch(() => []);
    const agents = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const agent = await safeReadJson(path.join(this.backgroundAgentsDir, entry));
      if (agent?.id && agent?.path) {
        agent.followUps = Array.isArray(agent.followUps) ? agent.followUps : [];
        agent.events = Array.isArray(agent.events) ? agent.events : [];
        agent.roleId = agent.roleId || 'agent';
        agent.roleLabel = agent.roleLabel || swarmRoleById[agent.roleId]?.label || 'Agent';
        agent.squad = agent.squad || swarmRoleById[agent.roleId]?.squad || 'Solo';
        agent.dependencies = Array.isArray(agent.dependencies) ? agent.dependencies : [];
        agent.ownership = Array.isArray(agent.ownership) ? agent.ownership : (swarmRoleById[agent.roleId]?.ownership || []);
        agent.missionId = agent.missionId || '';
        agents.push(agent);
      }
    }
    if (agents.length) {
      const byId = new Map([...(this.state.backgroundAgents || []), ...agents].map((agent) => [agent.id, agent]));
      this.state.backgroundAgents = [...byId.values()]
        .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
        .slice(0, 30);
      for (const agent of this.state.backgroundAgents) {
        if (agent.status === 'running' || agent.status === 'queued') {
          agent.status = 'interrupted';
          agent.error = 'The previous Neura IDE session ended before this background agent finished. Run it again to resume from the current worktree state.';
          agent.updatedAt = nowIso();
          await this.persistBackgroundAgent(agent, 'interrupted');
        }
      }
    }
  }

  async persistSwarmMission(mission, event = 'updated', details = {}) {
    if (!this.swarmMissionsDir || !mission?.id) return;
    await fs.mkdir(this.swarmMissionsDir, { recursive: true });
    const entry = {
      at: nowIso(),
      event,
      status: mission.status,
      details,
    };
    mission.events = [entry, ...(mission.events || [])].slice(0, 100);
    mission.updatedAt = nowIso();
    const filePath = path.join(this.swarmMissionsDir, `${mission.id}.json`);
    await fs.writeFile(filePath, `${JSON.stringify(mission, null, 2)}\n`, 'utf8');
    mission.stateFile = filePath;
  }

  refreshSwarmMissionStatus(mission) {
    const agents = (this.state.backgroundAgents || []).filter((agent) => agent.missionId === mission.id);
    const statuses = agents.map((agent) => agent.status);
    if (mission.conflicts?.length) {
      mission.status = 'blocked';
    } else if (statuses.some((status) => ['running', 'queued', 'cancelling'].includes(status))) {
      mission.status = 'running';
    } else if (statuses.length && statuses.every((status) => status === 'completed')) {
      mission.status = 'completed';
    } else if (statuses.some((status) => status === 'failed')) {
      mission.status = 'failed';
    } else if (statuses.some((status) => status === 'cancelled')) {
      mission.status = 'cancelled';
    } else if (statuses.some((status) => status === 'interrupted')) {
      mission.status = 'interrupted';
    } else {
      mission.status = mission.status || 'ready';
    }
    mission.agentStatus = Object.fromEntries(agents.map((agent) => [agent.roleId || agent.id, agent.status]));
    mission.updatedAt = nowIso();
    return mission;
  }

  detectSwarmConflicts(mission) {
    const agents = (this.state.backgroundAgents || [])
      .filter((agent) => mission.agentIds?.includes(agent.id))
      .filter((agent) => Array.isArray(agent.edits) && agent.edits.length);
    const byFile = new Map();
    for (const agent of agents) {
      for (const edit of agent.edits || []) {
        const filePath = normalizeSlashes(edit.filePath || '');
        if (!filePath) continue;
        const owners = byFile.get(filePath) || [];
        if (!owners.some((owner) => owner.agentId === agent.id)) {
          owners.push({
            agentId: agent.id,
            roleId: agent.roleId || 'agent',
            roleLabel: agent.roleLabel || agent.roleId || 'Agent',
            operation: edit.operation || 'update',
            status: agent.status,
          });
        }
        byFile.set(filePath, owners);
      }
    }
    return [...byFile.entries()]
      .filter(([, owners]) => owners.length > 1)
      .map(([filePath, owners]) => ({ filePath, owners }));
  }

  async blockSwarmMissionForConflicts(mission, conflicts) {
    mission.status = 'blocked';
    mission.conflicts = conflicts;
    mission.error = `Swarm edit conflict in ${conflicts.length} file(s). Review role worktrees before merging.`;
    await this.persistSwarmMission(mission, 'conflicts-detected', { conflicts });
    this.recordArtifact('swarm-conflict', `Swarm conflict: ${mission.task}`, mission.error, {
      missionId: mission.id,
      conflicts,
    });
  }

  globPatternToRegex(pattern) {
    const escaped = String(pattern || '')
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '::DOUBLE_STAR::')
      .replace(/\*/g, '[^/]*');
    return new RegExp(`^${escaped.replace(/::DOUBLE_STAR::/g, '.*')}$`);
  }

  pathMatchesOwnership(filePath, ownership = []) {
    if (!ownership.length) return true;
    const normalized = normalizeSlashes(filePath || '');
    return ownership.some((pattern) => this.globPatternToRegex(normalizeSlashes(pattern)).test(normalized));
  }

  async createSwarmMission() {
    this.ensureWorkspace();
    const task = await vscode.window.showInputBox({
      title: 'Neura: Create Agent Swarm',
      prompt: 'Describe the production task the swarm should complete.',
      ignoreFocusOut: true,
      validateInput: (value) => (String(value || '').trim() ? undefined : 'Enter a mission task.'),
    });
    if (!task) return;
    const picked = await vscode.window.showQuickPick(
      swarmRoles.map((role) => ({
        label: role.label,
        description: role.squad,
        detail: role.mission,
        picked: role.default,
        role,
      })),
      {
        title: 'Choose Neura swarm roles',
        canPickMany: true,
        matchOnDescription: true,
        matchOnDetail: true,
      },
    );
    if (!picked) return;
    const selectedRoles = (picked.length ? picked.map((item) => item.role) : swarmRoles.filter((role) => role.default));
    const selectedIds = new Set(selectedRoles.map((role) => role.id));
    const mission = {
      id: id('swarm'),
      task: task.trim(),
      status: 'ready',
      roles: selectedRoles.map((role) => role.id),
      agentIds: [],
      events: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 12);
    for (const [index, role] of selectedRoles.entries()) {
      const dependencies = (role.dependencies || []).filter((dependency) => selectedIds.has(dependency));
      const agentTask = [
        `Mission: ${task.trim()}`,
        `Role: ${role.label} (${role.squad} squad).`,
        `Responsibility: ${role.mission}`,
        dependencies.length ? `Wait for roles: ${dependencies.join(', ')}.` : '',
      ].filter(Boolean).join('\n');
      const agent = await this.createBackgroundAgentRecord(agentTask, {
        roleId: role.id,
        missionId: mission.id,
        missionTask: task.trim(),
        dependencies,
        priority: index,
        stamp,
      });
      mission.agentIds.push(agent.id);
    }
    this.state.swarmMissions = [mission, ...(this.state.swarmMissions || [])].slice(0, 30);
    await this.persistSwarmMission(mission, 'created', {
      roles: mission.roles,
      agentIds: mission.agentIds,
    });
    await this.reviseSwarmPlan(mission, {
      event: 'created',
      roles: mission.roles,
      agentIds: mission.agentIds,
    }, 'created');
    this.recordArtifact('swarm', `Swarm mission: ${task.trim()}`, `Created ${mission.agentIds.length} role agent(s).`, {
      missionId: mission.id,
      roles: mission.roles,
      agentIds: mission.agentIds,
    });
    await this.saveState();
    const runNow = await vscode.window.showInformationMessage(
      `Created Neura swarm with ${mission.agentIds.length} agents.`,
      'Run Swarm',
      'Open Mission Control',
    );
    if (runNow === 'Run Swarm') {
      await this.runSwarmMission(mission.id, { skipApproval: true });
    } else {
      this.activeTab = 'agents';
      await this.refresh();
    }
  }

  async runSwarmMission(missionId, options = {}) {
    const mission = (this.state.swarmMissions || []).find((item) => item.id === missionId);
    if (!mission) throw new Error('Swarm mission was not found.');
    if (!this.config.configured) throw new Error('No AI provider is configured.');
    if (this.swarmRuns.has(mission.id)) {
      await vscode.window.showInformationMessage('This swarm mission is already running.');
      return this.swarmRuns.get(mission.id);
    }
    if (!options.skipApproval) {
      const approval = await vscode.window.showWarningMessage(
        `Run Neura swarm mission?\n\n${mission.task}`,
        { modal: true },
        'Run Swarm',
      );
      if (approval !== 'Run Swarm') return;
    }
    const run = (async () => {
      mission.status = 'running';
      mission.error = '';
      mission.conflicts = [];
      mission.waves = Array.isArray(mission.waves) ? mission.waves : [];
      await this.persistSwarmMission(mission, 'run-started');
      await this.reviseSwarmPlan(mission, {
        event: 'run-started',
        agentStatus: mission.agentStatus || {},
      }, 'run-started');
      await this.saveState();
      this.renderIfVisible();
      const missionAgents = () => (this.state.backgroundAgents || []).filter((agent) => mission.agentIds.includes(agent.id));
      const completedRoles = new Set(missionAgents().filter((agent) => agent.status === 'completed').map((agent) => agent.roleId));
      const pending = new Set(missionAgents().filter((agent) => agent.status !== 'completed').map((agent) => agent.id));
      while (pending.size) {
        const agents = missionAgents().filter((agent) => pending.has(agent.id));
        await this.reviseSwarmPlan(mission, {
          event: 'before-wave',
          completedRoles: [...completedRoles],
          pendingAgents: agents.map((agent) => ({
            roleId: agent.roleId,
            status: agent.status,
            dependencies: agent.dependencies || [],
          })),
        }, 'before-wave');
        if ((mission.taskGraph?.status === 'blocked' || mission.taskGraph?.controllerStatus === 'blocked') && !agents.some((agent) => ['ready', 'queued', 'running'].includes(agent.status))) {
          throw new Error((mission.taskGraph.blockedReasons || [])[0] || 'Planner controller blocked the mission.');
        }
        const dependencyReady = agents.filter((agent) => (agent.dependencies || []).every((dependency) => completedRoles.has(dependency)));
        const runnable = this.plannerSelectedRunnable(mission, dependencyReady);
        if (!runnable.length) {
          throw new Error('Swarm mission dependency graph is blocked. Check selected roles and failed agents.');
        }
        const wave = {
          id: id('wave'),
          startedAt: nowIso(),
          roles: runnable.map((agent) => agent.roleId),
          agentIds: runnable.map((agent) => agent.id),
        };
        mission.waves.push(wave);
        await this.persistSwarmMission(mission, 'wave-started', wave);
        await this.saveState();
        this.renderIfVisible();
        await Promise.all(runnable.map(async (agent) => {
          await this.runBackgroundAgent(agent.id, { skipApproval: true });
          const run = this.backgroundRuns.get(agent.id);
          if (run) await run;
          pending.delete(agent.id);
          if (agent.status === 'completed') completedRoles.add(agent.roleId);
        }));
        const failedAgents = missionAgents().filter((agent) => ['failed', 'cancelled', 'interrupted'].includes(agent.status));
        if (failedAgents.length) {
          throw new Error(`Swarm wave stopped because ${failedAgents.map((agent) => agent.roleLabel || agent.roleId).join(', ')} did not complete.`);
        }
        wave.finishedAt = nowIso();
        const conflicts = this.detectSwarmConflicts(mission);
        if (conflicts.length) {
          await this.blockSwarmMissionForConflicts(mission, conflicts);
          throw new Error(mission.error);
        }
        this.refreshSwarmMissionStatus(mission);
        await this.reviseSwarmPlan(mission, {
          event: 'wave-completed',
          waveId: wave.id,
          completedRoles: [...completedRoles],
          remaining: pending.size,
          agents: missionAgents().map((agent) => ({
            roleId: agent.roleId,
            status: agent.status,
            summary: agent.summary || '',
            error: agent.error || '',
          })),
        }, 'after-wave');
        await this.persistSwarmMission(mission, 'wave-completed', {
          waveId: wave.id,
          completedRoles: [...completedRoles],
          remaining: pending.size,
        });
        await this.saveState();
        this.renderIfVisible();
        if (mission.status === 'failed' || mission.status === 'cancelled') break;
      }
      this.refreshSwarmMissionStatus(mission);
      await this.reviseSwarmPlan(mission, {
        event: 'run-finished',
        status: mission.status,
        completedRoles: [...completedRoles],
      }, 'run-finished');
      await this.persistSwarmMission(mission, 'run-finished');
      this.recordArtifact('swarm', `Swarm mission ${mission.status}: ${mission.task}`, `${mission.agentIds.length} agent(s) finished with status ${mission.status}.`, {
        missionId: mission.id,
        status: mission.status,
        agentIds: mission.agentIds,
      });
      await this.saveState();
      await this.refresh();
    })();
    this.swarmRuns.set(mission.id, run);
    try {
      await run;
    } catch (error) {
      if (mission.status !== 'blocked' && mission.status !== 'cancelled') {
        mission.status = 'failed';
      }
      mission.error = mission.error || errorMessageFor(error);
      await this.persistSwarmMission(mission, mission.status === 'blocked' ? 'run-blocked' : 'run-failed', { error: mission.error });
      this.recordArtifact('swarm', `Swarm mission ${mission.status}: ${mission.task}`, mission.error, {
        missionId: mission.id,
        status: mission.status,
        agentIds: mission.agentIds,
      });
      await this.saveState();
      await this.refresh();
      throw error;
    } finally {
      this.swarmRuns.delete(mission.id);
    }
  }

  async cancelSwarmMission(missionId) {
    const mission = (this.state.swarmMissions || []).find((item) => item.id === missionId);
    if (!mission) throw new Error('Swarm mission was not found.');
    for (const agent of (this.state.backgroundAgents || []).filter((item) => mission.agentIds.includes(item.id))) {
      if (['queued', 'running', 'cancelling'].includes(agent.status)) {
        await this.cancelBackgroundAgent(agent.id);
      }
    }
    mission.status = 'cancelled';
    await this.persistSwarmMission(mission, 'cancelled');
    await this.saveState();
    await this.refresh();
  }

  async reviewSwarmMission(missionId) {
    const mission = (this.state.swarmMissions || []).find((item) => item.id === missionId);
    if (!mission) throw new Error('Swarm mission was not found.');
    const conflicts = this.detectSwarmConflicts(mission);
    if (conflicts.length) {
      await this.blockSwarmMissionForConflicts(mission, conflicts);
      await this.saveState();
      await this.refresh();
      throw new Error('Swarm mission has overlapping file edits. Open the role worktrees and resolve conflicts before creating merge reviews.');
    }
    const completed = (this.state.backgroundAgents || [])
      .filter((agent) => mission.agentIds.includes(agent.id) && agent.status === 'completed');
    if (!completed.length) {
      throw new Error('No completed swarm agents are ready for merge review.');
    }
    const proposal = await this.createSwarmMissionReviewProposal(mission, completed);
    this.recordArtifact('swarm-review', `Swarm review: ${mission.task}`, `Prepared unified merge review for ${completed.length} agent(s).`, {
      missionId: mission.id,
      agentIds: completed.map((agent) => agent.id),
      proposalId: proposal.id,
    });
    await this.persistSwarmMission(mission, 'review-created');
    await this.saveState();
    await this.refresh();
  }

  async createSwarmMissionReviewProposal(mission, completedAgents) {
    if (mission.mergeReviewId && (this.state.proposals || []).some((proposal) => proposal.id === mission.mergeReviewId)) {
      return this.state.proposals.find((proposal) => proposal.id === mission.mergeReviewId);
    }
    const edits = [];
    const commandsByText = new Map();
    const seenFiles = new Set();
    for (const agent of completedAgents) {
      if (!agent.path || !fsSync.existsSync(agent.path)) continue;
      const statusOutput = await execFileAsync('git', ['status', '--porcelain', '-uall'], agent.path).catch(() => '');
      const statusEntries = statusOutput
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .map((line) => this.parseGitStatusLine(line));
      const fallbackEntries = !statusEntries.length && Array.isArray(agent.edits)
        ? agent.edits.map((edit) => ({ status: edit.operation === 'delete' ? ' D' : ' M', filePath: edit.filePath }))
        : [];
      for (const entry of (statusEntries.length ? statusEntries : fallbackEntries)) {
        const safeInAgent = this.safeRelativeForRoot(agent.path, entry.filePath);
        const safeInWorkspace = this.safeRelative(safeInAgent);
        if (seenFiles.has(safeInWorkspace)) continue;
        seenFiles.add(safeInWorkspace);
        const sourcePath = path.join(agent.path, safeInAgent);
        const workspacePath = path.join(this.rootPath, safeInWorkspace);
        const deleted = entry.status.includes('D') && !fsSync.existsSync(sourcePath);
        const operation = deleted ? 'delete' : (fsSync.existsSync(workspacePath) ? 'update' : 'create');
        edits.push({
          id: id('edit'),
          operation,
          filePath: safeInWorkspace,
          content: operation === 'delete' ? '' : await fs.readFile(sourcePath, 'utf8'),
          rationale: `${agent.roleLabel || agent.roleId || 'Agent'}: ${agent.summary || 'swarm role output'}`,
          status: 'proposed',
          sourceAgentId: agent.id,
        });
      }
      for (const command of agent.commands || []) {
        const normalized = this.normalizeCommandForPlatform(command.command || command);
        if (!normalized || commandsByText.has(normalized)) continue;
        commandsByText.set(normalized, {
          id: id('cmd'),
          command: normalized,
          purpose: command.purpose || `${agent.roleLabel || agent.roleId || 'Agent'} verification`,
          status: 'proposed',
          sourceAgentId: agent.id,
        });
      }
    }
    if (!edits.length && !commandsByText.size) {
      throw new Error('No mergeable file changes or verification commands were found in completed swarm agents.');
    }
    const proposal = {
      id: id('proposal'),
      summary: `Merge swarm mission: ${mission.task}`,
      mode: 'ship',
      status: 'proposed',
      edits,
      commands: [...commandsByText.values()],
      todos: (mission.taskGraph?.items || []).map((item) => ({
        title: item.title,
        rationale: item.acceptance || item.rationale || '',
        status: item.status === 'done' ? 'done' : item.status || 'pending',
      })),
      sourceMissionId: mission.id,
      createdAt: nowIso(),
    };
    this.state.proposals.unshift(proposal);
    this.state.proposals = this.state.proposals.slice(0, 25);
    mission.mergeReviewId = proposal.id;
    mission.mergeReview = {
      proposalId: proposal.id,
      fileCount: edits.length,
      commandCount: proposal.commands.length,
      agentIds: completedAgents.map((agent) => agent.id),
      createdAt: nowIso(),
    };
    for (const agent of completedAgents) {
      agent.mergeReviewId = proposal.id;
      agent.lifecycle = 'mission-merge-review-created';
      agent.updatedAt = nowIso();
      await this.persistBackgroundAgent(agent, 'mission-merge-review-created', { proposalId: proposal.id, missionId: mission.id });
    }
    this.activeTab = 'chat';
    return proposal;
  }

  safeRelativeForRoot(rootPath, inputPath) {
    const cleaned = String(inputPath || '').replace(/^@+/, '').replace(/^["']|["']$/g, '').trim();
    if (!cleaned || cleaned === 'codebase' || cleaned === 'workspace') return cleaned;
    const absolute = path.isAbsolute(cleaned) ? cleaned : path.join(rootPath, cleaned);
    const relative = path.relative(rootPath, absolute);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Path is outside workspace: ${cleaned}`);
    }
    return normalizeSlashes(relative);
  }

  async treeForRoot(rootPath, limit = 160) {
    const out = [];
    const walk = async (dir) => {
      if (out.length >= limit) return;
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (out.length >= limit) break;
        if (['node_modules', '.git', 'dist', 'build', 'out', '.next', '.turbo', 'coverage'].includes(entry.name)) continue;
        const absolute = path.join(dir, entry.name);
        const relative = normalizeSlashes(path.relative(rootPath, absolute));
        if (entry.isDirectory()) {
          await walk(absolute);
        } else {
          out.push(relative);
        }
      }
    };
    await walk(rootPath);
    return out;
  }

  roleFileHints(roleId) {
    const common = ['package.json', 'pnpm-lock.yaml', 'package-lock.json', 'tsconfig.json', 'vite.config', 'next.config', 'README', 'AGENTS.md'];
    const byRole = {
      frontend: ['src/', 'app/', 'pages/', 'components/', 'renderer/', '.tsx', '.jsx', '.css', '.scss', '.html'],
      backend: ['server/', 'main/', 'api/', 'routes/', 'services/', 'ipc', 'database', '.ts', '.js', '.sql'],
      'data-state': ['store', 'state', 'schema', 'migration', 'database', 'model', '.sql', '.json'],
      integration: ['ipc', 'bridge', 'api', 'routes', 'services', 'package.json', 'config'],
      qa: ['test', 'spec', 'vitest', 'jest', 'playwright', 'package.json', 'tsconfig'],
      reviewer: ['package.json', 'src/', 'app/', 'extensions/', 'README', 'AGENTS.md'],
      browser: ['index.html', 'src/', 'app/', 'pages/', 'components/', 'vite.config', 'next.config'],
      ship: ['package.json', 'scripts/', 'forge', 'electron', 'README', 'CHANGELOG', 'docs/'],
      context: ['src/', 'app/', 'extensions/', 'package.json', 'README', 'AGENTS.md'],
      planner: ['package.json', 'README', 'AGENTS.md', 'docs/', 'src/', 'app/'],
      orchestrator: ['package.json', 'README', 'AGENTS.md', 'docs/'],
    };
    return [...common, ...(byRole[roleId] || [])].map((item) => item.toLowerCase());
  }

  async readFilesForRoot(rootPath, relativePaths, byteLimit = 9000) {
    const files = [];
    const seen = new Set();
    for (const inputPath of relativePaths) {
      if (!inputPath || seen.has(inputPath)) continue;
      seen.add(inputPath);
      try {
        const relative = this.safeRelativeForRoot(rootPath, inputPath);
        const absolute = path.join(rootPath, relative);
        const stat = await fs.stat(absolute);
        if (!stat.isFile() || stat.size > 450_000) continue;
        const bytes = await fs.readFile(absolute);
        const clipped = bytes.length > byteLimit ? bytes.subarray(0, byteLimit) : bytes;
        files.push({
          filePath: relative,
          content: clipped.toString('utf8'),
          truncated: bytes.length > byteLimit,
        });
      } catch {
        continue;
      }
      if (files.length >= 12) break;
    }
    return files;
  }

  async backgroundAgentContextPack(agent, tree) {
    const role = swarmRoleById[agent.roleId] || {};
    const mission = (this.state.swarmMissions || []).find((item) => item.id && item.id === agent.missionId);
    const roleTask = (mission?.taskGraph?.items || [])
      .filter((item) => item.ownerRole && item.ownerRole === agent.roleId)
      .sort((a, b) => Number(a.priority || 0) - Number(b.priority || 0));
    const hints = this.roleFileHints(agent.roleId);
    const treeMatches = tree
      .filter((filePath) => {
        const lower = filePath.toLowerCase();
        return hints.some((hint) => lower.includes(hint));
      })
      .slice(0, 12);
    const semanticHits = await this.semanticSearch(`${agent.missionTask || ''}\n${agent.task}\n${role.focus?.join(' ') || ''}`, 16).catch(() => []);
    const semanticFiles = semanticHits
      .map((hit) => hit.filePath)
      .filter((filePath) => filePath && tree.includes(filePath))
      .slice(0, 10);
    const selectedFiles = [...new Set([...semanticFiles, ...treeMatches])].slice(0, 12);
    const files = await this.readFilesForRoot(agent.path, selectedFiles, 9000);
    const peers = (this.state.backgroundAgents || [])
      .filter((item) => item.missionId && item.missionId === agent.missionId && item.id !== agent.id)
      .map((item) => ({
        roleId: item.roleId,
        roleLabel: item.roleLabel,
        status: item.status,
        summary: item.summary || '',
        error: item.error || '',
        edits: (item.edits || []).slice(0, 12),
        verification: (item.verification || []).slice(-4),
      }));
    const dependencySummaries = peers.filter((item) => (agent.dependencies || []).includes(item.roleId));
    return {
      role,
      selectedFiles,
      files,
      dependencySummaries,
      peerSummaries: peers,
      semanticHits: semanticHits.slice(0, 10),
      missionTaskGraph: mission?.taskGraph || null,
      plannerUpdate: mission?.taskGraph?.updates?.[0] || null,
      plannerRoleTasks: roleTask.slice(0, 8),
      plannerNextRoles: mission?.planner?.nextRoles || mission?.taskGraph?.nextRoles || [],
      plannerRisks: mission?.planner?.risks || mission?.taskGraph?.risks || [],
    };
  }

  async callBackgroundAgent(agent, tree, externalSignal, attemptContext = {}) {
    const controller = new AbortController();
    const abortListener = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener('abort', abortListener, { once: true });
    }
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const contextPack = await this.backgroundAgentContextPack(agent, tree);
    const role = contextPack.role?.id ? contextPack.role : {
      label: agent.roleLabel || 'Agent',
      squad: agent.squad || 'Solo',
      mission: 'Complete the assigned coding task in the isolated worktree.',
      writes: agent.writes !== false,
    };
    const writePolicy = role.writes
      ? 'You may propose and apply complete file edits that are necessary for your role.'
      : 'This is a non-writing role. Prefer analysis, plans, review notes, and verification commands. Return an empty edits array unless a small coordination artifact is essential.';
    let lastProgressAt = 0;
    try {
      const { payload } = await this.requestChatCompletion({
        temperature: 0.12,
        max_tokens: 7000,
        messages: [
          {
            role: 'system',
            content: [
              'You are a Neura background coding agent working in an isolated git worktree.',
              `Role: ${role.label}. Squad: ${role.squad}.`,
              `Role responsibility: ${role.mission}`,
              role.focus?.length ? `Focus areas: ${role.focus.join(', ')}.` : '',
              role.deliverables?.length ? `Required deliverables: ${role.deliverables.join('; ')}.` : '',
              agent.ownership?.length ? `File ownership lane: ${agent.ownership.join(', ')}. Stay in this lane unless the dependency handoff proves a cross-lane edit is required.` : '',
              writePolicy,
              agent.dependencies?.length ? `This role depends on completed roles: ${agent.dependencies.join(', ')}.` : '',
              contextPack.plannerRoleTasks?.length ? 'Treat the planner controller tasks and handoff notes as the current source of truth for this role.' : '',
              attemptContext.attempt > 1 ? 'This is a repair attempt. Use the verification failure and previous result to fix the worktree, not to restart blindly.' : '',
              'Return exactly one JSON object. No markdown.',
              'Produce complete file edits for the task. Use relative paths inside the worktree.',
              'Do not invent fake files, fake commands, fake test outputs, or fake screenshots.',
              'Use the provided context files and dependency handoff notes. Make the smallest coherent production change for your role.',
              'If the role is implementation-focused and context is insufficient, propose targeted read/search commands instead of guessing.',
              'Schema: {"message":"summary","edits":[{"operation":"create|update|delete","filePath":"path","content":"full content","rationale":"why"}],"commands":[{"command":"verification command","purpose":"why"}]}',
            ].filter(Boolean).join('\n'),
          },
          {
            role: 'user',
            content: [
              `Task: ${agent.task}`,
              agent.missionTask ? `Overall swarm mission: ${agent.missionTask}` : '',
              agent.followUps?.length
                ? `Follow-up instructions:\n${agent.followUps.map((item, index) => `${index + 1}. ${item.content}`).join('\n')}`
                : '',
              `Attempt: ${attemptContext.attempt || 1} of ${backgroundAgentMaxAttempts}`,
              attemptContext.previousResults?.length
                ? `Previous attempt summaries:\n${JSON.stringify(attemptContext.previousResults, null, 2).slice(0, 9000)}`
                : '',
              attemptContext.failure
                ? `Verification failure to repair:\n${JSON.stringify(attemptContext.failure, null, 2).slice(0, 9000)}`
                : '',
              `Worktree path: ${agent.path}`,
              `Dependency handoffs:\n${contextPack.dependencySummaries.length ? JSON.stringify(contextPack.dependencySummaries, null, 2).slice(0, 9000) : 'none'}`,
              `Planner controller update:\n${contextPack.plannerUpdate ? JSON.stringify(contextPack.plannerUpdate, null, 2).slice(0, 2500) : 'none'}`,
              `Planner tasks for your role:\n${contextPack.plannerRoleTasks?.length ? JSON.stringify(contextPack.plannerRoleTasks, null, 2).slice(0, 7000) : 'none'}`,
              `Planner next roles:\n${contextPack.plannerNextRoles?.length ? contextPack.plannerNextRoles.join(', ') : 'none'}`,
              `Planner risks:\n${contextPack.plannerRisks?.length ? contextPack.plannerRisks.join('\n') : 'none'}`,
              `Other mission agents:\n${contextPack.peerSummaries.length ? JSON.stringify(contextPack.peerSummaries, null, 2).slice(0, 9000) : 'none'}`,
              `Selected semantic hits:\n${contextPack.semanticHits.length ? JSON.stringify(contextPack.semanticHits, null, 2).slice(0, 6000) : 'none'}`,
              `Context files:\n${contextPack.files.map((file) => `--- ${file.filePath}${file.truncated ? ' (truncated)' : ''} ---\n${file.content}`).join('\n\n') || 'none'}`,
              `Files:\n${tree.join('\n') || '(empty)'}`,
            ].filter(Boolean).join('\n\n'),
          },
        ],
      }, {
        mode: 'background-agent',
        role: agent.roleId,
        timeoutMs: this.config.timeoutMs,
        stream: true,
        onProgress: (_delta, fullText) => {
          if (Date.now() - lastProgressAt < 900) return;
          lastProgressAt = Date.now();
          agent.liveOutput = String(fullText || '').slice(-1600);
          agent.updatedAt = nowIso();
          this.renderIfVisible(true);
        },
      });
      const content = payload.choices?.[0]?.message?.content || '';
      return parseJsonObject(content);
    } finally {
      clearTimeout(timeout);
      if (externalSignal) externalSignal.removeEventListener('abort', abortListener);
    }
  }

  async applyBackgroundAgentEdits(agent, edits, controller) {
    for (const edit of edits) {
      if (controller.signal.aborted || agent.cancelRequested) throw new Error('Background agent was cancelled.');
      const relative = this.safeRelativeForRoot(agent.path, edit.filePath);
      const absolute = path.join(agent.path, relative);
      if (edit.operation === 'delete') {
        if (fsSync.existsSync(absolute)) await fs.unlink(absolute);
      } else {
        await fs.mkdir(path.dirname(absolute), { recursive: true });
        await fs.writeFile(absolute, String(edit.content || ''), 'utf8');
      }
    }
  }

  async verifyBackgroundAgentCommands(agent, commands, controller) {
    const verification = [];
    for (const command of commands.slice(0, 4)) {
      if (controller.signal.aborted || agent.cancelRequested) throw new Error('Background agent was cancelled.');
      const startedAt = nowIso();
      const normalizedCommand = this.normalizeCommandForPlatform(command.command);
      try {
        const output = await execFileAsync(
          process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : process.env.SHELL || 'sh',
          process.platform === 'win32' ? ['/d', '/s', '/c', normalizedCommand] : ['-lc', normalizedCommand],
          agent.path,
        );
        const result = { command: normalizedCommand, originalCommand: normalizedCommand !== command.command ? command.command : '', status: 'passed', output: output.slice(-4000), startedAt, completedAt: nowIso() };
        verification.push(result);
        await this.persistBackgroundAgent(agent, 'verification-passed', { command: normalizedCommand, originalCommand: result.originalCommand });
      } catch (error) {
        const result = {
          command: normalizedCommand,
          originalCommand: normalizedCommand !== command.command ? command.command : '',
          status: 'failed',
          error: errorMessageFor(error),
          startedAt,
          completedAt: nowIso(),
        };
        verification.push(result);
        await this.persistBackgroundAgent(agent, 'verification-failed', { command: normalizedCommand, originalCommand: result.originalCommand, error: result.error });
        return { verification, failed: result };
      }
      await this.saveState();
      this.renderIfVisible();
    }
    return { verification, failed: null };
  }

  async runBackgroundAgent(agentId, options = {}) {
    const agent = (this.state.backgroundAgents || []).find((item) => item.id === agentId);
    if (!agent) throw new Error('Background agent was not found.');
    if (!this.config.configured) throw new Error('No AI provider is configured.');
    if (this.backgroundRuns.has(agent.id)) {
      await vscode.window.showInformationMessage('This background agent is already running.');
      return;
    }
    if (!options.skipApproval) {
      const approval = await vscode.window.showWarningMessage(
        `Run autonomous background agent in isolated worktree?\n\n${agent.task}`,
        { modal: true },
        'Run Agent',
      );
      if (approval !== 'Run Agent') return;
    }
    agent.status = 'queued';
    agent.error = '';
    agent.cancelRequested = false;
    agent.queuedAt = nowIso();
    agent.updatedAt = nowIso();
    await this.persistBackgroundAgent(agent, 'queued');
    await this.saveState();
    this.renderIfVisible();
    const run = this.executeBackgroundAgent(agent.id).finally(() => {
      this.backgroundRuns.delete(agent.id);
    });
    this.backgroundRuns.set(agent.id, run);
    await vscode.window.showInformationMessage(`Neura background agent queued: ${agent.branch}`);
  }

  async executeBackgroundAgent(agentId) {
    const agent = (this.state.backgroundAgents || []).find((item) => item.id === agentId);
    if (!agent) return;
    const controller = new AbortController();
    this.backgroundCancels.set(agent.id, controller);
    agent.status = 'running';
    agent.startedAt = nowIso();
    agent.updatedAt = nowIso();
    await this.persistBackgroundAgent(agent, 'started');
    await this.saveState();
    this.renderIfVisible();
    try {
      if (agent.cancelRequested) throw new Error('Background agent was cancelled before it started.');
      if (agent.roleId === 'browser') {
        await this.executeBrowserBackgroundAgent(agent, controller);
        await this.saveState();
        await this.refresh();
        return;
      }
      agent.verification = [];
      agent.attempts = [];
      let failure = null;
      let completed = false;
      let lastAppliedEdits = [];
      for (let attempt = 1; attempt <= backgroundAgentMaxAttempts; attempt += 1) {
        const tree = await this.treeForRoot(agent.path, 260);
        await this.persistBackgroundAgent(agent, attempt === 1 ? 'context-read' : 'repair-context-read', { files: tree.length, attempt });
        await this.saveState();
        this.renderIfVisible();
        const previousResults = (agent.attempts || []).map((item) => ({
          attempt: item.attempt,
          summary: item.summary,
          edits: item.edits,
          commands: item.commands,
          failed: item.failed,
        }));
        const result = await this.callBackgroundAgent(agent, tree, controller.signal, {
          attempt,
          previousResults,
          failure,
        });
        if (controller.signal.aborted || agent.cancelRequested) throw new Error('Background agent was cancelled.');
        const edits = agent.writes === false ? [] : this.normalizeResultEdits(result);
        const resultCommands = this.normalizeResultCommands(result);
        if (agent.writes !== false && !edits.length && !resultCommands.length) {
          failure = {
            status: 'weak-response',
            error: `${agent.roleLabel || 'Agent'} returned no edits or verification commands.`,
          };
          agent.attempts.push({
            attempt,
            summary: String(result.message || failure.error).slice(0, 500),
            edits: [],
            commands: [],
            failed: failure,
          });
          await this.persistBackgroundAgent(agent, 'weak-response', { attempt, error: failure.error });
          if (attempt === backgroundAgentMaxAttempts) throw new Error(`${failure.error} The response was too weak to accept after ${attempt} attempt(s).`);
          continue;
        }
        const outsideOwnership = agent.writes === false || !agent.ownership?.length
          ? []
          : edits.filter((edit) => !this.pathMatchesOwnership(edit.filePath, agent.ownership));
        if (outsideOwnership.length) {
          failure = {
            status: 'ownership-violation',
            error: `${agent.roleLabel || 'Agent'} tried to edit outside its ownership lane: ${outsideOwnership.map((edit) => edit.filePath).join(', ')}`,
            allowed: agent.ownership,
          };
          agent.attempts.push({
            attempt,
            summary: String(result.message || failure.error).slice(0, 500),
            edits: edits.map((edit) => edit.filePath),
            commands: resultCommands.map((command) => command.command),
            failed: failure,
          });
          await this.persistBackgroundAgent(agent, 'ownership-violation', { attempt, error: failure.error, allowed: agent.ownership });
          if (attempt === backgroundAgentMaxAttempts) throw new Error(`${failure.error}. The agent stayed outside its lane after ${attempt} attempt(s).`);
          continue;
        }
        await this.applyBackgroundAgentEdits(agent, edits, controller);
        lastAppliedEdits = edits;
        const verificationResult = await this.verifyBackgroundAgentCommands(agent, resultCommands, controller);
        agent.edits = [
          ...(agent.edits || []),
          ...edits.map((edit) => ({
            operation: edit.operation,
            filePath: edit.filePath,
            rationale: edit.rationale || '',
            attempt,
          })),
        ].slice(-80);
        agent.commands = resultCommands;
        agent.verification = [...(agent.verification || []), ...verificationResult.verification].slice(-20);
        const attemptRecord = {
          attempt,
          summary: String(result.message || `Applied ${edits.length} edit(s).`).slice(0, 700),
          edits: edits.map((edit) => edit.filePath),
          commands: resultCommands.map((command) => command.command),
          failed: verificationResult.failed,
          completedAt: nowIso(),
        };
        agent.attempts.push(attemptRecord);
        await this.persistBackgroundAgent(agent, verificationResult.failed ? 'attempt-failed' : 'attempt-passed', attemptRecord);
        await this.saveState();
        this.renderIfVisible();
        if (!verificationResult.failed) {
          agent.status = 'completed';
          agent.summary = String(result.message || `Applied ${edits.length} edit(s).`);
          completed = true;
          break;
        }
        failure = verificationResult.failed;
      }
      if (!completed) {
        throw new Error(failure?.error || 'Background agent did not pass verification.');
      }
      agent.updatedAt = nowIso();
      await this.persistBackgroundAgent(agent, 'completed');
      this.recordArtifact('background-agent', `Background agent completed`, agent.summary, {
        agentId: agent.id,
        branch: agent.branch,
        path: agent.path,
        edits: lastAppliedEdits.map((edit) => edit.filePath),
      });
    } catch (error) {
      agent.status = controller.signal.aborted || agent.cancelRequested ? 'cancelled' : 'failed';
      agent.error = errorMessageFor(error);
      agent.updatedAt = nowIso();
      await this.persistBackgroundAgent(agent, agent.status);
      this.recordArtifact('background-agent', `Background agent failed`, agent.error, {
        agentId: agent.id,
        branch: agent.branch,
      });
    } finally {
      this.backgroundCancels.delete(agent.id);
    }
    await this.saveState();
    await this.refresh();
  }

  async cancelBackgroundAgent(agentId) {
    const agent = (this.state.backgroundAgents || []).find((item) => item.id === agentId);
    if (!agent) throw new Error('Background agent was not found.');
    if (!['queued', 'running'].includes(agent.status)) {
      await vscode.window.showInformationMessage('Only queued or running background agents can be cancelled.');
      return;
    }
    agent.cancelRequested = true;
    agent.status = this.backgroundRuns.has(agent.id) ? 'cancelling' : 'cancelled';
    agent.updatedAt = nowIso();
    this.backgroundCancels.get(agent.id)?.abort();
    await this.persistBackgroundAgent(agent, 'cancel-requested');
    await this.saveState();
    await this.refresh();
  }

  async followUpBackgroundAgent(agentId) {
    const agent = (this.state.backgroundAgents || []).find((item) => item.id === agentId);
    if (!agent) throw new Error('Background agent was not found.');
    const content = await vscode.window.showInputBox({
      title: 'Neura: Send Follow-up',
      prompt: 'Add a follow-up instruction for this background agent.',
      ignoreFocusOut: true,
      validateInput: (value) => (String(value || '').trim() ? undefined : 'Enter a follow-up instruction.'),
    });
    if (!content) return;
    agent.followUps = [
      ...(agent.followUps || []),
      { id: id('follow'), content: content.trim(), createdAt: nowIso() },
    ].slice(-20);
    agent.updatedAt = nowIso();
    await this.persistBackgroundAgent(agent, 'follow-up', { content: content.trim() });
    await this.saveState();
    if (!['queued', 'running', 'cancelling'].includes(agent.status)) {
      const run = await vscode.window.showInformationMessage(
        'Follow-up saved. Run this agent again with the new instruction?',
        'Run Now',
      );
      if (run === 'Run Now') {
        await this.runBackgroundAgent(agent.id, { skipApproval: true });
        return;
      }
    }
    await this.refresh();
  }

  parseGitStatusLine(line) {
    const status = line.slice(0, 2);
    let filePath = line.slice(3).trim();
    if (filePath.includes(' -> ')) {
      filePath = filePath.split(' -> ').pop().trim();
    }
    filePath = filePath.replace(/^"|"$/g, '');
    return { status, filePath: normalizeSlashes(filePath) };
  }

  async createBackgroundAgentReview(agentId) {
    this.ensureWorkspace();
    const agent = (this.state.backgroundAgents || []).find((item) => item.id === agentId);
    if (!agent) throw new Error('Background agent was not found.');
    if (!agent.path || !fsSync.existsSync(agent.path)) throw new Error('Background agent worktree is missing.');
    const statusOutput = await execFileAsync('git', ['status', '--porcelain', '-uall'], agent.path).catch(() => '');
    const statusEntries = statusOutput
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .map((line) => this.parseGitStatusLine(line));
    const fallbackEntries = !statusEntries.length && Array.isArray(agent.edits)
      ? agent.edits.map((edit) => ({ status: edit.operation === 'delete' ? ' D' : ' M', filePath: edit.filePath }))
      : [];
    const entries = statusEntries.length ? statusEntries : fallbackEntries;
    const edits = [];
    for (const entry of entries) {
      const safeInAgent = this.safeRelativeForRoot(agent.path, entry.filePath);
      const safeInWorkspace = this.safeRelative(safeInAgent);
      const sourcePath = path.join(agent.path, safeInAgent);
      const workspacePath = path.join(this.rootPath, safeInWorkspace);
      const deleted = entry.status.includes('D') && !fsSync.existsSync(sourcePath);
      const operation = deleted ? 'delete' : (fsSync.existsSync(workspacePath) ? 'update' : 'create');
      edits.push({
        id: id('edit'),
        operation,
        filePath: safeInWorkspace,
        content: operation === 'delete' ? '' : await fs.readFile(sourcePath, 'utf8'),
        rationale: `Merge from background agent ${agent.branch}.`,
        status: 'proposed',
      });
    }
    if (!edits.length) {
      await vscode.window.showInformationMessage('No changed files were found in this agent worktree.');
      return;
    }
    const proposal = {
      id: id('proposal'),
      summary: `Merge background agent: ${agent.task}`,
      mode: 'agent',
      status: 'proposed',
      edits,
      commands: (agent.commands || []).map((command) => ({
        id: id('cmd'),
        command: command.command,
        purpose: command.purpose || 'Verify background agent changes.',
        status: 'proposed',
      })),
      todos: (agent.followUps || []).map((followUp) => ({
        title: followUp.content,
        rationale: 'Follow-up instruction sent to the background agent.',
        status: 'done',
      })),
      sourceAgentId: agent.id,
      createdAt: nowIso(),
    };
    this.state.proposals.unshift(proposal);
    this.state.proposals = this.state.proposals.slice(0, 20);
    agent.mergeReviewId = proposal.id;
    agent.lifecycle = 'merge-review-created';
    agent.branchLifecycle = {
      branch: agent.branch,
      baseBranch: agent.baseBranch || '',
      baseHead: agent.baseHead || '',
      worktreePath: agent.path,
      mergeReviewId: proposal.id,
      status: 'review-ready',
      updatedAt: nowIso(),
    };
    agent.updatedAt = nowIso();
    await this.persistBackgroundAgent(agent, 'merge-review-created', { proposalId: proposal.id, files: edits.map((edit) => edit.filePath) });
    this.recordArtifact('background-agent-review', `Merge review: ${agent.task}`, `${edits.length} file change(s) staged for review.`, {
      agentId: agent.id,
      proposalId: proposal.id,
      files: edits.map((edit) => edit.filePath),
    });
    this.activeTab = 'chat';
    await this.saveState();
    await this.refresh();
  }

  async installPlugin() {
    const source = await vscode.window.showInputBox({
      title: 'Neura: Install Plugin',
      prompt: 'Git URL or local folder containing neura-plugin.json.',
      ignoreFocusOut: true,
    });
    if (!source) return;
    const pluginRoot = path.join(os.homedir(), '.neura', 'plugins');
    await fs.mkdir(pluginRoot, { recursive: true });
    let destination;
    if (/^https?:|\.git$/i.test(source.trim())) {
      const name = path.basename(source.trim(), '.git').replace(/[^a-zA-Z0-9_.-]/g, '-');
      destination = path.join(pluginRoot, name);
      if (fsSync.existsSync(destination)) throw new Error(`Plugin folder already exists: ${destination}`);
      await execFileAsync('git', ['clone', '--depth=1', source.trim(), destination], pluginRoot);
    } else {
      const resolved = path.resolve(source.trim());
      const manifestPath = path.join(resolved, 'neura-plugin.json');
      if (!fsSync.existsSync(manifestPath)) throw new Error('Local plugin folder must contain neura-plugin.json.');
      const name = path.basename(resolved);
      destination = path.join(pluginRoot, name);
      if (fsSync.existsSync(destination)) throw new Error(`Plugin folder already exists: ${destination}`);
      await fs.cp(resolved, destination, { recursive: true });
    }
    const manifest = await safeReadJson(path.join(destination, 'neura-plugin.json'));
    const pluginName = manifest.name || path.basename(destination);
    const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
    const trust = await vscode.window.showWarningMessage(
      `Plugin "${pluginName}" installed. Trust and load it now?\n\nRequested permissions: ${permissions.length ? permissions.join(', ') : 'none'}\n\nTrusted plugins execute local JavaScript inside Neura IDE.`,
      { modal: true },
      'Trust',
      'Leave Disabled',
    );
    if (trust === 'Trust') {
      await this.trustPlugin(pluginName, true);
    } else {
      await this.refresh();
    }
  }

  async clearChat() {
    const approval = await vscode.window.showWarningMessage(
      'Clear Neura Composer conversation and proposals for this workspace?',
      { modal: true },
      'Clear',
    );
    if (approval !== 'Clear') return;
    this.state = this.defaultState();
    await this.saveState();
    await this.refresh();
  }

  async createSession() {
    this.persistStateToSession();
    await this.rememberCurrentSessionSummary();
    const session = this.createEmptySession(`Session ${(this.state.sessions || []).length + 1}`);
    this.state.sessions = [session, ...(this.state.sessions || [])].slice(0, 30);
    this.state.activeSessionId = session.id;
    this.copySessionToState(session);
    await this.saveState();
    await this.refresh();
  }

  async switchSession(sessionId) {
    if (!sessionId || sessionId === this.state.activeSessionId) return;
    this.persistStateToSession();
    await this.rememberCurrentSessionSummary();
    const session = (this.state.sessions || []).find((item) => item.id === sessionId);
    if (!session) return;
    this.state.activeSessionId = session.id;
    this.copySessionToState(session);
    await this.saveState();
    await this.refresh();
  }

  async handleMessage(message) {
    try {
      if (message.command === 'sendPrompt') await this.sendPrompt(message.content, message.mode, message.attachments);
      if (message.command === 'continueTrajectory') await this.continueStoppedTrajectory();
      if (message.command === 'removeQueuedPrompt') await this.removeQueuedPrompt(message.queueId);
      if (message.command === 'clearPromptQueue') await this.clearPromptQueue();
      if (message.command === 'setMode') await this.setMode(message.mode);
      if (message.command === 'setModel') await this.setModel(message.model);
      if (message.command === 'setReasoning') await this.setReasoning(message.reasoning);
      if (message.command === 'setPermissionMode') await this.setPermissionMode(message.permissionMode);
      if (message.command === 'setTab') {
        this.activeTab = message.tab || 'chat';
        this.renderIfVisible();
      }
      if (message.command === 'openMissionControl') await this.openMissionControl();
      if (message.command === 'createSession') await this.createSession();
      if (message.command === 'switchSession') await this.switchSession(message.sessionId);
      if (message.command === 'addContext') await this.addContext(message.filePath);
      if (message.command === 'removeContext') await this.removeContext(message.filePath);
      if (message.command === 'applyProposal') await this.applyProposal(message.proposalId, message.filePath);
      if (message.command === 'rejectProposal') await this.rejectProposal(message.proposalId, message.filePath);
      if (message.command === 'applyAndRunProposal') await this.applyAndRunProposal(message.proposalId);
      if (message.command === 'undoProposal') await this.undoProposal(message.proposalId);
      if (message.command === 'restoreCheckpoint') await this.restoreCheckpoint(message.checkpointId);
      if (message.command === 'openDiff') await this.openDiff(message.proposalId, message.filePath);
      if (message.command === 'acceptCurrentFileProposal') await this.acceptCurrentFileProposal();
      if (message.command === 'rejectCurrentFileProposal') await this.rejectCurrentFileProposal();
      if (message.command === 'reapplyCurrentFileProposal') await this.reapplyCurrentFileProposal();
      if (message.command === 'openNextPendingEdit') await this.openNextPendingEdit();
      if (message.command === 'acceptCurrentFileHunk') await this.acceptCurrentFileHunk();
      if (message.command === 'rejectCurrentFileHunk') await this.rejectCurrentFileHunk();
      if (message.command === 'runCommand') await this.runCommand(message.proposalId, message.commandId, message.commandText);
      if (message.command === 'fixTerminalFailure') await this.fixTerminalFailure(message.terminalId);
      if (message.command === 'fixWorkspaceProblems') await this.fixWorkspaceProblems();
      if (message.command === 'autoFixTerminalFailure') await this.autoFixTerminalFailure(message.terminalId);
      if (message.command === 'openPreview') await this.openPreview(message.proposalId);
      if (message.command === 'verifyPreview') await this.verifyPreview(message.proposalId);
      if (message.command === 'browserVerify') await this.verifyPreview(message.proposalId);
      if (message.command === 'executeMcpCard') await this.executeMcpCard(message.mcpCardId);
      if (message.command === 'rejectMcpCard') await this.rejectMcpCard(message.mcpCardId);
      if (message.command === 'promptMcpToolCall') await this.promptMcpToolCall();
      if (message.command === 'enableMcpTool') await this.setMcpToolEnabled(message.serverName, message.toolName, true);
      if (message.command === 'disableMcpTool') await this.setMcpToolEnabled(message.serverName, message.toolName, false);
      if (message.command === 'rebuildSemanticIndex') await this.rebuildSemanticIndex();
      if (message.command === 'exportProofBundle') await this.exportProofBundle();
      if (message.command === 'addArtifactComment') await this.addArtifactComment(message.artifactId);
      if (message.command === 'openArtifactFile') await this.openArtifactFile(message.artifactId);
      if (message.command === 'openSettings') await this.openSettings();
      if (message.command === 'configureProviders') await this.configureProviders();
      if (message.command === 'saveProviderSettings') await this.saveProviderSettings(message.settings || {});
      if (message.command === 'clearChat') await this.clearChat();
      if (message.command === 'toggleInlineCompletions') await this.toggleInlineCompletions();
      if (message.command === 'addWorktree') await this.addWorktree();
      if (message.command === 'installPlugin') await this.installPlugin();
      if (message.command === 'trustPlugin') await this.trustPlugin(message.pluginName, true);
      if (message.command === 'untrustPlugin') await this.trustPlugin(message.pluginName, false);
      if (message.command === 'removePlugin') await this.removePlugin(message.pluginName);
      if (message.command === 'openWorktree') await this.openWorktree(message.worktreePath);
      if (message.command === 'removeWorktree') await this.removeWorktree(message.worktreePath);
      if (message.command === 'createBackgroundAgent') await this.createBackgroundAgent();
      if (message.command === 'createSwarmMission') await this.createSwarmMission();
      if (message.command === 'runSwarmMission') await this.runSwarmMission(message.missionId);
      if (message.command === 'cancelSwarmMission') await this.cancelSwarmMission(message.missionId);
      if (message.command === 'reviewSwarmMission') await this.reviewSwarmMission(message.missionId);
      if (message.command === 'openBackgroundAgent') await this.openBackgroundAgent(message.agentId);
      if (message.command === 'openBackgroundAgentLog') await this.openBackgroundAgentLog(message.agentId);
      if (message.command === 'runBackgroundAgent') await this.runBackgroundAgent(message.agentId);
      if (message.command === 'cancelBackgroundAgent') await this.cancelBackgroundAgent(message.agentId);
      if (message.command === 'followUpBackgroundAgent') await this.followUpBackgroundAgent(message.agentId);
      if (message.command === 'reviewBackgroundAgent') await this.createBackgroundAgentReview(message.agentId);
      if (message.command === 'refresh') await this.refresh();
    } catch (error) {
      await vscode.window.showErrorMessage(
        error instanceof Error ? error.message : 'Neura Composer action failed.',
      );
      await this.refresh();
    }
  }

  renderIfVisible(isBusy = false) {
    if (this.view) {
      this.view.webview.html = this.render(isBusy);
    }
    if (this.missionPanel) {
      this.missionPanel.webview.html = this.renderMissionControl();
    }
    this.updateStatusBar();
  }

  updateStatusBar() {
    if (!this.statusBar) return;
    const model = this.config?.model ? this.config.model.split('/').pop() : 'not configured';
    const mode = modeLabels[this.state?.mode] || 'Edit';
    this.statusBar.text = `$(sparkle) Neura ${mode} - ${this.config?.providerLabel || 'AI'}:${model}`;
    this.statusBar.tooltip = `Neura IDE Composer\nProvider: ${this.config?.providerLabel || 'not configured'}\nModel: ${this.config?.model || 'not configured'}\nFallback: ${(this.config?.providers || []).map((provider) => provider.label).join(' -> ') || 'none'}\nReasoning: ${reasoningLabels[this.state?.reasoning] || 'Medium'}`;
    this.statusBar.backgroundColor = this.config?.configured
      ? undefined
      : new vscode.ThemeColor('statusBarItem.warningBackground');
  }

  renderMessages() {
    if (!this.state.messages.length) {
      return `<section class="empty">
        <strong>Give Neura a coding task.</strong>
        <p>Use <code>@file</code> to mention files, <code>@codebase</code> for a project-wide pass, Explain for code Q&A, Plan for implementation todos, Edit for file changes, and Build for apps/sites.</p>
      </section>`;
    }
    return this.state.messages
      .map((message) => {
        if (message.role === 'tool') {
          return this.renderToolMessage(message);
        }
        return `<article class="message ${escapeHtml(message.role)}">
          <div class="message-top">
            <strong>${message.role === 'user' ? 'You' : 'Neura'}</strong>
            <span>${escapeHtml(modeLabels[message.mode] || message.mode || '')}</span>
          </div>
          <div class="message-body">${markdownToHtml(message.content)}</div>
          ${this.renderFileChips(message.referencedFiles || [])}
          ${this.renderAttachmentChips(message.attachments || [])}
        </article>`;
      })
      .join('');
  }

  renderQueuePanel() {
    const queued = this.state.promptQueue || [];
    const trajectory = this.state.stoppedTrajectory;
    if (!queued.length && !trajectory) return '';
    const queueRows = queued
      .map(
        (item, index) => `<div class="queue-row">
          <div>
            <strong>${index === 0 ? 'Next' : `Queued ${index + 1}`}</strong>
            <p>${escapeHtml(item.content || '(attachment only)')}</p>
            <small>${escapeHtml(modeLabels[item.mode] || item.mode || 'Agent')} - ${escapeHtml(new Date(item.createdAt).toLocaleTimeString())}</small>
          </div>
          <button data-command="removeQueuedPrompt" data-queue-id="${escapeHtml(item.id)}">Remove</button>
        </div>`,
      )
      .join('');
    const continuation = trajectory
      ? `<div class="queue-row continuation-row">
          <div>
            <strong>Stopped trajectory</strong>
            <p>${escapeHtml(trajectory.prompt || 'Previous agent run')}</p>
            <small>${escapeHtml(trajectory.reason || 'stopped')} - ${(trajectory.steps || []).length} recorded step(s)</small>
          </div>
          <button class="primary-action" data-command="continueTrajectory">Continue</button>
        </div>`
      : '';
    return `<section class="card queue-panel">
      <div class="card-title">Run Queue</div>
      ${continuation}
      ${queueRows}
      ${queued.length ? `<div class="actions"><button data-command="clearPromptQueue">Clear Queue</button></div>` : ''}
    </section>`;
  }

  renderToolMessage(message) {
    try {
      const payload = JSON.parse(message.content);
      if (payload.kind === 'todos') {
        return `<section class="card">
          <div class="card-title">Plan Todo</div>
          ${payload.items
            .map(
              (todo) => `<div class="todo">
                <span>${escapeHtml(todo.status || 'pending')}</span>
                <div><strong>${escapeHtml(todo.title)}</strong><p>${escapeHtml(todo.rationale || '')}</p></div>
              </div>`,
            )
            .join('')}
        </section>`;
      }
      if (payload.kind === 'thinking') {
        const status = payload.status || 'done';
        const title = payload.title || (status === 'running' ? 'Thinking...' : 'Thinking');
        const steps = Array.isArray(payload.steps)
          ? payload.steps
              .map(
                (step) => `<li class="${escapeHtml(step.status || 'done')}">
                  <div><strong>${escapeHtml(step.action || 'step')}</strong><span>${escapeHtml(step.status || '')}</span></div>
                  <p>${escapeHtml(step.title || '')}</p>
                  ${step.observation ? `<small>${escapeHtml(step.observation)}</small>` : ''}
                </li>`,
              )
              .join('')
          : '';
        return `<details class="thinking" ${status === 'failed' ? 'open' : ''}>
          <summary>${escapeHtml(title)} <span>${escapeHtml(status)}</span></summary>
          <pre>${escapeHtml(payload.text || '')}</pre>
          ${payload.taskGraph ? this.renderTaskGraph(payload.taskGraph, 'Planner') : ''}
          ${steps ? `<ol class="thinking-steps">${steps}</ol>` : ''}
        </details>`;
      }
      if (payload.kind === 'taskGraph') {
        return this.renderTaskGraph(payload.graph || { items: payload.items || [] }, 'Planner');
      }
    } catch {
      return '';
    }
    return '';
  }

  renderTaskGraph(graph, title = 'Planner') {
    const items = Array.isArray(graph?.items) ? graph.items : [];
    if (!items.length) return '';
    const updates = Array.isArray(graph.updates)
      ? graph.updates
          .slice(0, 3)
          .map((update) => `<li><span>${escapeHtml(update.stage || 'update')}</span>${escapeHtml(update.summary || '')}</li>`)
          .join('')
      : '';
    return `<section class="task-graph">
      <div class="task-graph-head">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(graph.status || 'running')} · v${escapeHtml(graph.version || 1)}</span>
      </div>
      ${graph.goal ? `<p>${escapeHtml(graph.goal)}</p>` : ''}
      <ol>
        ${items
          .map(
            (item) => `<li class="${escapeHtml(item.status || 'pending')}">
              <div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.status || 'pending')}</span></div>
              ${item.rationale ? `<p>${escapeHtml(item.rationale)}</p>` : ''}
              ${item.files?.length ? `<small>${escapeHtml(item.files.join(', '))}</small>` : ''}
            </li>`,
          )
          .join('')}
      </ol>
      ${updates ? `<details><summary>Planner updates</summary><ul>${updates}</ul></details>` : ''}
    </section>`;
  }

  renderProposalSteps(proposal) {
    if (proposal.taskGraph) {
      return this.renderTaskGraph(proposal.taskGraph, 'Planner task graph');
    }
    const todos = Array.isArray(proposal.todos) ? proposal.todos : [];
    if (!todos.length) return '';
    return `<details class="run-steps">
      <summary>Plan <span>${todos.length} steps</span></summary>
      <ol>
        ${todos
          .map(
            (todo) => `<li>
              <strong>${escapeHtml(todo.title)}</strong>
              ${todo.rationale ? `<p>${escapeHtml(todo.rationale)}</p>` : ''}
            </li>`,
          )
          .join('')}
      </ol>
    </details>`;
  }

  renderProposalStats(proposal) {
    const edits = proposal.edits || [];
    const commands = proposal.commands || [];
    const creates = edits.filter((edit) => edit.operation === 'create').length;
    const updates = edits.filter((edit) => edit.operation === 'update').length;
    const deletes = edits.filter((edit) => edit.operation === 'delete').length;
    return [
      edits.length ? `${edits.length} files` : '',
      creates ? `${creates} create` : '',
      updates ? `${updates} update` : '',
      deletes ? `${deletes} delete` : '',
      commands.length ? `${commands.length} commands` : '',
    ]
      .filter(Boolean)
      .map((item) => `<span>${escapeHtml(item)}</span>`)
      .join('');
  }

  renderFileChips(files) {
    return files
      .filter(Boolean)
      .slice(0, 10)
      .map((file) => `<code>${escapeHtml(file)}</code>`)
      .join('');
  }

  renderAttachmentChips(attachments) {
    return attachments
      .slice(0, 6)
      .map(
        (attachment) =>
          `<code>+ ${escapeHtml(attachment.name)} ${Math.round(Number(attachment.size || 0) / 1024)}KB</code>`,
      )
      .join('');
  }

  renderContextBar() {
    const chips = (this.state.contextFiles || [])
      .map(
        (file) =>
          `<button class="chip" data-command="removeContext" data-file-path="${escapeHtml(file)}">@${escapeHtml(file)} x</button>`,
      )
      .join('');
    return `<section class="context">
      <div>
        <strong>Context</strong>
        <span>${chips || 'Current file is added automatically. Type @ to mention files.'}</span>
      </div>
    </section>`;
  }

  renderProposals() {
    if (!this.state.proposals.length) return '';
    return this.state.proposals
      .slice(0, 6)
      .map(
        (proposal) => `<section class="agent-run">
          <div class="run-head">
            <div>
              <div class="run-kicker">${escapeHtml(modeLabels[proposal.mode] || 'Edit')} run</div>
              <h2>${escapeHtml(proposal.summary)}</h2>
              <div class="run-stats">${this.renderProposalStats(proposal)}</div>
            </div>
            <span class="run-status ${escapeHtml(proposal.status)}">${escapeHtml(proposal.status)}</span>
          </div>
          ${this.renderProposalSteps(proposal)}
          ${
            proposal.edits.length
              ? `<div class="review-bar">
                  <div>
                    <strong>Review changes</strong>
                    <p>${escapeHtml(permissionLabels[this.state.permissionMode] || 'Ask Permission')}</p>
                  </div>
                  <div class="review-actions">
                    <button class="primary-action" data-command="applyProposal" data-proposal-id="${escapeHtml(proposal.id)}">Accept all</button>
                    <button class="primary-action" data-command="applyAndRunProposal" data-proposal-id="${escapeHtml(proposal.id)}">Accept & run</button>
                    <button data-command="rejectProposal" data-proposal-id="${escapeHtml(proposal.id)}">Reject all</button>
                  ${proposal.lastCheckpointId ? `<button data-command="undoProposal" data-proposal-id="${escapeHtml(proposal.id)}">Undo</button>` : ''}
                  </div>
                </div>`
              : ''
          }
          <div class="change-list">${proposal.edits.map((edit) => this.renderEditCard(proposal, edit)).join('')}</div>
          ${(proposal.commands || []).length ? `<div class="command-list">${(proposal.commands || []).map((command) => this.renderCommandCard(proposal, command)).join('')}</div>` : ''}
          ${
            proposal.preview
              ? `<div class="preview-row">
                  <div><strong>Preview</strong><p>${escapeHtml(proposal.preview.command || 'Run the app preview command.')}</p></div>
                  <div class="actions">
                    <button data-command="openPreview" data-proposal-id="${escapeHtml(proposal.id)}">Open</button>
                    <button data-command="verifyPreview" data-proposal-id="${escapeHtml(proposal.id)}">Verify</button>
                  </div>
                </div>`
              : ''
          }
        </section>`,
      )
      .join('');
  }

  renderEditCard(proposal, edit) {
    return `<div class="change-row ${escapeHtml(edit.status)}">
      <div class="change-main">
        <span class="file-icon">${edit.operation === 'delete' ? '-' : edit.operation === 'create' ? '+' : '~'}</span>
        <div>
          <strong>${escapeHtml(edit.filePath)}</strong>
          <p>${escapeHtml(edit.rationale || 'Neura proposed a full-file change.')}</p>
        </div>
      </div>
      <div class="change-side">
        <span>${escapeHtml(edit.operation)} · ${escapeHtml(edit.status)}</span>
        <div>
          <button data-command="openDiff" data-proposal-id="${escapeHtml(proposal.id)}" data-file-path="${escapeHtml(edit.filePath)}">Diff</button>
          <button data-command="applyProposal" data-proposal-id="${escapeHtml(proposal.id)}" data-file-path="${escapeHtml(edit.filePath)}">Accept</button>
          <button data-command="rejectProposal" data-proposal-id="${escapeHtml(proposal.id)}" data-file-path="${escapeHtml(edit.filePath)}">Reject</button>
        </div>
      </div>
    </div>`;
  }

  renderCommandCard(proposal, command) {
    return `<div class="command-row">
      <div>
        <strong>Command</strong>
        <p>${escapeHtml(command.purpose)}</p>
        <code>${escapeHtml(command.command)}</code>
      </div>
      <div class="command-side">
        <span>${escapeHtml(command.status)}</span>
        <button data-command="runCommand" data-proposal-id="${escapeHtml(proposal.id)}" data-command-id="${escapeHtml(command.id)}" data-command-text="${escapeHtml(command.command)}">Run</button>
      </div>
    </div>`;
  }

  renderFixHistory(card) {
    const history = card.fixHistory || [];
    if (!history.length) return '';
    return `<details class="run-steps">
      <summary>Auto-fix attempts <span>${history.length}</span></summary>
      <ol>
        ${history
          .map(
            (attempt) => `<li>
              <strong>${escapeHtml(`Attempt ${attempt.attempt}: ${attempt.status}`)}</strong>
              ${attempt.command ? `<p>${escapeHtml(attempt.command)}</p>` : ''}
              ${attempt.appliedFiles?.length ? `<p>Applied: ${escapeHtml(attempt.appliedFiles.join(', '))}</p>` : ''}
              ${attempt.stopReason ? `<p>${escapeHtml(attempt.stopReason)}</p>` : ''}
              ${attempt.exitCode !== null && attempt.exitCode !== undefined ? `<p>Exit ${escapeHtml(attempt.exitCode)}</p>` : ''}
            </li>`,
          )
          .join('')}
      </ol>
    </details>`;
  }

  renderTerminals() {
    if (!this.state.terminalCards.length) return '';
    return `<section class="card">
      <div class="card-title">Terminal History</div>
      ${this.state.terminalCards
        .slice(0, 5)
        .map(
          (card) => `<div class="terminal-card">
            <div class="file-head"><strong>${escapeHtml(card.status)}</strong><span>exit ${escapeHtml(card.exitCode ?? '...')}</span></div>
            <code>${escapeHtml(card.command)}</code>
            <pre>${escapeHtml(`${card.stdout || ''}${card.stderr ? `\n${card.stderr}` : ''}`.slice(-3000))}</pre>
            ${this.renderFixHistory(card)}
            ${card.status === 'failed' ? `<div class="actions"><button data-command="fixTerminalFailure" data-terminal-id="${escapeHtml(card.id)}">Fix failure</button><button data-command="autoFixTerminalFailure" data-terminal-id="${escapeHtml(card.id)}">Auto-fix loop</button></div>` : ''}
          </div>`,
        )
        .join('')}
    </section>`;
  }

  renderCheckpoints() {
    if (!this.state.checkpoints.length) return '';
    return `<section class="card">
      <div class="card-title">Checkpoints</div>
      ${this.state.checkpoints
        .slice(0, 8)
        .map(
          (checkpoint) => `<div class="checkpoint">
            <div><strong>${escapeHtml(checkpoint.label)}</strong><p>${new Date(checkpoint.createdAt).toLocaleString()}</p></div>
            <button data-command="restoreCheckpoint" data-checkpoint-id="${escapeHtml(checkpoint.id)}">Restore</button>
          </div>`,
        )
        .join('')}
    </section>`;
  }

  renderSuggestions() {
    return this.suggestions
      .slice(0, 80)
      .map((file) => `<button data-file="${escapeHtml(file)}">@${escapeHtml(file)}</button>`)
      .join('');
  }

  renderModelOptions() {
    const known = nvidiaModels.some((model) => model.id === this.config.model);
    const providerPrefix = this.config.providerLabel ? `${this.config.providerLabel} - ` : '';
    const models = known
      ? nvidiaModels
      : [
          {
            id: this.config.model,
            label: `${providerPrefix}${this.config.model || 'Custom model'}`,
            description: 'Current configured provider model',
          },
          ...nvidiaModels,
        ];
    return models
      .map(
        (model) =>
          `<option value="${escapeHtml(model.id)}" ${model.id === this.config.model ? 'selected' : ''}>${escapeHtml(model.label)}</option>`,
      )
      .join('');
  }

  renderReasoningOptions() {
    return Object.entries(reasoningLabels)
      .map(
        ([value, label]) =>
          `<option value="${escapeHtml(value)}" ${value === this.state.reasoning ? 'selected' : ''}>Reasoning ${escapeHtml(label)}</option>`,
      )
      .join('');
  }

  renderPermissionOptions() {
    return Object.entries(permissionLabels)
      .map(
        ([value, label]) =>
          `<option value="${escapeHtml(value)}" ${value === this.state.permissionMode ? 'selected' : ''}>${escapeHtml(label)}</option>`,
      )
      .join('');
  }

  renderTabs() {
    const tabs = [
      ['chat', 'Chat'],
      ['artifacts', `Artifacts${(this.state.artifacts || []).length ? ` ${(this.state.artifacts || []).length}` : ''}`],
      ['agents', `Agents${(this.state.backgroundAgents || []).length ? ` ${(this.state.backgroundAgents || []).length}` : ''}`],
      ['mcp', `MCP${this.mcpServers.length ? ` ${this.mcpServers.length}` : ''}`],
      ['plugins', `Plugins${this.plugins.length ? ` ${this.plugins.length}` : ''}`],
      ['worktrees', `Worktrees${this.worktrees.length ? ` ${this.worktrees.length}` : ''}`],
    ];
    if (this.activeTab === 'settings') {
      tabs.push(['settings', 'Settings']);
    }
    return `<nav class="tabs">${tabs
      .map(
        ([idValue, label]) =>
          `<button class="tab ${this.activeTab === idValue ? 'active' : ''}" data-command="setTab" data-tab="${escapeHtml(idValue)}">${escapeHtml(label)}</button>`,
      )
      .join('')}</nav>`;
  }

  renderSessionOptions() {
    return (this.state.sessions || [])
      .map(
        (session) =>
          `<option value="${escapeHtml(session.id)}" ${session.id === this.state.activeSessionId ? 'selected' : ''}>${escapeHtml(this.sessionTitle(session))}</option>`,
      )
      .join('');
  }

  renderMainPanel() {
    if (this.activeTab === 'settings') return this.renderSettingsPanel();
    if (this.activeTab === 'artifacts') return this.renderArtifactsPanel();
    if (this.activeTab === 'agents') return this.renderAgentsPanel();
    if (this.activeTab === 'mcp') return this.renderMcpPanel();
    if (this.activeTab === 'plugins') return this.renderPluginsPanel();
    if (this.activeTab === 'worktrees') return this.renderWorktreesPanel();
    return `${(this.state.contextFiles || []).length ? this.renderContextBar() : ''}
      ${this.renderMessages()}
      ${this.renderProposals()}
      ${this.renderTerminals()}
      ${this.renderCheckpoints()}`;
  }

  renderSettingsPanel() {
    const status = this.config.providerStatus || {};
    const order = (this.config.providerOrder || ['openrouter', 'ollama', 'nim']).join(',');
    const orderOptions = [
      ['openrouter,ollama,nim', 'OpenRouter -> Ollama -> NVIDIA NIM'],
      ['ollama,openrouter,nim', 'Ollama -> OpenRouter -> NVIDIA NIM'],
      ['nim,openrouter,ollama', 'NVIDIA NIM -> OpenRouter -> Ollama'],
      ['openrouter,nim,ollama', 'OpenRouter -> NVIDIA NIM -> Ollama'],
    ]
      .map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === order ? 'selected' : ''}>${escapeHtml(label)}</option>`)
      .join('');
    const providerCard = (idValue, title, description) => {
      const info = status[idValue] || {};
      const configured = Boolean(info.configured);
      return `<section class="settings-card">
        <div class="settings-card-head">
          <div>
            <strong>${escapeHtml(title)}</strong>
            <p>${escapeHtml(description)}</p>
          </div>
          <span class="provider-state ${configured ? 'ready' : 'missing'}">${configured ? 'Ready' : 'Needs setup'}</span>
        </div>
        <label>
          <span>API key</span>
          <input id="${escapeHtml(idValue)}ApiKey" type="password" autocomplete="off" placeholder="${configured ? 'Saved - leave blank to keep' : 'Enter API key'}" />
        </label>
        <label>
          <span>Base URL</span>
          <input id="${escapeHtml(idValue)}BaseUrl" type="text" value="${escapeHtml(info.baseUrl || '')}" placeholder="${idValue === 'openrouter' ? 'https://openrouter.ai/api/v1' : idValue === 'ollama' ? 'https://ollama.com or http://localhost:11434' : 'https://integrate.api.nvidia.com/v1'}" />
        </label>
        <label>
          <span>Model</span>
          <input id="${escapeHtml(idValue)}Model" type="text" value="${escapeHtml(info.model || '')}" placeholder="${idValue === 'openrouter' ? 'openrouter model id' : idValue === 'ollama' ? 'ollama model id' : 'nvidia/nemotron-3-nano-30b-a3b'}" />
        </label>
      </section>`;
    };

    return `<section class="settings-panel">
      <div class="settings-hero">
        <div>
          <h2>Neura Settings</h2>
          <p>Configure AI providers inside Neura IDE. The active chain is used immediately by chat, builder, agents, inline edits, and verification loops.</p>
        </div>
        <span class="provider-state ${this.config.configured ? 'ready' : 'missing'}">${this.config.configured ? `Using ${escapeHtml(this.config.providerLabel)}` : 'No provider ready'}</span>
      </div>
      <form id="providerSettingsForm" class="settings-form">
        <section class="settings-card wide">
          <div class="settings-card-head">
            <div>
              <strong>Fallback Order</strong>
              <p>Neura tries providers in this order until one responds.</p>
            </div>
          </div>
          <label>
            <span>Provider chain</span>
            <select id="providerOrder">${orderOptions}</select>
          </label>
        </section>
        ${providerCard('openrouter', 'OpenRouter', 'Primary cloud router for production coding models.')}
        ${providerCard('ollama', 'Ollama', 'Fallback for Ollama Cloud or local Ollama. Local URLs do not require an API key.')}
        ${providerCard('nim', 'NVIDIA NIM', 'Final fallback and current stable test backend for Neura.')}
        <div class="settings-actions">
          <button type="submit" class="primary-action">Save Settings</button>
          <button type="button" data-command="refresh">Refresh Status</button>
        </div>
      </form>
      <p class="settings-note">API keys are write-only here. Leave a key field blank to keep the saved value.</p>
    </section>`;
  }

  renderArtifactsPanel() {
    const artifacts = this.state.artifacts || [];
    const rows = artifacts.length
      ? groupArtifactsByRun(artifacts)
          .sort((a, b) => String((b.items[b.items.length - 1] || {}).createdAt || '').localeCompare(String((a.items[a.items.length - 1] || {}).createdAt || '')))
          .map(({ runId, items }) => {
            const ordered = [...items].sort((a, b) => (b.sequence || 0) - (a.sequence || 0));
            const latest = ordered[0];
            return `<div class="card soft-card">
              <div class="card-title">
                <span>Run ${escapeHtml(runId)}</span>
                <span>${escapeHtml(String(items.length))} artifacts</span>
              </div>
              <p class="muted">Latest: ${escapeHtml(latest?.title || 'Artifact')} - ${latest ? escapeHtml(new Date(latest.createdAt).toLocaleString()) : ''}</p>
              ${ordered.map((artifact) => {
                const previewPath = artifactPreviewPath(artifact);
                const previewUri = previewPath ? this.webviewFileUri(previewPath) : '';
                const comments = (artifact.comments || [])
                  .map((comment) => `<li><span>${escapeHtml(new Date(comment.createdAt).toLocaleString())}</span>${escapeHtml(comment.text)}</li>`)
                  .join('');
                return `<div class="list-row artifact-row">
                <div>
                  <strong>${escapeHtml(artifact.sequence || '?')}. ${escapeHtml(artifact.title)}</strong>
                  <p>${escapeHtml(artifact.summary || '')}</p>
                  <code>${escapeHtml(artifact.kind)}</code>
                  ${previewUri ? `<img class="artifact-preview" src="${previewUri}" alt="${escapeHtml(artifact.title)} preview" />` : ''}
                  ${artifact.data?.domPath ? `<code>${escapeHtml(artifact.data.domPath)}</code>` : ''}
                  ${artifact.data?.recordingPath ? `<code>${escapeHtml(artifact.data.recordingPath)}</code>` : ''}
                  ${artifact.data?.mdPath ? `<code>${escapeHtml(artifact.data.mdPath)}</code>` : ''}
                  ${artifact.data?.jsonPath ? `<code>${escapeHtml(artifact.data.jsonPath)}</code>` : ''}
                  ${artifact.data?.htmlPath ? `<code>${escapeHtml(artifact.data.htmlPath)}</code>` : ''}
                  ${comments ? `<details class="agent-details"><summary>Comments <span>${(artifact.comments || []).length}</span></summary><ol>${comments}</ol></details>` : ''}
                </div>
                <div class="actions vertical-actions">
                  <span>${new Date(artifact.createdAt).toLocaleString()}</span>
                  <button data-command="addArtifactComment" data-artifact-id="${escapeHtml(artifact.id)}">Comment</button>
                  <button data-command="openArtifactFile" data-artifact-id="${escapeHtml(artifact.id)}">Open file</button>
                </div>
              </div>`;
              }).join('')}
            </div>`;
          })
          .join('')
      : '<section class="empty"><strong>No artifacts yet.</strong><p>Neura records proposals, applied changes, checkpoints, terminal results, preview checks, and background agent worktrees here.</p></section>';
    const index = this.state.semanticIndex || {};
    const stats = index.stats || {};
    const graphEdges = (index.graph || []).reduce((sum, node) => sum + (node.edges || []).filter((edge) => edge.target).length, 0);
    const dense = stats.dense || {};
    const indexSummary = [
      `${(index.files || []).length || 0} files`,
      `${(index.symbols || []).length || 0} symbols`,
      `${graphEdges} resolved imports`,
      `${index.workspace?.roots?.length || 1} root(s)`,
      `${stats.commits || 0} commits`,
      `${stats.pullRequests || 0} PRs`,
      `${stats.issues || 0} issues`,
      `${stats.changedFiles || 0} changed`,
      `${stats.reusedFiles || 0} reused`,
      index.embedding?.kind || '',
      dense.enabled ? `${dense.changed || 0} dense vectors updated` : '',
      dense.error ? `dense fallback: ${dense.error}` : '',
    ].filter(Boolean).join(' - ');
    const vectorSummary = this.config.embeddings?.enabled
      ? (this.config.embeddings.configured
        ? `Dense embeddings enabled with ${this.config.embeddings.model}.`
        : 'Dense embeddings enabled but missing model/API configuration.')
      : 'Dense embeddings off. Sparse index is active.';
    const sharedSummary = this.sharedSemanticIndexPath
      ? `${index.shared ? 'Loaded shared index' : 'Shared index configured'}: ${this.sharedSemanticIndexPath}`
      : 'No shared/team index configured.';
    const auditRows = (this.state.policyAudit || [])
      .slice(0, 30)
      .map((entry) => `<div class="list-row">
        <div><strong>${escapeHtml(entry.decision)} ${escapeHtml(entry.action)}</strong><p>${escapeHtml(entry.resource)}</p><small>${escapeHtml(entry.reason)}</small></div>
        <span>${escapeHtml(new Date(entry.createdAt).toLocaleString())}</span>
      </div>`)
      .join('');
    return `<section class="card">
      <div class="card-title">Artifacts</div>
      <div class="actions">
        <button data-command="rebuildSemanticIndex">Update Semantic Index</button>
        <button data-command="exportProofBundle">Export Proof Bundle</button>
      </div>
      <div class="list-row">
        <div>
          <strong>Semantic Index</strong>
          <p>${escapeHtml(indexSummary || 'No semantic index yet.')}</p>
          <p>${escapeHtml(vectorSummary)}</p>
          <p>${escapeHtml(sharedSummary)}</p>
          ${this.vectorIndexPath ? `<code>${escapeHtml(this.vectorIndexPath)}</code>` : ''}
          ${this.sharedSemanticIndexPath ? `<code>${escapeHtml(this.sharedSemanticIndexPath)}</code>` : ''}
        </div>
        <span>${index.updatedAt ? escapeHtml(new Date(index.updatedAt).toLocaleString()) : ''}</span>
      </div>
      <div class="card soft-card">
        <div class="card-title"><span>Policy Audit</span><span>${(this.state.policyAudit || []).length}</span></div>
        ${auditRows || '<p class="muted">No policy decisions recorded yet.</p>'}
      </div>
      ${rows}
    </section>`;
  }

  renderAgentsPanel() {
    const agents = this.state.backgroundAgents || [];
    const missions = this.state.swarmMissions || [];
    const counts = ['ready', 'queued', 'running', 'cancelling', 'completed', 'blocked', 'failed', 'cancelled', 'interrupted']
      .map((status) => [status, agents.filter((agent) => agent.status === status).length])
      .filter(([, count]) => count);
    const queueSummary = counts.length
      ? counts.map(([status, count]) => `<span class="agent-pill ${escapeHtml(status)}">${escapeHtml(status)} ${count}</span>`).join('')
      : '<span class="muted">No active agent work.</span>';
    const rows = agents.length
      ? agents
          .map(
            (agent) => {
              const running = ['queued', 'running', 'cancelling'].includes(agent.status);
              const canReview = ['completed', 'failed', 'cancelled', 'interrupted'].includes(agent.status);
              const events = (agent.events || [])
                .slice(0, 6)
                .map((event) => `<li><span>${escapeHtml(event.event)}</span><small>${escapeHtml(new Date(event.at).toLocaleTimeString())}</small>${event.summary ? `<p>${escapeHtml(event.summary)}</p>` : ''}${event.error ? `<p class="error-text">${escapeHtml(event.error)}</p>` : ''}</li>`)
                .join('');
              const followUps = (agent.followUps || [])
                .slice(-4)
                .map((item) => `<li>${escapeHtml(item.content)}</li>`)
                .join('');
              const attempts = (agent.attempts || [])
                .slice(-4)
                .map((item) => `<li><span>Attempt ${escapeHtml(item.attempt)}</span>${item.failed ? `<p class="error-text">${escapeHtml(item.failed.error || item.failed.status || 'failed')}</p>` : '<p>passed</p>'}<small>${escapeHtml(item.summary || '')}</small></li>`)
                .join('');
              return `<div class="agent-card">
              <div class="agent-card-head">
                <div>
                  <div class="agent-title">${escapeHtml(agent.roleLabel || 'Agent')} <span>${escapeHtml(agent.squad || 'Solo')}</span></div>
                  <p>${escapeHtml(agent.task)}</p>
                  <p>${escapeHtml(agent.path)}</p>
                  <code>${escapeHtml(agent.branch)}</code>
                  ${agent.branchLifecycle ? `<p class="muted">Lifecycle: ${escapeHtml(agent.branchLifecycle.status || agent.lifecycle || '')} / base ${escapeHtml(agent.branchLifecycle.baseBranch || agent.baseBranch || '')}@${escapeHtml(agent.branchLifecycle.baseHead || agent.baseHead || '')}</p>` : ''}
                </div>
                <span class="agent-status ${escapeHtml(agent.status)}">${escapeHtml(agent.status)}</span>
              </div>
              ${agent.summary ? `<p class="agent-summary">${escapeHtml(agent.summary)}</p>` : ''}
              ${agent.liveOutput && running ? `<details class="agent-details" open><summary>Streaming response <span>live</span></summary><pre>${escapeHtml(agent.liveOutput)}</pre></details>` : ''}
              ${agent.verification?.length ? `<div class="agent-verification">${escapeHtml(agent.verification.map((item) => `${item.status}: ${item.command}`).join(' | '))}</div>` : ''}
              ${agent.error ? `<p class="error-text">${escapeHtml(agent.error)}</p>` : ''}
              ${attempts ? `<details class="agent-details"><summary>Attempts <span>${(agent.attempts || []).length}</span></summary><ol>${attempts}</ol></details>` : ''}
              ${followUps ? `<details class="agent-details"><summary>Follow-ups <span>${(agent.followUps || []).length}</span></summary><ol>${followUps}</ol></details>` : ''}
              ${events ? `<details class="agent-details"><summary>Live log <span>${(agent.events || []).length}</span></summary><ol>${events}</ol></details>` : ''}
              <div class="actions agent-actions">
                <button data-command="runBackgroundAgent" data-agent-id="${escapeHtml(agent.id)}" ${running ? 'disabled' : ''}>Run</button>
                ${running ? `<button data-command="cancelBackgroundAgent" data-agent-id="${escapeHtml(agent.id)}">Cancel</button>` : ''}
                <button data-command="followUpBackgroundAgent" data-agent-id="${escapeHtml(agent.id)}">Follow up</button>
                ${canReview ? `<button class="primary-action" data-command="reviewBackgroundAgent" data-agent-id="${escapeHtml(agent.id)}">Review merge</button>` : ''}
                <button data-command="openBackgroundAgent" data-agent-id="${escapeHtml(agent.id)}">Open</button>
                ${agent.logFile ? `<button data-command="openBackgroundAgentLog" data-agent-id="${escapeHtml(agent.id)}">Log</button>` : ''}
              </div>
            </div>`;
            },
          )
          .join('')
      : '<section class="empty"><strong>No background agents yet.</strong><p>Create an isolated git worktree for a coding task. Neura persists each agent state and log under this workspace memory.</p></section>';
    const missionRows = missions.length
      ? missions.map((mission) => {
        const missionAgents = agents.filter((agent) => mission.agentIds.includes(agent.id));
        const missionCounts = ['ready', 'queued', 'running', 'completed', 'blocked', 'failed', 'cancelled', 'interrupted']
          .map((status) => [status, missionAgents.filter((agent) => agent.status === status).length])
          .filter(([, count]) => count)
          .map(([status, count]) => `<span class="agent-pill ${escapeHtml(status)}">${escapeHtml(status)} ${count}</span>`)
          .join('');
        const roleLine = missionAgents
          .map((agent) => `${agent.roleLabel || agent.roleId}: ${agent.status}`)
          .join(' | ');
        const running = ['queued', 'running', 'cancelling'].includes(mission.status);
        const conflicts = (mission.conflicts || [])
          .map((conflict) => `<li><strong>${escapeHtml(conflict.filePath)}</strong><span>${escapeHtml((conflict.owners || []).map((owner) => owner.roleLabel || owner.roleId).join(' vs '))}</span></li>`)
          .join('');
        const waves = (mission.waves || [])
          .slice(-4)
          .map((wave) => `<li><strong>${escapeHtml((wave.roles || []).join(', '))}</strong><span>${escapeHtml(wave.finishedAt ? 'finished' : 'running')}</span></li>`)
          .join('');
        const plannerSummary = mission.taskGraph?.updates?.[0]?.summary || '';
        const plannerNext = mission.planner?.nextRoles || mission.taskGraph?.nextRoles || [];
        const plannerBlockers = mission.planner?.blockedReasons || mission.taskGraph?.blockedReasons || [];
        return `<div class="agent-card swarm-card">
          <div class="agent-card-head">
            <div>
              <div class="agent-title">Swarm Mission <span>${escapeHtml(mission.status || 'ready')}</span></div>
              <p>${escapeHtml(mission.task)}</p>
              <code>${escapeHtml(mission.id)}</code>
            </div>
            <span class="agent-status ${escapeHtml(mission.status || 'ready')}">${escapeHtml(mission.status || 'ready')}</span>
          </div>
          <div class="mission-summary">${missionCounts || '<span class="muted">No role agents yet.</span>'}</div>
          <p class="agent-summary">${escapeHtml(roleLine)}</p>
          ${plannerSummary ? `<p class="agent-summary"><strong>Planner:</strong> ${escapeHtml(plannerSummary)}</p>` : ''}
          ${plannerNext.length ? `<p class="agent-summary"><strong>Next roles:</strong> ${escapeHtml(plannerNext.join(', '))}</p>` : ''}
          ${plannerBlockers.length ? `<p class="error-text">${escapeHtml(plannerBlockers.join(' | '))}</p>` : ''}
          ${conflicts ? `<details class="agent-details conflict-details" open><summary>Conflicts <span>${(mission.conflicts || []).length}</span></summary><ol>${conflicts}</ol></details>` : ''}
          ${waves ? `<details class="agent-details"><summary>Parallel waves <span>${(mission.waves || []).length}</span></summary><ol>${waves}</ol></details>` : ''}
          ${mission.error ? `<p class="error-text">${escapeHtml(mission.error)}</p>` : ''}
          <div class="actions agent-actions">
            <button data-command="runSwarmMission" data-mission-id="${escapeHtml(mission.id)}" ${running ? 'disabled' : ''}>Run Swarm</button>
            ${running ? `<button data-command="cancelSwarmMission" data-mission-id="${escapeHtml(mission.id)}">Cancel Swarm</button>` : ''}
            <button class="primary-action" data-command="reviewSwarmMission" data-mission-id="${escapeHtml(mission.id)}">Review Mission</button>
          </div>
        </div>`;
      }).join('')
      : '<section class="empty"><strong>No swarm missions yet.</strong><p>Create a role-based squad to split production work across isolated agents.</p></section>';
    return `<section class="card mission-control">
      <div class="card-title">Mission Control</div>
      <div class="mission-summary">${queueSummary}</div>
      <div class="actions"><button class="primary-action" data-command="openMissionControl">Open Mission Control</button><button class="primary-action" data-command="createSwarmMission">Create Agent Swarm</button><button data-command="createBackgroundAgent">Create Solo Agent</button><button data-command="refresh">Refresh</button></div>
      ${missionRows}
      ${rows}
    </section>`;
  }

  renderMcpPanel() {
    const rows = this.mcpServers.length
      ? this.mcpServers
          .map(
            (server) => `<div class="list-row">
              <div><strong>${escapeHtml(server.name)}</strong><p>${escapeHtml(server.transport)} ${escapeHtml(server.command || server.url || '')}</p><small>${escapeHtml(server.error || `${(server.tools || []).length} tool(s)`)}</small>
                ${(server.tools || []).length ? `<div class="tool-list">${(server.tools || []).map((tool) => `<div class="tool-row">
                  <span>${escapeHtml(tool.name)}${tool.description ? ` - ${escapeHtml(String(tool.description).slice(0, 140))}` : ''}</span>
                  <button data-command="${tool.enabled ? 'disableMcpTool' : 'enableMcpTool'}" data-server-name="${escapeHtml(server.name)}" data-tool-name="${escapeHtml(tool.name)}">${tool.enabled ? 'Disable' : 'Enable'}</button>
                </div>`).join('')}</div>` : ''}
              </div>
              <span>${escapeHtml(server.status)}</span>
            </div>`,
          )
          .join('')
      : '<section class="empty"><strong>No MCP servers configured.</strong><p>Add servers in Settings under neura.mcp.servers. Tool execution will use approval cards when enabled.</p></section>';
    const cards = (this.state.mcpCards || [])
      .slice(0, 12)
      .map((card) => `<div class="terminal-card">
        <div class="file-head"><strong>${escapeHtml(card.serverName)} / ${escapeHtml(card.toolName)}</strong><span>${escapeHtml(card.status)}</span></div>
        <p class="muted">Policy: ${escapeHtml(card.policyDecision || 'ask')} ${card.policyReason ? `- ${escapeHtml(card.policyReason)}` : ''}</p>
        <pre>${escapeHtml(JSON.stringify(redactSecrets(card.args || {}), null, 2))}</pre>
        ${card.error ? `<p class="error-text">${escapeHtml(card.error)}</p>` : ''}
        ${card.result ? `<pre>${escapeHtml(JSON.stringify(redactSecrets(card.result), null, 2).slice(0, 3000))}</pre>` : ''}
        ${(card.audit || []).length ? `<details class="agent-details"><summary>Audit <span>${card.audit.length}</span></summary><ol>${card.audit.map((entry) => `<li><span>${escapeHtml(entry.event)}</span><small>${escapeHtml(new Date(entry.at).toLocaleString())}</small>${entry.error ? `<p class="error-text">${escapeHtml(entry.error)}</p>` : ''}${entry.policyReason ? `<p>${escapeHtml(entry.policyReason)}</p>` : ''}</li>`).join('')}</ol></details>` : ''}
        ${card.status === 'pending' ? `<div class="actions"><button data-command="executeMcpCard" data-mcp-card-id="${escapeHtml(card.id)}">Approve Tool</button><button data-command="rejectMcpCard" data-mcp-card-id="${escapeHtml(card.id)}">Reject</button></div>` : ''}
      </div>`)
      .join('');
    return `<section class="card"><div class="card-title">MCP Servers</div>${rows}<div class="actions"><button data-command="promptMcpToolCall">New Tool Card</button><button data-command="openSettings">Configure MCP</button><button data-command="refresh">Refresh</button></div>${cards}</section>`;
  }

  renderPluginsPanel() {
    const rows = this.plugins.length
      ? this.plugins
          .map(
            (plugin) => `<div class="list-row">
              <div><strong>${escapeHtml(plugin.name)}</strong><p>${escapeHtml(plugin.description)}</p><small>${escapeHtml(plugin.sandbox || 'restricted-api')}</small>${plugin.capabilities && Object.keys(plugin.capabilities).length ? `<pre>${escapeHtml(JSON.stringify(plugin.capabilities, null, 2).slice(0, 1000))}</pre>` : ''}${plugin.error ? `<p class="error-text">${escapeHtml(plugin.error)}</p>` : ''}</div>
              <div class="actions">
                <span>${escapeHtml(plugin.trusted ? 'trusted' : 'disabled')} - ${escapeHtml(plugin.version)}${plugin.permissions?.length ? ` - ${escapeHtml(plugin.permissions.join(', '))}` : ''}</span>
                ${plugin.trusted ? `<button data-command="untrustPlugin" data-plugin-name="${escapeHtml(plugin.name)}">Disable</button>` : `<button data-command="trustPlugin" data-plugin-name="${escapeHtml(plugin.name)}">Trust</button>`}
                <button data-command="removePlugin" data-plugin-name="${escapeHtml(plugin.name)}">Remove</button>
              </div>
            </div>`,
          )
          .join('')
      : '<section class="empty"><strong>No plugins installed.</strong><p>Install local or Git plugins only from sources you trust. Neura keeps them disabled until you explicitly trust them.</p></section>';
    return `<section class="card"><div class="card-title">Plugins</div>${rows}<div class="actions"><button data-command="installPlugin">Install Plugin</button><button data-command="refresh">Refresh</button></div></section>`;
  }

  renderWorktreesPanel() {
    const rows = this.worktrees.length
      ? this.worktrees
          .map(
            (tree) => `<div class="list-row">
              <div><strong>${escapeHtml(tree.branch || '(detached)')}</strong><p>${escapeHtml(tree.path)}</p><code>${escapeHtml((tree.commit || '').slice(0, 12))}</code></div>
              <div class="actions">
                <button data-command="openWorktree" data-worktree-path="${escapeHtml(tree.path)}">Open</button>
                <button data-command="removeWorktree" data-worktree-path="${escapeHtml(tree.path)}">Remove</button>
              </div>
            </div>`,
          )
          .join('')
      : '<section class="empty"><strong>No Git worktrees found.</strong><p>Create a worktree from the command palette or this panel.</p></section>';
    return `<section class="card"><div class="card-title">Git Worktrees</div>${rows}<div class="actions"><button data-command="addWorktree">Add Worktree</button><button data-command="refresh">Refresh</button></div></section>`;
  }

  missionArtifacts(mission) {
    const agentIds = new Set(mission.agentIds || []);
    return (this.state.artifacts || [])
      .filter((artifact) => artifact.data?.missionId === mission.id || agentIds.has(artifact.data?.agentId) || agentIds.has(artifact.data?.sourceAgentId))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  missionApprovals(mission) {
    const agentIds = new Set(mission.agentIds || []);
    const proposals = (this.state.proposals || [])
      .filter((proposal) => agentIds.has(proposal.sourceAgentId) || proposal.data?.missionId === mission.id)
      .filter((proposal) => proposal.status === 'proposed' || proposal.status === 'partially_applied')
      .map((proposal) => ({
        kind: 'merge',
        id: proposal.id,
        title: proposal.summary,
        detail: `${(proposal.edits || []).length} file(s), ${(proposal.commands || []).length} command(s)`,
        command: 'applyProposal',
        proposalId: proposal.id,
      }));
    const mcpCards = (this.state.mcpCards || [])
      .filter((card) => card.status === 'pending')
      .map((card) => ({
        kind: 'mcp',
        id: card.id,
        title: `${card.serverName}/${card.toolName}`,
        detail: 'MCP tool waiting for approval',
        command: 'executeMcpCard',
        mcpCardId: card.id,
      }));
    return [...proposals, ...mcpCards].slice(0, 12);
  }

  renderMissionControlTimeline(mission, agents, artifacts) {
    const events = [
      ...(mission.events || []).map((event) => ({
        at: event.at,
        label: event.event,
        summary: event.details?.error || event.details?.summary || '',
        type: 'mission',
      })),
      ...agents.flatMap((agent) => (agent.events || []).slice(0, 8).map((event) => ({
        at: event.at,
        label: `${agent.roleLabel || 'Agent'}: ${event.event}`,
        summary: event.error || event.summary || '',
        type: agent.status,
      }))),
      ...artifacts.slice(0, 16).map((artifact) => ({
        at: artifact.createdAt,
        label: artifact.title,
        summary: artifact.summary,
        type: artifact.kind,
      })),
    ]
      .filter((event) => event.at)
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, 28);
    return events.length
      ? events.map((event) => `<li><span>${escapeHtml(new Date(event.at).toLocaleString())}</span><strong>${escapeHtml(event.label)}</strong>${event.summary ? `<p>${escapeHtml(event.summary)}</p>` : ''}</li>`).join('')
      : '<li><span>Waiting</span><strong>No activity yet</strong><p>Create or run a swarm mission to start the timeline.</p></li>';
  }

  renderMissionControlAgent(agent) {
    const inbox = (agent.followUps || [])
      .slice(-4)
      .map((item) => `<li>${escapeHtml(item.content)}<span>${escapeHtml(new Date(item.createdAt || item.at || agent.updatedAt || nowIso()).toLocaleString())}</span></li>`)
      .join('');
    const events = (agent.events || [])
      .slice(0, 5)
      .map((event) => `<li><strong>${escapeHtml(event.event)}</strong>${event.summary ? `<p>${escapeHtml(event.summary)}</p>` : ''}${event.error ? `<p class="danger">${escapeHtml(event.error)}</p>` : ''}</li>`)
      .join('');
    const verification = (agent.verification || [])
      .slice(-3)
      .map((item) => `<li><strong>${escapeHtml(item.status)}</strong><code>${escapeHtml(item.command || '')}</code></li>`)
      .join('');
    const browserEvidence = agent.browserEvidence
      ? `<div class="note">
          <strong>Browser evidence</strong>
          <p>${escapeHtml(agent.browserEvidence.summary || '')}</p>
          ${agent.browserEvidence.screenshotPath ? `<code>${escapeHtml(agent.browserEvidence.screenshotPath)}</code>` : ''}
          ${agent.browserEvidence.recordingPath ? `<code>${escapeHtml(agent.browserEvidence.recordingPath)}</code>` : ''}
        </div>`
      : '';
    const running = ['queued', 'running', 'cancelling'].includes(agent.status);
    const canReview = ['completed', 'failed', 'cancelled', 'interrupted'].includes(agent.status);
    return `<article class="mc-agent">
      <div class="mc-agent-head">
        <div>
          <strong>${escapeHtml(agent.roleLabel || 'Agent')}</strong>
          <span>${escapeHtml(agent.squad || 'Solo')} / ${escapeHtml(agent.status || 'ready')}</span>
        </div>
        <span class="status ${escapeHtml(agent.status || 'ready')}">${escapeHtml(agent.status || 'ready')}</span>
      </div>
      <p>${escapeHtml(agent.task || '')}</p>
      <code>${escapeHtml(agent.branch || agent.path || '')}</code>
      ${agent.summary ? `<div class="note">${escapeHtml(agent.summary)}</div>` : ''}
      ${browserEvidence}
      ${agent.error ? `<div class="note danger">${escapeHtml(agent.error)}</div>` : ''}
      <div class="mc-mini-grid">
        <section><h4>Inbox</h4><ul>${inbox || '<li>No follow-ups yet.</li>'}</ul></section>
        <section><h4>Live log</h4><ul>${events || '<li>No log events yet.</li>'}</ul></section>
        <section><h4>Verification</h4><ul>${verification || '<li>No verification evidence yet.</li>'}</ul></section>
      </div>
      <div class="actions">
        <button data-command="runBackgroundAgent" data-agent-id="${escapeHtml(agent.id)}" ${running ? 'disabled' : ''}>Run</button>
        ${running ? `<button data-command="cancelBackgroundAgent" data-agent-id="${escapeHtml(agent.id)}">Cancel</button>` : ''}
        <button data-command="followUpBackgroundAgent" data-agent-id="${escapeHtml(agent.id)}">Send follow-up</button>
        <button data-command="openBackgroundAgent" data-agent-id="${escapeHtml(agent.id)}">Take over</button>
        ${canReview ? `<button class="primary" data-command="reviewBackgroundAgent" data-agent-id="${escapeHtml(agent.id)}">Queue merge review</button>` : ''}
        ${agent.logFile ? `<button data-command="openBackgroundAgentLog" data-agent-id="${escapeHtml(agent.id)}">Open log</button>` : ''}
      </div>
    </article>`;
  }

  renderMissionPlannerCard(mission) {
    const graph = mission.taskGraph;
    if (!graph) {
      return `<section class="mc-card planner-card">
        <h3>Planner Controller</h3>
        <p>No controller graph has been created yet.</p>
      </section>`;
    }
    const latest = graph.updates?.[0];
    const items = (graph.items || [])
      .slice(0, 12)
      .map((item) => `<li>
        <div>
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.handoff || item.rationale || '')}</p>
          ${item.acceptance ? `<small>${escapeHtml(item.acceptance)}</small>` : ''}
        </div>
        <span>${escapeHtml(item.ownerRole || 'shared')} / ${escapeHtml(item.status || 'pending')}</span>
      </li>`)
      .join('');
    const nextRoles = graph.nextRoles?.length
      ? graph.nextRoles.map((roleId) => `<span>${escapeHtml(roleId)}</span>`).join('')
      : '<p>No role preference. Dependency-ready agents may run.</p>';
    const blockers = graph.blockedReasons?.length
      ? `<div class="note danger">${escapeHtml(graph.blockedReasons.join(' | '))}</div>`
      : '';
    const risks = graph.risks?.length
      ? `<div class="note">${escapeHtml(graph.risks.join(' | '))}</div>`
      : '';
    return `<section class="mc-card planner-card">
      <div class="planner-head">
        <div>
          <h3>Planner Controller</h3>
          <p>${escapeHtml(latest?.summary || 'Controller is supervising the mission.')}</p>
        </div>
        <span class="status ${escapeHtml(graph.controllerStatus || graph.status || 'running')}">v${escapeHtml(graph.version || 1)} ${escapeHtml(graph.controllerStatus || graph.status || 'running')}</span>
      </div>
      <div class="planner-next">${nextRoles}</div>
      ${blockers}
      ${risks}
      <ol class="planner-list">${items || '<li><div><strong>No tasks yet</strong><p>Run the swarm to generate a controller graph.</p></div><span>waiting</span></li>'}</ol>
    </section>`;
  }

  renderMissionControlMission(mission) {
    const agents = (this.state.backgroundAgents || []).filter((agent) => mission.agentIds?.includes(agent.id));
    const artifacts = this.missionArtifacts(mission);
    const approvals = this.missionApprovals(mission);
    const browserEvidence = artifacts.filter((artifact) => artifact.kind === 'preview' || artifact.kind === 'browser' || artifact.kind === 'browser-verify' || artifact.kind === 'browser-agent');
    const conflicts = (mission.conflicts || [])
      .map((conflict) => `<li><strong>${escapeHtml(conflict.filePath)}</strong><span>${escapeHtml((conflict.owners || []).map((owner) => owner.roleLabel || owner.roleId).join(' vs '))}</span></li>`)
      .join('');
    return `<section class="mc-mission">
      <div class="mc-mission-head">
        <div>
          <div class="eyebrow">Swarm Mission</div>
          <h2>${escapeHtml(mission.task || 'Untitled mission')}</h2>
          <p>${escapeHtml(mission.id)}</p>
        </div>
        <span class="status ${escapeHtml(mission.status || 'ready')}">${escapeHtml(mission.status || 'ready')}</span>
      </div>
      ${mission.error ? `<div class="note danger">${escapeHtml(mission.error)}</div>` : ''}
      <div class="mc-stat-row">
        ${['ready', 'queued', 'running', 'completed', 'blocked', 'failed', 'cancelled', 'interrupted'].map((status) => {
          const count = agents.filter((agent) => agent.status === status).length;
          return count ? `<span>${escapeHtml(status)} <strong>${count}</strong></span>` : '';
        }).join('')}
        <span>artifacts <strong>${artifacts.length}</strong></span>
        <span>approvals <strong>${approvals.length}</strong></span>
      </div>
      <div class="actions">
        <button class="primary" data-command="runSwarmMission" data-mission-id="${escapeHtml(mission.id)}">Run Swarm</button>
        <button data-command="cancelSwarmMission" data-mission-id="${escapeHtml(mission.id)}">Cancel</button>
        <button data-command="reviewSwarmMission" data-mission-id="${escapeHtml(mission.id)}">Create Merge Queue</button>
        <button data-command="exportProofBundle">Export Proof Bundle</button>
      </div>
      ${this.renderMissionPlannerCard(mission)}
      <div class="mc-layout">
        <section class="mc-card wide">
          <h3>Live Timeline</h3>
          <ol class="timeline">${this.renderMissionControlTimeline(mission, agents, artifacts)}</ol>
        </section>
        <section class="mc-card">
          <h3>Approval Queue</h3>
          <div class="approval-list">
            ${approvals.length ? approvals.map((item) => `<div class="approval">
              <div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p><code>${escapeHtml(item.kind)}</code></div>
              <button class="primary" data-command="${escapeHtml(item.command)}" data-proposal-id="${escapeHtml(item.proposalId || '')}" data-mcp-card-id="${escapeHtml(item.mcpCardId || '')}">Approve</button>
            </div>`).join('') : '<p>No pending approvals.</p>'}
          </div>
        </section>
        <section class="mc-card">
          <h3>Artifacts</h3>
          ${artifacts.length ? artifacts.slice(0, 10).map((artifact) => `<div class="artifact"><strong>${escapeHtml(artifact.title)}</strong><p>${escapeHtml(artifact.summary || '')}</p><code>${escapeHtml(artifact.kind)}</code></div>`).join('') : '<p>No artifacts yet.</p>'}
        </section>
        <section class="mc-card">
          <h3>Browser Verification</h3>
          ${browserEvidence.length ? browserEvidence.slice(0, 8).map((artifact) => `<div class="artifact"><strong>${escapeHtml(artifact.title)}</strong><p>${escapeHtml(artifact.summary || '')}</p>${artifact.data?.screenshotPath ? `<code>${escapeHtml(artifact.data.screenshotPath)}</code>` : ''}</div>`).join('') : '<p>No browser proof yet.</p>'}
        </section>
        ${conflicts ? `<section class="mc-card danger-card"><h3>Conflict Blockers</h3><ul>${conflicts}</ul></section>` : ''}
      </div>
      <section class="mc-agent-grid">
        ${agents.length ? agents.map((agent) => this.renderMissionControlAgent(agent)).join('') : '<p>No role agents are attached.</p>'}
      </section>
    </section>`;
  }

  renderMissionControl() {
    const missions = this.state.swarmMissions || [];
    const agents = this.state.backgroundAgents || [];
    const running = agents.filter((agent) => ['queued', 'running', 'cancelling'].includes(agent.status));
    const approvals = (this.state.proposals || []).filter((proposal) => proposal.status === 'proposed' || proposal.status === 'partially_applied');
    const artifacts = this.state.artifacts || [];
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #0f0f10; color: #f4f4f5; font: 13px/1.45 var(--vscode-font-family); }
    button { border: 1px solid #323238; border-radius: 7px; background: #17171a; color: #e8e8ec; padding: 6px 9px; font: inherit; cursor: pointer; }
    button:hover { background: #242428; }
    button:disabled { opacity: .45; cursor: not-allowed; }
    button.primary, .primary { background: #f4f4f5; color: #101012; border-color: #f4f4f5; }
    code { display: inline-block; max-width: 100%; padding: 2px 5px; border: 1px solid #303037; border-radius: 5px; color: #d7e8ff; background: #111114; overflow-wrap: anywhere; }
    p { margin: 4px 0 0; color: #a8a8b0; }
    .mc-shell { min-height: 100vh; display: flex; flex-direction: column; }
    .mc-top { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 18px; background: #0f0f10; border-bottom: 1px solid #25252a; }
    .mc-top h1 { margin: 0; font-size: 16px; }
    .mc-top p { margin: 2px 0 0; }
    .mc-actions { display: flex; flex-wrap: wrap; gap: 7px; justify-content: flex-end; }
    .mc-overview { display: grid; grid-template-columns: repeat(4, minmax(140px, 1fr)); gap: 10px; padding: 14px 18px 0; }
    .mc-stat, .mc-card, .mc-mission, .mc-agent { border: 1px solid #28282f; border-radius: 12px; background: #161619; }
    .mc-stat { padding: 12px; }
    .mc-stat span { color: #92929c; font-size: 11px; text-transform: uppercase; }
    .mc-stat strong { display: block; margin-top: 3px; font-size: 22px; }
    .mc-feed { display: flex; flex-direction: column; gap: 14px; padding: 14px 18px 24px; }
    .mc-mission { padding: 14px; }
    .mc-mission-head, .mc-agent-head, .approval { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; }
    .eyebrow { color: #888892; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
    h2, h3, h4 { margin: 0; color: #f4f4f5; }
    h2 { font-size: 16px; }
    h3 { font-size: 13px; margin-bottom: 9px; }
    h4 { font-size: 11px; color: #bdbdc5; text-transform: uppercase; letter-spacing: .04em; }
    .status { border: 1px solid #34343b; border-radius: 999px; padding: 4px 8px; color: #c9c9d1; font-size: 10px; text-transform: uppercase; }
    .status.running, .status.queued, .status.cancelling, .status.blocked { color: #fde68a; border-color: #5f4b1b; }
    .status.completed { color: #86efac; border-color: #235c35; }
    .status.failed, .status.cancelled, .status.interrupted { color: #fca5a5; border-color: #693030; }
    .mc-stat-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
    .mc-stat-row span { border: 1px solid #303037; border-radius: 999px; padding: 3px 8px; color: #a8a8b0; font-size: 11px; text-transform: uppercase; }
    .actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 12px; }
    .planner-card { margin-top: 14px; }
    .planner-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
    .planner-next { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .planner-next span { border: 1px solid #303037; border-radius: 999px; padding: 3px 8px; color: #d7e8ff; font-size: 11px; }
    .planner-list { margin: 10px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 7px; }
    .planner-list li { display: flex; justify-content: space-between; gap: 12px; margin: 0; border-top: 1px solid #28282f; padding-top: 8px; }
    .planner-list li:first-child { border-top: 0; padding-top: 0; }
    .planner-list strong { color: #f4f4f5; }
    .planner-list small { display: block; color: #85858e; margin-top: 3px; }
    .planner-list span { flex: 0 0 auto; color: #a8a8b0; font-size: 11px; text-transform: uppercase; }
    .mc-layout { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(280px, .85fr); gap: 12px; margin-top: 14px; }
    .mc-card { padding: 12px; min-width: 0; }
    .mc-card.wide { grid-row: span 2; }
    .timeline { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
    .timeline li { border-left: 2px solid #34343b; padding: 2px 0 8px 10px; }
    .timeline span { color: #777781; font-size: 11px; }
    .timeline strong { display: block; margin-top: 2px; color: #e8e8ec; }
    .approval, .artifact { border-top: 1px solid #28282f; padding: 9px 0; }
    .approval:first-child, .artifact:first-child { border-top: 0; padding-top: 0; }
    .mc-agent-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 10px; margin-top: 14px; }
    .mc-agent { padding: 12px; }
    .mc-agent-head strong { display: block; }
    .mc-agent-head span:not(.status) { color: #8f8f99; font-size: 11px; }
    .note { margin-top: 8px; border-left: 2px solid #32323a; padding-left: 8px; color: #cfcfd5; }
    .danger, .danger-card, .note.danger { color: #fca5a5; }
    .danger-card { border-color: #693030; }
    .mc-mini-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 10px; }
    .mc-mini-grid section { border: 1px solid #28282f; border-radius: 9px; padding: 8px; min-width: 0; }
    ul, ol { margin: 6px 0 0; padding-left: 18px; }
    li { margin: 5px 0; color: #cfcfd5; }
    li span { display: block; color: #85858e; font-size: 11px; }
    @media (max-width: 900px) {
      .mc-overview, .mc-layout, .mc-mini-grid { grid-template-columns: 1fr; }
      .mc-top, .mc-mission-head, .mc-agent-head, .approval { flex-direction: column; align-items: stretch; }
    }
  </style>
</head>
<body>
  <div class="mc-shell">
    <header class="mc-top">
      <div>
        <h1>Neura Mission Control</h1>
        <p>${escapeHtml(this.projectName)} / ${escapeHtml(this.rootPath || 'No workspace')}</p>
      </div>
      <div class="mc-actions">
        <button class="primary" data-command="createSwarmMission">New Swarm</button>
        <button data-command="createBackgroundAgent">Solo Agent</button>
        <button data-command="exportProofBundle">Export Proof</button>
        <button data-command="refresh">Refresh</button>
      </div>
    </header>
    <section class="mc-overview">
      <div class="mc-stat"><span>Missions</span><strong>${missions.length}</strong></div>
      <div class="mc-stat"><span>Running agents</span><strong>${running.length}</strong></div>
      <div class="mc-stat"><span>Pending approvals</span><strong>${approvals.length}</strong></div>
      <div class="mc-stat"><span>Artifacts</span><strong>${artifacts.length}</strong></div>
    </section>
    <main class="mc-feed">
      ${missions.length ? missions.map((mission) => this.renderMissionControlMission(mission)).join('') : '<section class="mc-card"><h2>No missions yet</h2><p>Create an agent swarm to plan, build, verify, and review work across isolated role agents.</p><div class="actions"><button class="primary" data-command="createSwarmMission">Create Agent Swarm</button></div></section>'}
    </main>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    function postFrom(element) {
      vscode.postMessage({
        command: element.dataset.command,
        agentId: element.dataset.agentId,
        missionId: element.dataset.missionId,
        proposalId: element.dataset.proposalId,
        mcpCardId: element.dataset.mcpCardId
      });
    }
    document.querySelectorAll('[data-command]').forEach((element) => {
      element.addEventListener('click', () => postFrom(element));
    });
  </script>
</body>
</html>`;
  }

  render(isBusy = false) {
    const mode = this.state.mode || 'agent';
    const configured = this.config.configured;
    const modeLabel = modeLabels[mode] || 'Edit';
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #171717; color: #f4f4f5; font: 13px/1.45 var(--vscode-font-family); }
    .shell { height: 100vh; display: flex; flex-direction: column; }
    header { height: 40px; display: flex; align-items: center; justify-content: space-between; padding: 0 10px; background: #171717; border-bottom: 1px solid #2a2a2a; }
    h1 { margin: 0; font-size: 13px; font-weight: 500; letter-spacing: 0; }
    .top-actions { display: flex; align-items: center; gap: 4px; }
    .icon-button { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 5px; background: transparent; color: #c8c8c8; padding: 0; font-size: 18px; }
    .icon-button:hover { background: #242424; border: 0; }
    .status { color: ${configured ? '#86efac' : '#fca5a5'}; }
    button, select { border: 1px solid transparent; border-radius: 6px; background: transparent; color: #d7d7d7; padding: 5px 7px; font: inherit; cursor: pointer; }
    button:hover, select:hover { background: #303030; }
    button.active { background: #f4f4f5; color: #050505; border-color: #f4f4f5; }
    button:disabled { cursor: not-allowed; opacity: .5; }
    select { max-width: 158px; background: transparent; }
    main { flex: 1; overflow: auto; padding: 14px 12px 12px; display: flex; flex-direction: column; gap: 10px; }
    .empty, .message, .card, .context { border: 1px solid #2c2c2c; border-radius: 8px; background: #1c1c1f; padding: 10px; }
    .empty { margin-top: auto; border: 0; background: transparent; color: #a1a1aa; padding: 0 6px; }
    .empty p, p { margin: 6px 0 0; color: #d4d4d8; white-space: pre-wrap; }
    .message.user { background: #202020; }
    .message.assistant { background: #1b1b1b; }
    .message-top, .card-title, .file-head, .checkpoint { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
    .message-top span, small, .file-head span { color: #a1a1aa; font-size: 11px; text-transform: uppercase; }
    code { display: inline-block; max-width: 100%; margin: 4px 4px 0 0; padding: 2px 5px; border: 1px solid #393939; border-radius: 5px; background: #151515; color: #d6e7ff; font-size: 11px; overflow-wrap: anywhere; }
    pre { max-height: 180px; overflow: auto; white-space: pre-wrap; color: #d4d4d8; background: #121212; border: 1px solid #2c2c2c; border-radius: 6px; padding: 8px; }
    .context { color: #a1a1aa; padding: 7px 9px; }
    .context strong { color: #f4f4f5; margin-right: 6px; }
    .chip { padding: 2px 5px; margin: 2px 4px 2px 0; font-size: 11px; background: #252525; border: 1px solid #333; }
    .todo, .file-card, .terminal-card, .preview-card, .checkpoint { border-top: 1px solid #2c2c2c; margin-top: 10px; padding-top: 10px; }
    .todo { display: grid; grid-template-columns: 70px 1fr; gap: 8px; }
    .todo span { color: #a1a1aa; font-size: 11px; text-transform: uppercase; }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    footer { padding: 12px 10px 14px; background: #171717; }
    .project-name { color: #f5f5f5; font-size: 14px; font-weight: 700; margin: 0 0 8px 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .composer { border: 1px solid #303030; border-radius: 18px; background: #242426; padding: 8px; box-shadow: 0 1px 0 rgba(255,255,255,.03) inset; }
    textarea { width: 100%; min-height: 48px; max-height: 160px; resize: vertical; border: 0; outline: 0; background: transparent; color: #f4f4f5; padding: 8px; font: inherit; }
    .bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 4px; }
    .bar-left, .bar-right { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
    .send { width: 32px; height: 32px; border-radius: 50%; background: #3a3a3d; }
    .send:hover { background: #4a4a4d; }
    .workflow-menu { display: none; position: absolute; bottom: 84px; left: 14px; width: 220px; border: 1px solid #2f2f2f; border-radius: 10px; background: #181818; padding: 6px; box-shadow: 0 10px 30px rgba(0,0,0,.25); }
    .workflow-menu button { display: block; width: 100%; text-align: left; padding: 8px; }
    .attachment-row { display: none; flex-wrap: wrap; gap: 5px; padding: 0 4px 5px; }
    .attachment-row .chip { background: #303033; color: #e5e5e5; }
    #mentions { display: none; max-height: 160px; overflow: auto; margin-top: 6px; border: 1px solid #2f2f2f; border-radius: 10px; background: #181818; padding: 6px; }
    #mentions button { display: block; width: 100%; text-align: left; border: 0; background: transparent; color: #d4d4d8; overflow: hidden; text-overflow: ellipsis; }
    .fine-print { color: #7a7a7a; font-size: 11px; margin: 10px 0 0 6px; }
    .hidden { display: none; }
    .message-body p { margin: 6px 0 0; }
    .message-body pre { overflow: auto; background: #111; border: 1px solid #333; border-radius: 6px; padding: 8px; }
    .message-body h1, .message-body h2, .message-body h3 { margin: 8px 0 4px; font-size: 13px; }
    .thinking { margin: 0 6px 8px; color: #a1a1aa; font-size: 12px; }
    .thinking summary { cursor: pointer; list-style: none; }
    .thinking summary::-webkit-details-marker { display: none; }
    .thinking summary span { color: #71717a; margin-left: 6px; }
    .thinking pre { margin: 7px 0 0; max-height: 160px; font-size: 11px; color: #bdbdc2; background: #121212; border-color: #262626; }
    .thinking-steps { margin: 8px 0 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
    .thinking-steps li { border: 1px solid #27272b; border-radius: 8px; background: #151517; padding: 8px; }
    .thinking-steps li.running { border-color: #3d3d46; }
    .thinking-steps li.failed { border-color: #5d2626; }
    .thinking-steps div { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .thinking-steps strong { color: #dedee4; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
    .thinking-steps span, .thinking-steps small { color: #777781; font-size: 10px; text-transform: uppercase; }
    .thinking-steps p { margin: 4px 0 0; color: #bdbdc4; font-size: 11px; }
    .thinking-steps small { display: block; margin-top: 4px; text-transform: none; line-height: 1.35; }
    .task-graph { margin: 9px 0 0; border: 1px solid #29292f; border-radius: 10px; background: #151518; padding: 10px; }
    .task-graph-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
    .task-graph-head strong { color: #f1f1f3; font-size: 12px; }
    .task-graph-head span { color: #8d8d98; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
    .task-graph > p { color: #bdbdc5; margin: 6px 0 0; }
    .task-graph ol { margin: 9px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
    .task-graph li { border-left: 2px solid #3a3a42; padding: 6px 0 6px 9px; }
    .task-graph li.running { border-left-color: #facc15; }
    .task-graph li.done { border-left-color: #86efac; }
    .task-graph li.blocked, .task-graph li.failed { border-left-color: #fca5a5; }
    .task-graph li div { display: flex; justify-content: space-between; gap: 10px; }
    .task-graph li strong { color: #e8e8ec; font-size: 12px; }
    .task-graph li span { color: #9aa8d8; font-size: 10px; text-transform: uppercase; }
    .task-graph li p { color: #a5a5ae; margin: 3px 0 0; }
    .task-graph li small { color: #80808a; display: block; margin-top: 3px; text-transform: none; }
    .task-graph details { margin-top: 8px; color: #9a9aa3; }
    .task-graph ul { margin: 6px 0 0 16px; padding: 0; }
    .task-graph ul li { border-left: 0; padding: 2px 0; color: #a8a8b0; }
    .task-graph ul span { color: #c8c8cf; margin-right: 5px; }
    .message { border: 0 !important; background: transparent !important; padding: 4px 6px 12px; border-radius: 0; }
    .message.user { align-self: flex-end; max-width: 88%; background: #242426 !important; border-radius: 16px !important; padding: 9px 12px; }
    .message.assistant { align-self: stretch; padding-left: 8px; }
    .message-top { justify-content: flex-start; gap: 8px; margin-bottom: 3px; }
    .message-top strong { color: #f5f5f5; font-size: 12px; }
    .message-top span { color: #8f8f98; font-size: 10px; }
    .message.user .message-top { display: none; }
    .message.user .message-body p { margin: 0; }
    .message.assistant .message-body { color: #e8e8ea; }
    .message.assistant .message-body p { line-height: 1.55; }
    main { gap: 8px; }
    .tabs { display: flex; gap: 2px; border-bottom: 1px solid #2a2a2a; padding: 0 8px; background: #171717; }
    .tab { border-radius: 0; padding: 8px 9px; border-bottom: 2px solid transparent; color: #a1a1aa; }
    .tab.active { background: transparent; color: #fff; border-color: #e5e5e5; }
    .list-row { display: flex; justify-content: space-between; gap: 10px; border-top: 1px solid #2c2c2c; padding: 10px 0; }
    .list-row:first-of-type { border-top: 0; }
    .list-row p { color: #a1a1aa; word-break: break-all; }
    .mission-control { display: flex; flex-direction: column; gap: 10px; }
    .queue-panel { display: flex; flex-direction: column; gap: 8px; }
    .queue-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; border-top: 1px solid #29292d; padding-top: 8px; }
    .queue-row:first-of-type { border-top: 0; padding-top: 0; }
    .queue-row strong { color: #f4f4f5; font-size: 12px; }
    .queue-row p { margin: 3px 0 2px; color: #d4d4da; }
    .queue-row small { color: #85858e; text-transform: none; }
    .continuation-row { border-left: 1px solid #3b3b44; padding-left: 10px; }
    .mission-summary { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .agent-pill { border: 1px solid #33333a; border-radius: 999px; padding: 3px 8px; color: #c9c9d1; font-size: 11px; text-transform: uppercase; }
    .agent-pill.running, .agent-pill.queued, .agent-pill.cancelling, .agent-pill.blocked { color: #fde68a; border-color: #5f4b1b; }
    .agent-pill.completed { color: #86efac; border-color: #235c35; }
    .agent-pill.failed, .agent-pill.cancelled, .agent-pill.interrupted { color: #fca5a5; border-color: #693030; }
    .agent-card { border: 1px solid #2c2c31; border-radius: 12px; background: #151517; padding: 12px; }
    .agent-card-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
    .agent-title { color: #f5f5f5; font-weight: 700; line-height: 1.35; }
    .agent-card p { color: #9f9fa8; margin: 5px 0 0; word-break: break-all; }
    .agent-status { flex: 0 0 auto; border: 1px solid #34343a; border-radius: 999px; padding: 3px 8px; color: #c9c9d1; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
    .agent-status.running, .agent-status.queued, .agent-status.cancelling, .agent-status.blocked { color: #fde68a; border-color: #5f4b1b; }
    .agent-status.completed { color: #86efac; border-color: #235c35; }
    .agent-status.failed, .agent-status.cancelled, .agent-status.interrupted { color: #fca5a5; border-color: #693030; }
    .agent-summary, .agent-verification { color: #d7d7dc; font-size: 12px; margin-top: 8px; }
    .agent-verification { border-left: 1px solid #34343a; padding-left: 8px; color: #a8a8b0; }
    .agent-details { border-top: 1px solid #28282d; margin-top: 10px; padding-top: 8px; }
    .agent-details summary { cursor: pointer; color: #b8b8c0; font-size: 12px; }
    .agent-details summary span { color: #7d7d86; margin-left: 4px; }
    .agent-details ol { margin: 8px 0 0 18px; padding: 0; }
    .agent-details li { margin: 6px 0; color: #cfcfd4; }
    .agent-details li span { color: #e5e5e8; font-weight: 600; }
    .agent-details li small { color: #85858e; margin-left: 6px; }
    .agent-details li p { margin: 2px 0 0; }
    .conflict-details { border-color: #5f4b1b; }
    .agent-actions { margin-top: 10px; }
    button:disabled { opacity: .45; cursor: not-allowed; }
    .error-text { color: #fca5a5 !important; }
    .session-select { max-width: 190px; border: 1px solid #303030; background: #202020; color: #d7d7d7; }
    body { background: #111112; color: #f5f5f5; font-size: 13px; }
    header { height: 38px; padding: 0 12px; background: #111112; border-bottom: 1px solid #252528; }
    h1 { font-size: 12px; text-transform: uppercase; letter-spacing: .02em; color: #dcdcdc; }
    .top-actions { gap: 8px; min-width: 0; }
    .top-actions .session-select { flex: 1 1 auto; min-width: 126px; max-width: 240px; height: 30px; border-radius: 7px; background: #1f1f22; border-color: #303036; padding: 0 10px; }
    .settings-button { flex: 0 0 auto; width: 30px; height: 30px; border: 1px solid #303036; border-radius: 8px; background: #1f1f22; color: #efeff3; font-size: 15px; }
    .settings-button:hover { background: #2a2a2f; border-color: #42424a; }
    .tabs { padding: 0 12px; gap: 12px; background: #111112; border-bottom: 1px solid #252528; overflow-x: auto; flex-shrink: 0; }
    .tab { padding: 9px 0 8px; color: #8f8f98; border: 0; border-bottom: 1px solid transparent; background: transparent; }
    .tab.active { color: #ffffff; border-bottom-color: #ffffff; background: transparent; }
    main { padding: 18px 16px 14px; gap: 12px; background: #111112; }
    .message { padding: 0 0 8px; }
    .message.assistant { border-left: 1px solid #2b2b2f !important; padding-left: 12px; }
    .message.user { max-width: 80%; background: #202023 !important; border: 1px solid #2a2a2d !important; border-radius: 18px !important; padding: 8px 12px; }
    .message-top { margin-bottom: 5px; }
    .message-top strong { font-size: 12px; }
    .message-top span { color: #8e8ea0; }
    .thinking { margin: 0 0 4px 12px; border-left: 1px solid #2b2b2f; padding-left: 12px; }
    .thinking summary { color: #a6a6ad; font-size: 12px; }
    .thinking pre { border: 0; background: #18181a; color: #b7b7bd; }
    .card { border: 1px solid #29292d; border-radius: 10px; background: #18181b; }
    .artifact-preview { display: block; width: 100%; max-height: 220px; object-fit: contain; border: 1px solid #303036; border-radius: 8px; margin-top: 8px; background: #0f0f10; }
    .artifact-row { align-items: flex-start; }
    .vertical-actions { flex-direction: column; align-items: flex-end; }
    .tool-list { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
    .tool-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; border: 1px solid #2a2a30; border-radius: 8px; padding: 6px 8px; background: #141416; }
    .tool-row span { min-width: 0; overflow-wrap: anywhere; color: #d7d7dd; }
    .agent-run { border: 1px solid #29292d; border-radius: 12px; background: #18181b; overflow: hidden; }
    .run-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; padding: 14px 14px 12px; border-bottom: 1px solid #27272b; }
    .run-kicker { color: #9a9aa3; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 4px; }
    .run-head h2 { margin: 0; font-size: 14px; font-weight: 600; line-height: 1.35; color: #f3f3f3; }
    .run-status { flex: 0 0 auto; color: #b9c8ff; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; border: 1px solid #31313a; border-radius: 999px; padding: 3px 8px; }
    .run-status.applied { color: #86efac; }
    .run-status.rejected { color: #fca5a5; }
    .run-stats { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
    .run-stats span { color: #a1a1aa; border: 1px solid #303036; border-radius: 999px; padding: 2px 7px; font-size: 11px; }
    .run-steps { padding: 10px 14px; border-bottom: 1px solid #27272b; color: #d8d8dc; }
    .run-steps summary { cursor: pointer; color: #b8b8c0; font-size: 12px; }
    .run-steps summary span { color: #777781; margin-left: 6px; }
    .run-steps ol { margin: 10px 0 0 18px; padding: 0; }
    .run-steps li { margin: 7px 0; }
    .run-steps p { margin: 2px 0 0; color: #96969f; }
    .review-bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 14px; background: #1f1f22; border-bottom: 1px solid #2b2b30; }
    .review-bar strong { font-size: 12px; }
    .review-bar p { margin: 1px 0 0; color: #8e8e98; font-size: 11px; }
    .review-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
    .primary-action { background: #f4f4f5; color: #111112; border-color: #f4f4f5; }
    .primary-action:hover { background: #ffffff; color: #111112; }
    .change-list, .command-list { padding: 4px 14px 10px; }
    .change-row, .command-row, .preview-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 11px 0; border-bottom: 1px solid #27272b; }
    .change-row:last-child, .command-row:last-child { border-bottom: 0; }
    .change-main { display: flex; align-items: flex-start; gap: 9px; min-width: 0; }
    .file-icon { width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; border-radius: 5px; background: #242428; color: #d9d9df; font-size: 12px; flex: 0 0 auto; margin-top: 1px; }
    .change-main strong, .command-row strong, .preview-row strong { display: block; color: #f2f2f2; font-size: 13px; overflow-wrap: anywhere; }
    .change-main p, .command-row p, .preview-row p { margin: 3px 0 0; color: #a7a7b0; line-height: 1.4; }
    .change-side, .command-side { flex: 0 0 auto; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; max-width: 44%; }
    .change-side span, .command-side span { color: #9aa8d8; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
    .change-side div { display: flex; gap: 3px; flex-wrap: wrap; justify-content: flex-end; }
    .command-row code { margin-top: 6px; }
    .preview-row { margin: 0 14px 12px; border-bottom: 0; }
    footer { padding: 10px 12px 12px; background: #111112; border-top: 1px solid #252528; }
    .project-name { font-size: 12px; color: #dcdce2; margin-left: 2px; }
    .composer { border-radius: 18px; background: #1f1f22; border-color: #303036; padding: 10px; box-shadow: 0 0 0 1px rgba(255,255,255,.02) inset; }
    .composer:focus-within { border-color: #4a4a52; background: #222226; }
    textarea { min-height: 58px; padding: 8px 10px; color: #f7f7f8; line-height: 1.45; }
    textarea::placeholder { color: #85858d; }
    .bar { margin-top: 5px; align-items: flex-end; }
    .bar-left { gap: 6px; min-width: 0; }
    .bar-left select, .bar-left button:not(.icon-button) { height: 30px; border-radius: 8px; background: transparent; color: #e4e4e8; padding: 4px 8px; }
    .bar-left select:hover, .bar-left button:not(.icon-button):hover { background: #2b2b30; }
    select, button { color: #e1e1e6; }
    .send { width: 38px; height: 38px; border-radius: 50%; background: #f4f4f5; color: #111112; border: 0; font-size: 18px; font-weight: 700; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
    .send:hover { background: #ffffff; color: #111112; }
    .send.queue { width: auto; min-width: 54px; border-radius: 999px; font-size: 12px; padding: 0 12px; }
    .fine-print { color: #6f6f78; margin-left: 2px; }
    .settings-panel { display: flex; flex-direction: column; gap: 12px; }
    .settings-hero { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; border: 1px solid #29292d; border-radius: 12px; background: #18181b; padding: 14px; }
    .settings-hero h2 { margin: 0; font-size: 15px; color: #f5f5f5; }
    .settings-hero p, .settings-card p, .settings-note { color: #9b9ba4; margin: 5px 0 0; }
    .settings-form { display: grid; grid-template-columns: 1fr; gap: 10px; }
    .settings-card { border: 1px solid #29292d; border-radius: 12px; background: #18181b; padding: 12px; }
    .settings-card-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 10px; }
    .settings-card strong { color: #f3f3f5; font-size: 13px; }
    .provider-state { flex: 0 0 auto; border: 1px solid #34343a; border-radius: 999px; padding: 3px 8px; font-size: 10px; text-transform: uppercase; color: #c9c9d1; }
    .provider-state.ready { color: #86efac; border-color: #235c35; }
    .provider-state.missing { color: #fca5a5; border-color: #693030; }
    .settings-card label { display: flex; flex-direction: column; gap: 5px; margin-top: 9px; }
    .settings-card label span { color: #b7b7bf; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
    .settings-card input, .settings-card select { width: 100%; border: 1px solid #303036; border-radius: 8px; background: #111112; color: #f4f4f5; padding: 8px 9px; outline: 0; }
    .settings-card input:focus, .settings-card select:focus { border-color: #565660; }
    .settings-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .settings-note { font-size: 11px; }
    @media (max-width: 420px) {
      .run-head, .review-bar, .change-row, .command-row, .preview-row { flex-direction: column; align-items: stretch; }
      .change-side, .command-side { max-width: none; align-items: flex-start; }
      .review-actions, .change-side div { justify-content: flex-start; }
      .message.user { max-width: 92%; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <h1>Agent</h1>
      <div class="top-actions">
        <select class="session-select" id="sessionSelect" title="Composer session">${this.renderSessionOptions()}</select>
        <button class="icon-button settings-button" data-command="configureProviders" title="Neura settings" aria-label="Neura settings">⚙</button>
      </div>
    </header>
    ${this.renderTabs()}
    <main>
      ${
        configured
          ? ''
          : '<section class="empty"><strong>Set up an AI provider</strong><p>Neura tries OpenRouter first, then Ollama, then NVIDIA NIM. Use the gear icon to configure provider keys and models inside this panel. API keys are never shown after saving.</p><div class="actions"><button data-command="configureProviders">Open Neura Settings</button></div></section>'
      }
      ${this.renderQueuePanel()}
      ${this.renderMainPanel()}
    </main>
    <footer>
      <div class="project-name">${escapeHtml(this.projectName)}</div>
      <div class="composer">
        <div id="attachments" class="attachment-row"></div>
        <textarea id="prompt" placeholder="${configured ? (isBusy ? 'Neura is working. Send another message to queue it.' : 'Ask for code changes, @ to mention, / for workflows') : 'Configure OpenRouter, Ollama, or NIM to use the coding Composer.'}"></textarea>
        <div id="mentions">${this.renderSuggestions()}</div>
        <div id="workflows" class="workflow-menu">
          <button data-slash="/plan ">Plan implementation</button>
          <button data-slash="/reasoning high ">Reasoning high</button>
          <button data-slash="/edit ">Edit code</button>
          <button data-slash="/build ">Build app/site</button>
          <button data-slash="/explain ">Explain code</button>
          <button data-command="configureProviders">AI provider settings</button>
          <button data-command="promptMcpToolCall">MCP tool card</button>
        </div>
        <div class="bar">
          <div class="bar-left">
            <button class="icon-button" id="attachButton" title="Attach image or text">+</button>
            <select id="modelSelect" title="Active AI provider model">${this.renderModelOptions()}</select>
            <select id="reasoningSelect" title="Reasoning level">${this.renderReasoningOptions()}</select>
            <select id="permissionSelect" title="Permission mode">${this.renderPermissionOptions()}</select>
            <button id="workflowButton">${escapeHtml(modeLabel)}</button>
          </div>
          <div class="bar-right">
            <button class="send ${isBusy ? 'queue' : ''}" id="send" title="${isBusy ? 'Queue message' : 'Send'}">${isBusy ? 'Queue' : '↑'}</button>
          </div>
        </div>
      </div>
      <input class="hidden" id="fileInput" type="file" multiple accept="image/*,.txt,.md,.json,.js,.jsx,.ts,.tsx,.css,.html,.py,.rs,.go,.java,.yml,.yaml,.toml,.xml,.sql,.sh,.ps1" />
      <div class="fine-print">AI may make mistakes. Review diffs and commands before accepting.</div>
    </footer>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const currentMode = ${JSON.stringify(mode)};
    const attachments = [];
    const prompt = document.getElementById('prompt');
    const send = document.getElementById('send');
    const mentions = document.getElementById('mentions');
    const workflows = document.getElementById('workflows');
    const workflowButton = document.getElementById('workflowButton');
    const attachButton = document.getElementById('attachButton');
    const fileInput = document.getElementById('fileInput');
    const attachmentRow = document.getElementById('attachments');
    const modelSelect = document.getElementById('modelSelect');
    const reasoningSelect = document.getElementById('reasoningSelect');
    const permissionSelect = document.getElementById('permissionSelect');
    const sessionSelect = document.getElementById('sessionSelect');
    function postFrom(element) {
      vscode.postMessage({
        command: element.dataset.command,
        mode: element.dataset.mode,
        tab: element.dataset.tab,
        model: element.dataset.model,
        reasoning: element.dataset.reasoning,
        proposalId: element.dataset.proposalId,
        filePath: element.dataset.filePath,
        checkpointId: element.dataset.checkpointId,
        commandId: element.dataset.commandId,
        commandText: element.dataset.commandText,
        terminalId: element.dataset.terminalId,
        worktreePath: element.dataset.worktreePath,
        sessionId: element.dataset.sessionId,
        agentId: element.dataset.agentId,
        missionId: element.dataset.missionId,
        mcpCardId: element.dataset.mcpCardId,
        serverName: element.dataset.serverName,
        toolName: element.dataset.toolName,
        pluginName: element.dataset.pluginName,
        artifactId: element.dataset.artifactId,
        queueId: element.dataset.queueId
      });
    }
    function valueOf(id) {
      const element = document.getElementById(id);
      return element ? element.value : '';
    }
    document.querySelectorAll('[data-command]').forEach((element) => {
      element.addEventListener('click', () => postFrom(element));
    });
    mentions.querySelectorAll('[data-file]').forEach((element) => {
      element.addEventListener('click', () => {
        prompt.value = (prompt.value || '') + ' @' + element.dataset.file + ' ';
        mentions.style.display = 'none';
        prompt.focus();
      });
    });
    document.querySelectorAll('[data-slash]').forEach((element) => {
      element.addEventListener('click', () => {
        prompt.value = element.dataset.slash + (prompt.value || '');
        workflows.style.display = 'none';
        prompt.focus();
      });
    });
    workflowButton.addEventListener('click', () => {
      workflows.style.display = workflows.style.display === 'block' ? 'none' : 'block';
      prompt.focus();
    });
    sessionSelect?.addEventListener('change', () => {
      vscode.postMessage({ command: 'switchSession', sessionId: sessionSelect.value });
    });
    modelSelect.addEventListener('change', () => {
      vscode.postMessage({ command: 'setModel', model: modelSelect.value });
    });
    reasoningSelect.addEventListener('change', () => {
      vscode.postMessage({ command: 'setReasoning', reasoning: reasoningSelect.value });
    });
    permissionSelect.addEventListener('change', () => {
      vscode.postMessage({ command: 'setPermissionMode', permissionMode: permissionSelect.value });
    });
    attachButton.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const files = Array.from(fileInput.files || []);
      for (const file of files.slice(0, 6 - attachments.length)) {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        let text = '';
        if (!file.type.startsWith('image/')) {
          text = await file.text().catch(() => '');
        }
        attachments.push({ name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, dataUrl, text });
      }
      attachmentRow.style.display = attachments.length ? 'flex' : 'none';
      attachmentRow.innerHTML = attachments.map((file, index) => '<button class="chip" data-attachment-index="' + index + '">+ ' + file.name + '</button>').join('');
      attachmentRow.querySelectorAll('[data-attachment-index]').forEach((element) => {
        element.addEventListener('click', () => {
          attachments.splice(Number(element.dataset.attachmentIndex), 1);
          attachmentRow.style.display = attachments.length ? 'flex' : 'none';
          attachmentRow.innerHTML = attachments.map((file, index) => '<button class="chip" data-attachment-index="' + index + '">+ ' + file.name + '</button>').join('');
        });
      });
      fileInput.value = '';
    });
    prompt.addEventListener('input', () => {
      const text = prompt.value;
      mentions.style.display = /(^|\\s)@[^\\s]*$/.test(text) ? 'block' : 'none';
      workflows.style.display = /(^|\\s)\\/[^\\s]*$/.test(text) ? 'block' : workflows.style.display;
    });
    send.addEventListener('click', () => {
      vscode.postMessage({ command: 'sendPrompt', mode: currentMode, content: prompt.value, attachments });
      prompt.value = '';
      attachments.splice(0, attachments.length);
      attachmentRow.innerHTML = '';
      attachmentRow.style.display = 'none';
      mentions.style.display = 'none';
      workflows.style.display = 'none';
    });
    prompt.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') send.click();
    });
    const providerSettingsForm = document.getElementById('providerSettingsForm');
    providerSettingsForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      vscode.postMessage({
        command: 'saveProviderSettings',
        settings: {
          providerOrder: valueOf('providerOrder'),
          openrouter: {
            apiKey: valueOf('openrouterApiKey'),
            baseUrl: valueOf('openrouterBaseUrl'),
            model: valueOf('openrouterModel')
          },
          ollama: {
            apiKey: valueOf('ollamaApiKey'),
            baseUrl: valueOf('ollamaBaseUrl'),
            model: valueOf('ollamaModel')
          },
          nim: {
            apiKey: valueOf('nimApiKey'),
            baseUrl: valueOf('nimBaseUrl'),
            model: valueOf('nimModel')
          }
        }
      });
    });
  </script>
</body>
</html>`;
  }
}


module.exports = { NeuraComposerProvider };
