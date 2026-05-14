const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');

let outputChannel;

const setOutputChannel = (channel) => {
  outputChannel = channel;
};

const logNeura = (message, details = undefined) => {
  const timestamp = new Date().toISOString();
  const suffix = details ? ` ${JSON.stringify(details)}` : '';
  outputChannel?.appendLine(`[${timestamp}] ${message}${suffix}`);
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
const hashKey = (value) => crypto.createHash('sha1').update(value).digest('hex');

const languageFor = (filePath) => {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.ts' || extension === '.tsx') return 'typescript';
  if (['.js', '.jsx', '.mjs', '.cjs'].includes(extension)) return 'javascript';
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
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang, code) => `<pre><code class="lang-${escapeHtml(lang)}">${code}</code></pre>`)
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

module.exports = {
  setOutputChannel,
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
};
