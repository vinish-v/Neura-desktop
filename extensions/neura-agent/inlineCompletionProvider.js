const vscode = require('vscode');
const { languageFor } = require('./utils');

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
              content: `You are a ${language} inline code completion engine. Return only the code that should be inserted at the cursor. No markdown, no explanation.`,
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

module.exports = { NeuraInlineCompletionProvider };
