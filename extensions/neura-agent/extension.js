/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
const crypto = require('crypto');
const fs = require('fs/promises');
const fsSync = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const vscode = require('vscode');

let provider;
let inlineProvider;
let statusBar;
let outputChannel;

const modeLabels = {
  ask: 'Explain',
  plan: 'Plan',
  agent: 'Edit',
  builder: 'Build',
};

const reasoningLabels = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

const permissionLabels = {
  ask: 'Ask Permission',
  full: 'Full Access',
};

const nvidiaModels = [
  {
    id: 'nvidia/nemotron-3-nano-30b-a3b',
    label: 'Nemotron 3 Nano 30B',
    description: 'Default coding and agent model',
  },
  {
    id: 'nvidia/llama-3.1-nemotron-nano-8b-v1',
    label: 'Llama Nemotron Nano 8B',
    description: 'Fast edits and explanations',
  },
  {
    id: 'moonshotai/kimi-k2.6',
    label: 'Kimi K2.6',
    description: 'Large coding and agent model; can be slower to start',
  },
  {
    id: 'minimaxai/minimax-m2.7',
    label: 'MiniMax M2.7',
    description: 'Large coding and reasoning model; can be slower to start',
  },
  {
    id: 'qwen/qwen3-coder-480b-a35b-instruct',
    label: 'Qwen3 Coder 480B',
    description: 'Large NVIDIA NIM coding model',
  },
  {
    id: 'qwen/qwen3-next-80b-a3b-instruct',
    label: 'Qwen3 Next 80B',
    description: 'General coding and instruction model',
  },
  {
    id: 'qwen/qwen3-next-80b-a3b-thinking',
    label: 'Qwen3 Next 80B Thinking',
    description: 'Reasoning-heavy NVIDIA NIM model',
  },
  {
    id: 'bigcode/starcoder2-15b',
    label: 'StarCoder2 15B',
    description: 'Code generation model',
  },
  {
    id: 'mistralai/codestral-22b-instruct-v0.1',
    label: 'Codestral 22B',
    description: 'Code generation and editing model',
  },
  {
    id: 'ibm/granite-34b-code-instruct',
    label: 'Granite Code 34B',
    description: 'Code instruction model',
  },
  {
    id: 'ibm/granite-8b-code-instruct',
    label: 'Granite Code 8B',
    description: 'Fast code instruction model',
  },
  {
    id: 'google/codegemma-7b',
    label: 'CodeGemma 7B',
    description: 'Fast code generation model',
  },
  {
    id: 'meta/codellama-70b',
    label: 'CodeLlama 70B',
    description: 'Large code generation model',
  },
  {
    id: 'deepseek-ai/deepseek-coder-6.7b-instruct',
    label: 'DeepSeek Coder 6.7B',
    description: 'Fast code generation model',
  },
  {
    id: 'deepseek-ai/deepseek-v4-flash',
    label: 'DeepSeek V4 Flash',
    description: 'Fast coding and agent tasks',
  },
  {
    id: 'deepseek-ai/deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    description: 'Larger DeepSeek reasoning and coding model',
  },
  {
    id: 'nvidia/llama-3.1-nemotron-51b-instruct',
    label: 'Llama Nemotron 51B',
    description: 'Larger coding/general reasoning model',
  },
];

const editableModes = new Set(['agent', 'builder']);
const ignoredGlob =
  '{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/out/**,**/.next/**,**/.turbo/**,**/coverage/**}';
const maxContextBytes = 12000;
const maxAttachmentBytes = 2_000_000;
const defaultNimTimeoutMs = 45000;

const logNeura = (message, details = undefined) => {
  const timestamp = new Date().toISOString();
  const suffix = details ? ` ${JSON.stringify(details)}` : '';
  const line = `[${timestamp}] ${message}${suffix}`;
  outputChannel?.appendLine(line);
  console.log(`[Neura Composer] ${message}${suffix}`);
};

const errorMessageFor = (error) => {
  if (error?.name === 'AbortError') return 'The request timed out before NVIDIA NIM returned a response.';
  if (error instanceof Error) return error.message;
  return String(error || 'Unknown error');
};

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const nowIso = () => new Date().toISOString();
const id = (prefix) => `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
const toUri = (filePath) => vscode.Uri.file(filePath);

const languageFor = (filePath) => {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.ts' || extension === '.tsx') return 'typescript';
  if (extension === '.js' || extension === '.jsx' || extension === '.mjs' || extension === '.cjs') {
    return 'javascript';
  }
  if (extension === '.css') return 'css';
  if (extension === '.html') return 'html';
  if (extension === '.json') return 'json';
  if (extension === '.md') return 'markdown';
  if (extension === '.py') return 'python';
  if (extension === '.rs') return 'rust';
  if (extension === '.go') return 'go';
  return 'plaintext';
};

const normalizeSlashes = (value) => String(value || '').replace(/\\/g, '/');

const codingKeywordPattern =
  /\b(code|coding|file|function|class|method|component|hook|route|api|endpoint|backend|frontend|full[-\s]?stack|database|schema|migration|query|sql|html|css|javascript|typescript|react|vue|svelte|next\.?js|node|electron|vite|webpack|package|dependency|npm|pnpm|yarn|python|rust|go|java|kotlin|swift|c\+\+|c#|php|ruby|docker|test|unit test|e2e|lint|build|compile|deploy|debug|bug|error|stack trace|exception|refactor|optimi[sz]e|implement|create|delete|edit|update|generate|website|web app|app|ui|ux|page|form|button|layout|style|terminal|command|script)\b/i;
const fileReferencePattern =
  /\b[\w.-]+\.(js|jsx|ts|tsx|mjs|cjs|json|html|css|scss|md|py|rs|go|java|kt|swift|cpp|c|h|cs|php|rb|yml|yaml|toml|xml|sql|sh|ps1|bat|tsx?)\b/i;

const parseJsonObject = (raw) => {
  const text = String(raw || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new Error('The model did not return a JSON object.');
  }
  return JSON.parse(candidate.slice(first, last + 1));
};

const safeReadJson = async (filePath) => {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return {};
  }
};

const markdownToHtml = (value) => {
  const escaped = escapeHtml(value || '');
  const blocks = escaped
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
      return `<pre><code class="lang-${escapeHtml(lang)}">${code}</code></pre>`;
    })
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>');
  return `<p>${blocks}</p>`;
};

const execFileAsync = (command, args, cwd) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { cwd, timeout: 30000, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(String(stdout || '').trim());
    });
  });

class NeuraInlineCompletionProvider {
  constructor(getConfig) {
    this.getConfig = getConfig;
    this.cache = new Map();
  }

  async provideInlineCompletionItems(document, position, _context, token) {
    if (!vscode.workspace.getConfiguration('neura').get('inlineCompletions', false)) {
      return { items: [] };
    }
    const config = this.getConfig();
    if (!config?.configured || document.uri.scheme !== 'file') {
      return { items: [] };
    }
    const offset = document.offsetAt(position);
    const text = document.getText();
    const prefix = text.slice(Math.max(0, offset - 1600), offset);
    const suffix = text.slice(offset, Math.min(text.length, offset + 400));
    if (!prefix.trim() || token.isCancellationRequested) {
      return { items: [] };
    }
    const cacheKey = `${document.uri.fsPath}:${position.line}:${prefix.slice(-120)}`;
    if (this.cache.has(cacheKey)) {
      return { items: [new vscode.InlineCompletionItem(this.cache.get(cacheKey))] };
    }
    const completion = await this.fetchCompletion(config, prefix, suffix, languageFor(document.fileName), token);
    if (!completion || token.isCancellationRequested) {
      return { items: [] };
    }
    this.cache.set(cacheKey, completion);
    if (this.cache.size > 80) {
      this.cache.delete(this.cache.keys().next().value);
    }
    return { items: [new vscode.InlineCompletionItem(completion)] };
  }

  async fetchCompletion(config, prefix, suffix, language, token) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    token.onCancellationRequested(() => controller.abort());
    try {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: config.model,
          temperature: 0.05,
          max_tokens: 120,
          messages: [
            {
              role: 'system',
              content:
                `You are a ${language} inline code completion engine. Return only the code that should be inserted at the cursor. No markdown, no explanation.`,
            },
            {
              role: 'user',
              content: `<prefix>\n${prefix}\n</prefix>\n<suffix>\n${suffix}\n</suffix>\nComplete at cursor:`,
            },
          ],
        }),
      });
      const payload = await response.json().catch(() => ({}));
      const content = payload.choices?.[0]?.message?.content || '';
      return content.replace(/^```[\w-]*\n?/i, '').replace(/\n?```$/i, '').trimEnd();
    } catch {
      return '';
    } finally {
      clearTimeout(timeout);
    }
  }
}

class NeuraComposerProvider {
  constructor(context) {
    this.context = context;
    this.view = undefined;
    this.state = this.defaultState();
    this.config = this.readNimConfig();
    this.suggestions = [];
    this.activeTab = 'chat';
    this.worktrees = [];
    this.mcpServers = [];
    this.plugins = [];
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
    return `neura.composer.${crypto.createHash('sha1').update(root).digest('hex')}`;
  }

  async resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
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

  async loadState() {
    this.state = this.context.workspaceState.get(this.stateKey, this.defaultState());
    this.migrateSessionsIfNeeded();
    this.state.memory = await this.loadMemory();
    if (!modeLabels[this.state.mode]) {
      this.state.mode = 'agent';
    }
    this.config = await this.readNimConfig();
    if (!reasoningLabels[this.state.reasoning]) {
      this.state.reasoning =
        vscode.workspace.getConfiguration('neura.nim').get('reasoning') || 'medium';
    }
    if (!permissionLabels[this.state.permissionMode]) {
      this.state.permissionMode = 'ask';
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

  async refresh() {
    await this.loadState();
    await this.refreshSuggestions();
    await this.refreshWorktrees();
    await this.refreshMcpServers();
    await this.refreshPlugins();
    if (this.view) {
      this.view.webview.html = this.render();
    }
    this.updateStatusBar();
  }

  async readNimConfig() {
    const config = vscode.workspace.getConfiguration('neura.nim');
    const persisted = await this.readPersistedNeuraSettings();
    const baseUrl =
      config.get('baseUrl') ||
      persisted.plannerBaseUrl ||
      persisted.vlmBaseUrl ||
      process.env.PLANNER_BASE_URL ||
      process.env.NVIDIA_NIM_BASE_URL ||
      'https://integrate.api.nvidia.com/v1';
    const apiKey =
      config.get('apiKey') ||
      persisted.plannerApiKey ||
      persisted.vlmApiKey ||
      process.env.PLANNER_API_KEY ||
      process.env.NVIDIA_NIM_API_KEY ||
      process.env.NVIDIA_API_KEY ||
      '';
    const model =
      config.get('model') ||
      persisted.plannerModelName ||
      process.env.PLANNER_MODEL ||
      process.env.NVIDIA_NIM_MODEL ||
      'nvidia/nemotron-3-nano-30b-a3b';
    const timeoutMs = Number(config.get('timeoutMs') || process.env.NEURA_NIM_TIMEOUT_MS || defaultNimTimeoutMs);
    return {
      baseUrl: String(baseUrl || '').replace(/\/+$/, ''),
      apiKey: String(apiKey || ''),
      model: String(model || ''),
      timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : defaultNimTimeoutMs,
      configured: Boolean(apiKey && baseUrl && model),
    };
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
    if (parsed.command === 'explain' || parsed.command === 'ask') {
      return { allowed: true, intent: 'explain', mode: 'ask' };
    }

    if (/\b(build|create|generate|scaffold)\b.*\b(app|site|website|page|dashboard|ui|form|component)\b/i.test(text)) {
      return { allowed: true, intent: 'build', mode: 'builder' };
    }
    if (/\b(plan|approach|steps|todo|architecture|design)\b/i.test(text)) {
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

  async refreshMcpServers() {
    const servers = vscode.workspace.getConfiguration('neura.mcp').get('servers', []);
    this.mcpServers = Array.isArray(servers)
      ? servers.map((server) => ({
          name: String(server?.name || 'Unnamed MCP'),
          transport: String(server?.transport || 'stdio'),
          command: String(server?.command || server?.url || ''),
          status: 'configured',
        }))
      : [];
  }

  async refreshPlugins() {
    const pluginRoot = path.join(os.homedir(), '.neura', 'plugins');
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
          description: manifest.description || 'Untrusted plugin package. Loading is disabled until trust permissions are implemented.',
        });
      }
      this.plugins = plugins;
    } catch {
      this.plugins = [];
    }
  }

  async readWorkspaceFile(relativePath, byteLimit = maxContextBytes) {
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
    return files.map((uri) => normalizeSlashes(path.relative(this.rootPath, uri.fsPath)));
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

    const files = [];
    for (const filePath of [...contextFiles].slice(0, 12)) {
      try {
        files.push(await this.readWorkspaceFile(filePath));
      } catch (error) {
        files.push({
          filePath,
          content: `Unable to read file: ${error instanceof Error ? error.message : 'Unknown error'}`,
          truncated: false,
        });
      }
    }

    const includeTree = mentions.includes('codebase') || mentions.includes('workspace') || !files.length;
    return {
      mentions,
      files,
      tree: includeTree ? await this.projectTree(120) : await this.projectTree(40),
    };
  }

  async sendPrompt(content, mode = this.state.mode, rawAttachments = []) {
    const parsed = this.parseWorkflowPrompt(content, mode);
    let prompt = parsed.prompt;
    mode = parsed.mode;
    const attachments = this.normalizeAttachments(rawAttachments);
    this.ensureWorkspace();

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
        text: 'Detected an MCP workflow request. MCP execution is reserved for the upcoming permissioned tool layer.',
      });
      this.state.messages.push({
        id: id('msg'),
        role: 'assistant',
        mode,
        content:
          'MCP support is planned for a later Neura IDE pass. This Composer is currently focused on direct workspace code context, file edits, diffs, checkpoints, and approved terminal commands.',
        createdAt: nowIso(),
      });
      await this.saveState();
      this.renderIfVisible();
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

    if (!this.config.configured) {
      thinkingMessage.content = JSON.stringify({
        kind: 'thinking',
        status: 'failed',
        title: 'Thinking stopped',
        text: 'NVIDIA NIM is not configured, so Neura cannot start a coding request.',
      });
      this.state.messages.push({
        id: id('msg'),
        role: 'assistant',
        mode,
        content:
          'NVIDIA NIM is not configured for Neura IDE. Set neura.nim.apiKey, neura.nim.baseUrl, and neura.nim.model in Settings, or provide NVIDIA_NIM_API_KEY.',
        createdAt: nowIso(),
      });
      await this.saveState();
      this.renderIfVisible();
      return;
    }

    try {
      const result = await this.callNim(mode, prompt, context, attachments);
      thinkingMessage.content = JSON.stringify({
        kind: 'thinking',
        status: 'done',
        title: 'Thinking',
        text:
          result._thinking ||
          `Analyzed the workspace context and selected the ${modeLabels[mode] || mode} workflow.`,
      });
      await this.acceptModelResult(mode, result, context);
    } catch (error) {
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
    await vscode.workspace.getConfiguration('neura.nim').update('model', selected, target);
    this.config = await this.readNimConfig();
    logNeura('Model switched', {
      model: this.config.model,
      baseUrl: this.config.baseUrl,
      configured: this.config.configured,
    });
    await this.saveState();
    this.renderIfVisible();
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
      baseUrl: this.config.baseUrl,
      timeoutMs: this.config.timeoutMs,
      contextFiles: context.files.length,
      treeFiles: context.tree.length,
      attachments: attachments.length,
    };
    logNeura('NIM request started', requestMeta);
    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          'content-type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.config.model,
          temperature: mode === 'ask' ? 0.15 : 0.2,
          max_tokens: editableModes.has(mode) ? 6000 : 3500,
          messages: [
            { role: 'system', content: this.systemPrompt(mode) },
            { role: 'user', content: userContent },
          ],
        }),
      });
      const rawBody = await response.text();
      let payload = {};
      try {
        payload = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        payload = {};
      }
      if (!response.ok) {
        const providerMessage = payload.error?.message || rawBody || 'No provider error body.';
        logNeura('NIM request failed', {
          ...requestMeta,
          status: response.status,
          providerMessage: String(providerMessage).slice(0, 500),
        });
        throw new Error(
          `NVIDIA NIM returned HTTP ${response.status} for ${this.config.model}: ${providerMessage}`,
        );
      }
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
        logNeura('NIM request returned no final content', {
          ...requestMeta,
          finishReason: choice.finish_reason,
          reasoningChars: reasoningText.length,
          reasoningPreview: reasoningText.slice(0, 500),
        });
        if (reasoningText) {
          throw new Error(
            `NVIDIA NIM returned reasoning output but no final Composer response for ${this.config.model}. Finish reason: ${choice.finish_reason || 'unknown'}. Switch to Nemotron 3 Nano or another non-stalling coding model, then retry. Details are in Output: Neura Composer.`,
          );
        }
        throw new Error(
          `NVIDIA NIM returned an empty response for ${this.config.model}. Details are in Output: Neura Composer.`,
        );
      }
      logNeura('NIM request completed', {
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
        logNeura('NIM response JSON parse failed', {
          ...requestMeta,
          replyPreview: String(content).slice(0, 700),
          error: errorMessageFor(error),
        });
        throw new Error(
          `NVIDIA NIM returned text that Neura could not parse as a coding response. Try Nemotron 3 Nano or ask again. Details are in Output: Neura Composer.`,
        );
      }
    } catch (error) {
      const message = errorMessageFor(error);
      logNeura('NIM request error', {
        ...requestMeta,
        error: message,
      });
      if (error?.name === 'AbortError') {
        throw new Error(
          `NVIDIA NIM did not reply within ${Math.round(this.config.timeoutMs / 1000)}s for ${this.config.model}. Switch to Nemotron 3 Nano or another faster model, then retry.`,
        );
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
        'Mode: Build. Create or extend websites/apps from natural language. Propose files, package changes, preview/build commands, and verification steps.',
        'For a simple website/app request, create individual files such as index.html, styles.css, script.js, package.json, or framework files as appropriate. Include complete file contents.',
        'Schema: {"message":"summary","questions":["only if blocked"],"todos":[{"title":"task","rationale":"why","status":"pending"}],"edits":[{"operation":"create|update|delete","filePath":"path","content":"full content for create/update","rationale":"why"}],"commands":[{"command":"shell command","purpose":"why"}],"preview":{"command":"dev server command","url":"http://localhost:port"},"referencedFiles":["path"]}',
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
      files ? `Selected context files:\n${files}` : 'Selected context files: none',
      textAttachments ? `Attached text files:\n${textAttachments}` : 'Attached text files: none',
      mediaAttachments ? `Attached media:\n${mediaAttachments}` : 'Attached media: none',
    ].join('\n\n');
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

    if (Array.isArray(result.todos) && result.todos.length) {
      this.state.messages.push({
        id: id('todo'),
        role: 'tool',
        mode,
        content: JSON.stringify({ kind: 'todos', items: result.todos }),
        createdAt: nowIso(),
      });
    }

    if (!editableModes.has(mode)) {
      return;
    }

    const edits = Array.isArray(result.edits)
      ? result.edits
          .map((edit) => ({
            id: id('edit'),
            operation: ['create', 'update', 'delete'].includes(edit.operation) ? edit.operation : 'update',
            filePath: this.safeRelative(edit.filePath),
            content: edit.operation === 'delete' ? '' : String(edit.content ?? ''),
            rationale: String(edit.rationale || ''),
            status: 'proposed',
          }))
          .filter((edit) => edit.filePath && edit.filePath !== 'codebase' && edit.filePath !== 'workspace')
      : [];
    const commands = Array.isArray(result.commands)
      ? result.commands
          .filter((command) => command?.command)
          .map((command) => ({
            id: id('cmd'),
            command: String(command.command),
            purpose: String(command.purpose || 'Suggested verification or setup command.'),
            status: 'proposed',
          }))
      : [];

    if (edits.length || commands.length) {
      const proposal = {
        id: id('proposal'),
        summary: message,
        mode,
        status: 'proposed',
        edits,
        commands,
        preview: result.preview || null,
        createdAt: nowIso(),
      };
      this.state.proposals.unshift(proposal);
      if (this.state.permissionMode === 'full') {
        if (edits.length) {
          await this.applyProposal(proposal.id, undefined, { skipConfirmation: true, skipRefresh: true });
        }
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
    return checkpoint;
  }

  async applyProposal(proposalId, filePath, options = {}) {
    const proposal = this.state.proposals.find((item) => item.id === proposalId);
    if (!proposal) throw new Error('Change proposal was not found.');
    const edits = proposal.edits.filter(
      (edit) => edit.status === 'proposed' && (!filePath || edit.filePath === filePath),
    );
    if (!edits.length) return;

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
    for (const edit of edits) {
      const absolute = this.absoluteFor(edit.filePath);
      if (edit.operation === 'delete') {
        if (fsSync.existsSync(absolute)) await fs.unlink(absolute);
      } else {
        await fs.mkdir(path.dirname(absolute), { recursive: true });
        await fs.writeFile(absolute, edit.content, 'utf8');
      }
      edit.status = 'applied';
    }
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

  async runCommand(proposalId, commandId, commandText, options = {}) {
    this.ensureWorkspace();
    const command = String(commandText || '').trim();
    if (!command) return;
    if (!options.skipConfirmation) {
      const approval = await vscode.window.showWarningMessage(
        `Run this command in ${this.rootPath}?\n\n${command}`,
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
      status: 'running',
      stdout: '',
      stderr: '',
      exitCode: null,
      createdAt: nowIso(),
    };
    this.state.terminalCards.unshift(card);
    await this.saveState();
    this.renderIfVisible();

    const shell = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : process.env.SHELL || 'sh';
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-lc', command];
    const child = spawn(shell, args, { cwd: this.rootPath, windowsHide: true });
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
      await this.saveState();
      this.renderIfVisible();
    });
  }

  async openPreview(proposalId) {
    const proposal = this.state.proposals.find((item) => item.id === proposalId);
    const url = proposal?.preview?.url || this.state.preview?.url;
    if (!url) {
      await vscode.window.showInformationMessage('No preview URL is available yet. Run the proposed dev server command first.');
      return;
    }
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }

  async openSettings() {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'neura.nim');
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

  async installPlugin() {
    await vscode.window.showWarningMessage(
      'Plugin installation is not enabled yet. Neura will add plugins after trust prompts, permissions, and sandboxing are implemented.',
    );
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
      if (message.command === 'setMode') await this.setMode(message.mode);
      if (message.command === 'setModel') await this.setModel(message.model);
      if (message.command === 'setReasoning') await this.setReasoning(message.reasoning);
      if (message.command === 'setPermissionMode') await this.setPermissionMode(message.permissionMode);
      if (message.command === 'setTab') {
        this.activeTab = message.tab || 'chat';
        this.renderIfVisible();
      }
      if (message.command === 'createSession') await this.createSession();
      if (message.command === 'switchSession') await this.switchSession(message.sessionId);
      if (message.command === 'addContext') await this.addContext(message.filePath);
      if (message.command === 'removeContext') await this.removeContext(message.filePath);
      if (message.command === 'applyProposal') await this.applyProposal(message.proposalId, message.filePath);
      if (message.command === 'rejectProposal') await this.rejectProposal(message.proposalId, message.filePath);
      if (message.command === 'undoProposal') await this.undoProposal(message.proposalId);
      if (message.command === 'restoreCheckpoint') await this.restoreCheckpoint(message.checkpointId);
      if (message.command === 'openDiff') await this.openDiff(message.proposalId, message.filePath);
      if (message.command === 'runCommand') await this.runCommand(message.proposalId, message.commandId, message.commandText);
      if (message.command === 'openPreview') await this.openPreview(message.proposalId);
      if (message.command === 'openSettings') await this.openSettings();
      if (message.command === 'clearChat') await this.clearChat();
      if (message.command === 'toggleInlineCompletions') await this.toggleInlineCompletions();
      if (message.command === 'addWorktree') await this.addWorktree();
      if (message.command === 'installPlugin') await this.installPlugin();
      if (message.command === 'openWorktree') await this.openWorktree(message.worktreePath);
      if (message.command === 'removeWorktree') await this.removeWorktree(message.worktreePath);
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
    this.updateStatusBar();
  }

  updateStatusBar() {
    if (!statusBar) return;
    const model = this.config?.model ? this.config.model.split('/').pop() : 'not configured';
    const mode = modeLabels[this.state?.mode] || 'Edit';
    statusBar.text = `$(sparkle) Neura ${mode} - ${model}`;
    statusBar.tooltip = `Neura IDE Composer\nModel: ${this.config?.model || 'not configured'}\nReasoning: ${reasoningLabels[this.state?.reasoning] || 'Medium'}`;
    statusBar.backgroundColor = this.config?.configured
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
        return `<details class="thinking" ${status === 'failed' ? 'open' : ''}>
          <summary>${escapeHtml(title)} <span>${escapeHtml(status)}</span></summary>
          <pre>${escapeHtml(payload.text || '')}</pre>
        </details>`;
      }
    } catch {
      return '';
    }
    return '';
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
        (proposal) => `<section class="card proposal">
          <div class="card-title">
            <span>${escapeHtml(modeLabels[proposal.mode] || 'Edit')} Changes</span>
            <small>${escapeHtml(proposal.status)}</small>
          </div>
          <p>${escapeHtml(proposal.summary)}</p>
          ${
            proposal.edits.length
              ? `<div class="actions">
                  <button data-command="applyProposal" data-proposal-id="${escapeHtml(proposal.id)}">Accept All</button>
                  <button data-command="rejectProposal" data-proposal-id="${escapeHtml(proposal.id)}">Reject All</button>
                  ${proposal.lastCheckpointId ? `<button data-command="undoProposal" data-proposal-id="${escapeHtml(proposal.id)}">Undo</button>` : ''}
                </div>`
              : ''
          }
          ${proposal.edits.map((edit) => this.renderEditCard(proposal, edit)).join('')}
          ${(proposal.commands || []).map((command) => this.renderCommandCard(proposal, command)).join('')}
          ${
            proposal.preview
              ? `<div class="preview-card">
                  <strong>Preview</strong>
                  <p>${escapeHtml(proposal.preview.command || 'Run the app preview command.')}</p>
                  <button data-command="openPreview" data-proposal-id="${escapeHtml(proposal.id)}">Open Preview</button>
                </div>`
              : ''
          }
        </section>`,
      )
      .join('');
  }

  renderEditCard(proposal, edit) {
    return `<div class="file-card">
      <div class="file-head">
        <div>
          <strong>${escapeHtml(edit.filePath)}</strong>
          <p>${escapeHtml(edit.rationale || 'Neura proposed a full-file change.')}</p>
        </div>
        <span>${escapeHtml(edit.operation)} - ${escapeHtml(edit.status)}</span>
      </div>
      <div class="actions">
        <button data-command="openDiff" data-proposal-id="${escapeHtml(proposal.id)}" data-file-path="${escapeHtml(edit.filePath)}">Open Diff</button>
        <button data-command="applyProposal" data-proposal-id="${escapeHtml(proposal.id)}" data-file-path="${escapeHtml(edit.filePath)}">Accept File</button>
        <button data-command="rejectProposal" data-proposal-id="${escapeHtml(proposal.id)}" data-file-path="${escapeHtml(edit.filePath)}">Reject File</button>
      </div>
    </div>`;
  }

  renderCommandCard(proposal, command) {
    return `<div class="terminal-card">
      <div class="file-head">
        <div>
          <strong>Command</strong>
          <p>${escapeHtml(command.purpose)}</p>
        </div>
        <span>${escapeHtml(command.status)}</span>
      </div>
      <code>${escapeHtml(command.command)}</code>
      <div class="actions">
        <button data-command="runCommand" data-proposal-id="${escapeHtml(proposal.id)}" data-command-id="${escapeHtml(command.id)}" data-command-text="${escapeHtml(command.command)}">Approve & Run</button>
      </div>
    </div>`;
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
    const models = known
      ? nvidiaModels
      : [
          {
            id: this.config.model,
            label: this.config.model || 'Custom model',
            description: 'Current configured model',
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
      ['mcp', `MCP${this.mcpServers.length ? ` ${this.mcpServers.length}` : ''}`],
      ['plugins', `Plugins${this.plugins.length ? ` ${this.plugins.length}` : ''}`],
      ['worktrees', `Worktrees${this.worktrees.length ? ` ${this.worktrees.length}` : ''}`],
    ];
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
    if (this.activeTab === 'mcp') return this.renderMcpPanel();
    if (this.activeTab === 'plugins') return this.renderPluginsPanel();
    if (this.activeTab === 'worktrees') return this.renderWorktreesPanel();
    return `${(this.state.contextFiles || []).length ? this.renderContextBar() : ''}
      ${this.renderMessages()}
      ${this.renderProposals()}
      ${this.renderTerminals()}
      ${this.renderCheckpoints()}`;
  }

  renderMcpPanel() {
    const rows = this.mcpServers.length
      ? this.mcpServers
          .map(
            (server) => `<div class="list-row">
              <div><strong>${escapeHtml(server.name)}</strong><p>${escapeHtml(server.transport)} ${escapeHtml(server.command)}</p></div>
              <span>${escapeHtml(server.status)}</span>
            </div>`,
          )
          .join('')
      : '<section class="empty"><strong>No MCP servers configured.</strong><p>Add servers in Settings under neura.mcp.servers. Tool execution will use approval cards when enabled.</p></section>';
    return `<section class="card"><div class="card-title">MCP Servers</div>${rows}<div class="actions"><button data-command="openSettings">Configure MCP</button></div></section>`;
  }

  renderPluginsPanel() {
    const rows = this.plugins.length
      ? this.plugins
          .map(
            (plugin) => `<div class="list-row">
              <div><strong>${escapeHtml(plugin.name)}</strong><p>${escapeHtml(plugin.description)}</p></div>
              <span>${escapeHtml(plugin.version)}</span>
            </div>`,
          )
          .join('')
      : '<section class="empty"><strong>No plugins installed.</strong><p>Plugins will load only after trust prompts, permissions, and sandboxing are implemented.</p></section>';
    return `<section class="card"><div class="card-title">Plugins</div>${rows}<div class="actions"><button data-command="openSettings">Plugin Settings</button></div></section>`;
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
    .session-select { max-width: 190px; border: 1px solid #303030; background: #202020; color: #d7d7d7; }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <h1>Agent</h1>
      <div class="top-actions">
        <select class="session-select" id="sessionSelect" title="Composer session">${this.renderSessionOptions()}</select>
        <button class="icon-button" id="newChat" title="New session">+</button>
        <button class="icon-button" data-command="refresh" title="Refresh">R</button>
        <button class="icon-button" id="mcpButton" title="MCP support coming later">...</button>
      </div>
    </header>
    ${this.renderTabs()}
    <main>
      ${
        configured
          ? ''
          : '<section class="empty"><strong>Set up NVIDIA NIM</strong><p>Open Settings and set neura.nim.apiKey, neura.nim.baseUrl, and neura.nim.model. The API key is never shown in this panel.</p><div class="actions"><button data-command="openSettings">Open Settings</button></div></section>'
      }
      ${this.renderMainPanel()}
    </main>
    <footer>
      <div class="project-name">${escapeHtml(this.projectName)}</div>
      <div class="composer">
        <div id="attachments" class="attachment-row"></div>
        <textarea id="prompt" ${isBusy ? 'disabled' : ''} placeholder="${configured ? 'Ask for code changes, @ to mention, / for workflows' : 'Configure NVIDIA NIM to use the coding Composer.'}"></textarea>
        <div id="mentions">${this.renderSuggestions()}</div>
        <div id="workflows" class="workflow-menu">
          <button data-slash="/plan ">Plan implementation</button>
          <button data-slash="/reasoning high ">Reasoning high</button>
          <button data-slash="/edit ">Edit code</button>
          <button data-slash="/build ">Build app/site</button>
          <button data-slash="/explain ">Explain code</button>
          <button data-command="openSettings">NIM settings</button>
          <button id="mcpComing">MCP support later</button>
        </div>
        <div class="bar">
          <div class="bar-left">
            <button class="icon-button" id="attachButton" title="Attach image or text">+</button>
            <select id="modelSelect" title="NVIDIA NIM model">${this.renderModelOptions()}</select>
            <select id="reasoningSelect" title="Reasoning level">${this.renderReasoningOptions()}</select>
            <select id="permissionSelect" title="Permission mode">${this.renderPermissionOptions()}</select>
            <button id="workflowButton">${escapeHtml(modeLabel)}</button>
          </div>
          <div class="bar-right">
            <button class="send" id="send" ${isBusy ? 'disabled' : ''} title="Send">${isBusy ? '...' : 'Send'}</button>
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
        worktreePath: element.dataset.worktreePath,
        sessionId: element.dataset.sessionId
      });
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
    document.getElementById('newChat').addEventListener('click', () => {
      vscode.postMessage({ command: 'createSession' });
    });
    sessionSelect.addEventListener('change', () => {
      vscode.postMessage({ command: 'switchSession', sessionId: sessionSelect.value });
    });
    document.getElementById('mcpButton').addEventListener('click', () => {
      prompt.value = '/mcp ';
      prompt.focus();
    });
    document.getElementById('mcpComing').addEventListener('click', () => {
      prompt.value = '/mcp ';
      workflows.style.display = 'none';
      prompt.focus();
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
  </script>
</body>
</html>`;
  }
}

const inputAndSend = async (mode, title, prompt) => {
  await provider?.setMode(mode);
  const content = await vscode.window.showInputBox({ title, prompt, ignoreFocusOut: true });
  if (content) {
    await provider?.sendPrompt(content, mode);
    await provider?.reveal();
  }
};

const wrap = (handler) => async () => {
  try {
    await handler();
  } catch (error) {
    await vscode.window.showErrorMessage(
      error instanceof Error ? error.message : 'Neura command failed.',
    );
  }
};

function activate(context) {
  outputChannel = vscode.window.createOutputChannel('Neura Composer');
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  statusBar.command = 'neura.openComposer';
  statusBar.text = '$(sparkle) Neura IDE';
  statusBar.show();
  logNeura('Extension activated');
  provider = new NeuraComposerProvider(context);
  inlineProvider = new NeuraInlineCompletionProvider(() => provider?.config);
  context.subscriptions.push(
    statusBar,
    outputChannel,
    vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, inlineProvider),
    vscode.window.registerWebviewViewProvider('neura-ai.chat', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('neura.openAiPanel', wrap(() => provider.reveal())),
    vscode.commands.registerCommand('neura.openComposer', wrap(() => provider.reveal())),
    vscode.commands.registerCommand('neura.ask', wrap(() => inputAndSend('ask', 'Neura: Explain Code', 'Ask about code, errors, architecture, or project files.'))),
    vscode.commands.registerCommand('neura.generatePlan', wrap(() => inputAndSend('plan', 'Neura: Generate Plan', 'Describe the coding change Neura should plan.'))),
    vscode.commands.registerCommand('neura.runAgent', wrap(() => inputAndSend('agent', 'Neura: Edit Code', 'Describe the code change Neura should implement.'))),
    vscode.commands.registerCommand('neura.buildApp', wrap(() => inputAndSend('builder', 'Neura: Build App', 'Describe the website, app, page, or feature Neura should build.'))),
    vscode.commands.registerCommand('neura.applyChanges', wrap(async () => {
      const proposal = provider.state.proposals.find((item) => item.status === 'proposed' || item.status === 'partially_applied');
      if (!proposal) throw new Error('No pending Neura change proposal was found.');
      await provider.applyProposal(proposal.id);
    })),
    vscode.commands.registerCommand('neura.restoreCheckpoint', wrap(async () => {
      const checkpoint = provider.state.checkpoints[0];
      if (!checkpoint) throw new Error('No Neura checkpoint was found.');
      await provider.restoreCheckpoint(checkpoint.id);
    })),
    vscode.commands.registerCommand('neura.openPreview', wrap(async () => {
      const proposal = provider.state.proposals.find((item) => item.preview);
      await provider.openPreview(proposal?.id);
    })),
    vscode.commands.registerCommand('neura.runApprovedCommand', wrap(async () => {
      const command = await vscode.window.showInputBox({
        title: 'Neura: Run Command',
        prompt: 'Command to run in the current workspace after confirmation.',
        ignoreFocusOut: true,
      });
      if (command) await provider.runCommand(undefined, undefined, command);
    })),
    vscode.commands.registerCommand('neura.addWorktree', wrap(() => provider.addWorktree())),
    vscode.commands.registerCommand('neura.installPlugin', wrap(() => provider.installPlugin())),
    vscode.commands.registerCommand('neura.toggleInlineCompletions', wrap(() => provider.toggleInlineCompletions())),
    vscode.commands.registerCommand('neura.syncCanvasProject', wrap(() => provider.refresh())),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('neura')) {
        void provider.refresh();
      }
    }),
  );

  setTimeout(() => {
    void provider.reveal();
  }, 500);
}

function deactivate() {
  logNeura('Extension deactivated');
  statusBar?.dispose();
  outputChannel?.dispose();
}

module.exports = { activate, deactivate };
