const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const { errorMessageFor, logNeura } = require('./utils');

class McpStdioClient {
  constructor(definition) {
    this.definition = definition;
    this.process = null;
    this.nextId = 1;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
  }

  async connect() {
    if (this.process) return;
    if (!this.definition.command) {
      throw new Error(`MCP server "${this.definition.name}" is missing a command.`);
    }
    this.process = spawn(this.definition.command, this.definition.args || [], {
      cwd: this.definition.cwd || process.cwd(),
      env: { ...process.env, ...(this.definition.env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.process.stdout.on('data', (chunk) => this.onData(chunk));
    this.process.stderr.on('data', (chunk) => {
      logNeura('MCP stderr', { server: this.definition.name, text: chunk.toString().slice(0, 500) });
    });
    this.process.on('close', () => {
      this.process = null;
      for (const pending of this.pending.values()) {
        pending.reject(new Error(`MCP server "${this.definition.name}" exited.`));
      }
      this.pending.clear();
    });
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'neura-ide', version: '0.1.0' },
    });
    this.notify('notifications/initialized', {});
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = this.buffer.subarray(0, headerEnd).toString('utf8');
      const lengthMatch = header.match(/content-length:\s*(\d+)/i);
      if (!lengthMatch) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(lengthMatch[1]);
      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + length;
      if (this.buffer.length < messageEnd) return;
      const raw = this.buffer.subarray(messageStart, messageEnd).toString('utf8');
      this.buffer = this.buffer.subarray(messageEnd);
      try {
        const message = JSON.parse(raw);
        if (message.id != null && this.pending.has(message.id)) {
          const pending = this.pending.get(message.id);
          this.pending.delete(message.id);
          if (message.error) pending.reject(new Error(message.error.message || 'MCP request failed.'));
          else pending.resolve(message.result);
        }
      } catch (error) {
        logNeura('MCP parse error', { server: this.definition.name, error: errorMessageFor(error) });
      }
    }
  }

  send(message) {
    if (!this.process?.stdin) throw new Error(`MCP server "${this.definition.name}" is not connected.`);
    const body = JSON.stringify(message);
    this.process.stdin.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
  }

  request(method, params = {}) {
    return new Promise((resolve, reject) => {
      const requestId = this.nextId;
      this.nextId += 1;
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`MCP request timed out: ${method}`));
      }, 20000);
      this.pending.set(requestId, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      try {
        this.send({ jsonrpc: '2.0', id: requestId, method, params });
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(requestId);
        reject(error);
      }
    });
  }

  notify(method, params = {}) {
    this.send({ jsonrpc: '2.0', method, params });
  }

  dispose() {
    this.process?.kill();
    this.process = null;
  }
}

class McpSseClient {
  constructor(definition) {
    this.definition = definition;
    this.nextId = 1;
    this.endpoint = '';
    this.pending = new Map();
    this.streamRequest = null;
    this.connected = false;
  }

  async connect() {
    if (this.connected && this.endpoint) return;
    if (!this.definition.url) {
      throw new Error(`MCP server "${this.definition.name}" is missing an SSE URL.`);
    }
    await this.openStream();
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'neura-ide', version: '0.1.0' },
    });
    await this.notify('notifications/initialized', {});
  }

  openStream() {
    return new Promise((resolve, reject) => {
      const url = new URL(this.definition.url);
      const client = url.protocol === 'https:' ? https : http;
      let buffer = '';
      let resolved = false;
      const req = client.request(
        {
          method: 'GET',
          hostname: url.hostname,
          port: url.port,
          path: `${url.pathname}${url.search}`,
          headers: { accept: 'text/event-stream' },
        },
        (res) => {
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            buffer += chunk;
            const events = buffer.split(/\r?\n\r?\n/);
            buffer = events.pop() || '';
            for (const eventText of events) {
              this.handleSseEvent(eventText);
              if (!resolved && this.endpoint) {
                resolved = true;
                this.connected = true;
                resolve();
              }
            }
          });
          res.on('end', () => {
            this.connected = false;
            if (!resolved) reject(new Error(`MCP SSE server "${this.definition.name}" closed before endpoint discovery.`));
          });
        },
      );
      req.on('error', (error) => {
        this.connected = false;
        if (!resolved) reject(error);
        else logNeura('MCP SSE stream error', { server: this.definition.name, error: errorMessageFor(error) });
      });
      req.setTimeout(15000, () => {
        req.destroy(new Error(`MCP SSE connect timed out for ${this.definition.name}.`));
      });
      this.streamRequest = req;
      req.end();
    });
  }

  handleSseEvent(eventText) {
    const lines = eventText.split(/\r?\n/);
    const event = lines
      .filter((line) => line.startsWith('event:'))
      .map((line) => line.slice(6).trim())
      .join('\n');
    const data = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n');
    if (!data) return;
    if (event === 'endpoint' || (!this.endpoint && /^(https?:\/\/|\/|")/.test(data))) {
      try {
        const parsed = JSON.parse(data);
        if (typeof parsed === 'string' || parsed.endpoint || parsed.url) {
          this.endpoint = new URL(parsed.endpoint || parsed.url || parsed, this.definition.url).href;
          return;
        }
      } catch {
        this.endpoint = new URL(data, this.definition.url).href;
        return;
      }
    }
    try {
      const message = JSON.parse(data);
      if (message.id != null && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message || 'MCP request failed.'));
        else pending.resolve(message.result);
      }
    } catch (error) {
      logNeura('MCP SSE parse error', { server: this.definition.name, error: errorMessageFor(error) });
    }
  }

  async post(message) {
    if (!this.endpoint) throw new Error(`MCP SSE server "${this.definition.name}" is not connected.`);
    const body = JSON.stringify(message);
    const url = new URL(this.endpoint);
    const client = url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      const req = client.request(
        {
          method: 'POST',
          hostname: url.hostname,
          port: url.port,
          path: `${url.pathname}${url.search}`,
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body, 'utf8'),
          },
        },
        (res) => {
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            raw += chunk;
          });
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`MCP SSE POST failed HTTP ${res.statusCode}: ${raw.slice(0, 500)}`));
              return;
            }
            resolve(raw);
          });
        },
      );
      req.on('error', reject);
      req.setTimeout(20000, () => {
        req.destroy(new Error(`MCP request timed out: ${message.method || 'notification'}`));
      });
      req.write(body);
      req.end();
    });
  }

  request(method, params = {}) {
    return new Promise((resolve, reject) => {
      const requestId = this.nextId;
      this.nextId += 1;
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`MCP request timed out: ${method}`));
      }, 20000);
      this.pending.set(requestId, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      this.post({ jsonrpc: '2.0', id: requestId, method, params }).catch((error) => {
        clearTimeout(timeout);
        this.pending.delete(requestId);
        reject(error);
      });
    });
  }

  async notify(method, params = {}) {
    await this.post({ jsonrpc: '2.0', method, params });
  }

  dispose() {
    this.streamRequest?.destroy();
    this.streamRequest = null;
    this.connected = false;
  }
}

module.exports = { McpStdioClient, McpSseClient };
