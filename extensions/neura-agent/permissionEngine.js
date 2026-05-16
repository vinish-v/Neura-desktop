const path = require('path');
let vscode;
try {
  // In Neura IDE this resolves to the VS Code extension host API. Plain Node
  // verification injects a lightweight config provider instead.
  vscode = require('vscode');
} catch {
  vscode = null;
}

const SECRET_PATTERNS = [
  /(api[_-]?key|token|secret|password|passwd|authorization|bearer)\s*[:=]\s*["']?([A-Za-z0-9._\-+/=]{8,})/gi,
  /(sk-[A-Za-z0-9]{12,})/g,
  /(nvapi-[A-Za-z0-9._-]{12,})/gi,
];

const normalizeSlashes = (value) => String(value || '').replace(/\\/g, '/');

const wildcardToRegExp = (pattern) => {
  const escaped = String(pattern || '*')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
};

const redactSecrets = (value) => {
  if (value == null) return value;
  if (typeof value === 'string') {
    return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, (match, key) => {
      if (key && /api|token|secret|password|passwd|authorization|bearer/i.test(key)) {
        return `${key}=<redacted>`;
      }
      return '<redacted-secret>';
    }), value);
  }
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (/api[_-]?key|token|secret|password|authorization/i.test(key)) return [key, '<redacted>'];
      return [key, redactSecrets(item)];
    }));
  }
  return value;
};

class PermissionEngine {
  constructor({ workspaceRoot, configProvider } = {}) {
    this.workspaceRoot = workspaceRoot || '';
    this.configProvider = configProvider || vscode;
  }

  config() {
    return this.configProvider?.workspace?.getConfiguration?.('neura.permissions') || {
      get: (_key, fallback) => fallback,
    };
  }

  rules() {
    const value = this.config().get('rules', []);
    return Array.isArray(value) ? value : [];
  }

  urlAllowlist() {
    const value = this.config().get('browser.allowedDomains', ['localhost', '127.0.0.1', '::1']);
    return Array.isArray(value) ? value.map(String) : ['localhost', '127.0.0.1', '::1'];
  }

  decisionForRule(action, resource) {
    for (const rule of this.rules()) {
      const ruleAction = String(rule?.action || '*');
      const pattern = String(rule?.pattern || '*');
      if (ruleAction !== '*' && ruleAction !== action) continue;
      if (!wildcardToRegExp(pattern).test(resource)) continue;
      const effect = String(rule?.effect || 'ask').toLowerCase();
      if (['allow', 'deny', 'ask'].includes(effect)) {
        return {
          decision: effect,
          reason: rule?.reason || `Matched policy ${ruleAction}:${pattern}`,
          rule,
        };
      }
    }
    return null;
  }

  isWorkspacePath(filePath) {
    if (!this.workspaceRoot || !filePath) return false;
    const absolute = path.isAbsolute(filePath) ? filePath : path.join(this.workspaceRoot, filePath);
    const relative = path.relative(this.workspaceRoot, absolute);
    return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
  }

  evaluate(action, resource, metadata = {}) {
    const normalizedAction = String(action || '').trim();
    const normalizedResource = normalizeSlashes(String(resource || '').trim());
    const rule = this.decisionForRule(normalizedAction, normalizedResource);
    if (rule) return { ...rule, action: normalizedAction, resource: normalizedResource };

    if (normalizedAction === 'file_read' || normalizedAction === 'file_write') {
      if (!this.isWorkspacePath(normalizedResource)) {
        return {
          action: normalizedAction,
          resource: normalizedResource,
          decision: 'deny',
          reason: 'File access is restricted to the current workspace.',
        };
      }
      return { action: normalizedAction, resource: normalizedResource, decision: 'allow', reason: 'Workspace-local file access.' };
    }

    if (normalizedAction === 'read_url' || normalizedAction === 'browser_url') {
      try {
        const url = new URL(normalizedResource);
        const host = url.hostname.toLowerCase();
        const allowed = this.urlAllowlist().some((pattern) => wildcardToRegExp(pattern.toLowerCase()).test(host));
        return allowed
          ? { action: normalizedAction, resource: normalizedResource, decision: 'allow', reason: `URL host ${host} is allowed.` }
          : { action: normalizedAction, resource: normalizedResource, decision: 'ask', reason: `URL host ${host} is outside the browser allowlist.` };
      } catch {
        return { action: normalizedAction, resource: normalizedResource, decision: 'deny', reason: 'URL is invalid.' };
      }
    }

    if (normalizedAction === 'command') {
      const command = normalizedResource.toLowerCase();
      if (/(^|\s)(rm\s+-rf|del\s+\/[fsq]|rmdir\s+\/s|format\b|diskpart\b|shutdown\b|reboot\b|mkfs\b|dd\s+if=|git\s+reset\s+--hard|git\s+clean\s+-fd)/.test(command)) {
        return { action: normalizedAction, resource: normalizedResource, decision: 'deny', reason: 'Dangerous destructive command blocked by policy.' };
      }
      return { action: normalizedAction, resource: normalizedResource, decision: metadata.auto ? 'allow' : 'ask', reason: 'Command requires mode or policy approval.' };
    }

    if (normalizedAction === 'mcp') {
      return { action: normalizedAction, resource: normalizedResource, decision: 'ask', reason: 'MCP tools require approval unless allowed by policy.' };
    }

    if (normalizedAction === 'plugin') {
      return { action: normalizedAction, resource: normalizedResource, decision: 'ask', reason: 'Plugins require explicit trust.' };
    }

    return { action: normalizedAction, resource: normalizedResource, decision: 'ask', reason: 'No explicit policy matched.' };
  }
}

module.exports = {
  PermissionEngine,
  redactSecrets,
};
