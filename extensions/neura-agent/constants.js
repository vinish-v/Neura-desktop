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
  read: 'Read Only',
  ask: 'Ask Before Write',
  terminal: 'Auto Write, Ask Terminal',
  workspace: 'Workspace Auto',
  full: 'Full Auto',
};

const nvidiaModels = [
  { id: 'nvidia/nemotron-3-nano-30b-a3b', label: 'Nemotron 3 Nano 30B', description: 'Default coding and agent model' },
  { id: 'nvidia/llama-3.1-nemotron-nano-8b-v1', label: 'Llama Nemotron Nano 8B', description: 'Fast edits and explanations' },
  { id: 'moonshotai/kimi-k2.6', label: 'Kimi K2.6', description: 'Large coding and agent model; can be slower to start' },
  { id: 'minimaxai/minimax-m2.7', label: 'MiniMax M2.7', description: 'Large coding and reasoning model; can be slower to start' },
  { id: 'qwen/qwen3-coder-480b-a35b-instruct', label: 'Qwen3 Coder 480B', description: 'Large NVIDIA NIM coding model' },
  { id: 'qwen/qwen3-next-80b-a3b-instruct', label: 'Qwen3 Next 80B', description: 'General coding and instruction model' },
  { id: 'qwen/qwen3-next-80b-a3b-thinking', label: 'Qwen3 Next 80B Thinking', description: 'Reasoning-heavy NVIDIA NIM model' },
  { id: 'bigcode/starcoder2-15b', label: 'StarCoder2 15B', description: 'Code generation model' },
  { id: 'mistralai/codestral-22b-instruct-v0.1', label: 'Codestral 22B', description: 'Code generation and editing model' },
  { id: 'ibm/granite-34b-code-instruct', label: 'Granite Code 34B', description: 'Code instruction model' },
  { id: 'ibm/granite-8b-code-instruct', label: 'Granite Code 8B', description: 'Fast code instruction model' },
  { id: 'google/codegemma-7b', label: 'CodeGemma 7B', description: 'Fast code generation model' },
  { id: 'meta/codellama-70b', label: 'CodeLlama 70B', description: 'Large code generation model' },
  { id: 'deepseek-ai/deepseek-coder-6.7b-instruct', label: 'DeepSeek Coder 6.7B', description: 'Fast code generation model' },
  { id: 'deepseek-ai/deepseek-v4-flash', label: 'DeepSeek V4 Flash', description: 'Fast coding and agent tasks' },
  { id: 'deepseek-ai/deepseek-v4-pro', label: 'DeepSeek V4 Pro', description: 'Larger DeepSeek reasoning and coding model' },
  { id: 'nvidia/llama-3.1-nemotron-51b-instruct', label: 'Llama Nemotron 51B', description: 'Larger coding/general reasoning model' },
];

const editableModes = new Set(['agent', 'builder']);
const ignoredGlob = '{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/out/**,**/.next/**,**/.turbo/**,**/coverage/**}';
const maxContextBytes = 12000;
const maxAttachmentBytes = 2_000_000;
const defaultNimTimeoutMs = 45000;
const agentMaxSteps = 6;
const agentObservationBytes = 9000;
const agentSearchFileLimit = 240;
const agentSearchMatchLimit = 30;

const agentTools = [
  { action: 'list_files', args: '{"limit":120}', description: 'List workspace files while respecting ignored build/dependency folders.' },
  { action: 'read_file', args: '{"filePath":"relative/path"}', description: 'Read a workspace file before editing it.' },
  { action: 'search', args: '{"query":"text","limit":20}', description: 'Search workspace text across source files.' },
  { action: 'get_diagnostics', args: '{"filePath":"optional/relative/path"}', description: 'Read current VS Code diagnostics for the workspace or one file.' },
  { action: 'shadcn_info', args: '{}', description: 'Inspect shadcn/ui configuration when a project has components.json.' },
  { action: 'preview_status', args: '{}', description: 'Read the latest preview URL and verification result known to Neura.' },
  { action: 'semantic_search', args: '{"query":"symbol or concept","limit":20}', description: 'Search the local semantic index for symbols and relevant files.' },
  { action: 'browser_verify', args: '{"url":"http://localhost:3000"}', description: 'Run headless browser verification with screenshot when a local browser is installed.' },
];

module.exports = {
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
  agentTools,
};
