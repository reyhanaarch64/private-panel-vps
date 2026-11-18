'use strict';

const crypto = require('crypto');

const MAX_MCP_SERVERS = 20;
const MAX_MCP_TOOLS = 500;
const MCP_CONNECT_TIMEOUT_MS = 30000;
const MCP_APPROVAL_MS = 2 * 60 * 1000;
const HEADER_NAME = /^[!#$%&'*+-.^_`|~0-9A-Za-z]+$/;
const SERVER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const BLOCKED_HEADERS = new Set(['connection', 'content-length', 'host', 'transfer-encoding']);

function invalid(HttpError, message) {
  if (HttpError && HttpError !== Error) throw new HttpError(400, message);
  throw new Error(message);
}

function validateMcpServer(input, HttpError) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    invalid(HttpError, 'data MCP tidak valid');
  }
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!SERVER_NAME.test(name)) {
    invalid(HttpError, 'nama MCP harus 1-64 karakter: huruf, angka, titik, garis bawah, atau tanda hubung');
  }
  if (typeof input.url !== 'string' || input.url.length > 2048) {
    invalid(HttpError, 'URL MCP tidak valid');
  }
  let url;
  try { url = new URL(input.url.trim()); }
  catch { invalid(HttpError, 'URL MCP tidak valid'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || !url.pathname.endsWith('/mcp')) {
    invalid(HttpError, 'URL MCP harus HTTP/HTTPS, tanpa kredensial/query, dan berakhir dengan /mcp');
  }
  const headers = input.headers === undefined ? {} : input.headers;
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    invalid(HttpError, 'header MCP harus berupa object JSON');
  }
  const entries = Object.entries(headers);
  if (entries.length > 30) invalid(HttpError, 'maksimal 30 header MCP');
  const normalizedHeaders = {};
  const normalizedNames = new Set();
  let totalHeaderBytes = 0;
  for (const [key, value] of entries) {
    const lower = key.toLowerCase();
    if (!HEADER_NAME.test(key) || BLOCKED_HEADERS.has(lower) || normalizedNames.has(lower)) {
      invalid(HttpError, 'nama header MCP tidak valid atau duplikat');
    }
    if (typeof value !== 'string' || value.length > 4096 || /[\r\n\0]/.test(value)) {
      invalid(HttpError, 'nilai header MCP tidak valid (maks 4096 karakter)');
    }
    normalizedNames.add(lower);
    Object.defineProperty(normalizedHeaders, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true
    });
    totalHeaderBytes += Buffer.byteLength(key) + Buffer.byteLength(value);
  }
  if (totalHeaderBytes > 16 * 1024) invalid(HttpError, 'total header MCP terlalu besar');
  return { name, url: url.toString(), headers: normalizedHeaders };
}

function normalizeMcpServers(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_MCP_SERVERS) {
    throw new Error('daftar server MCP tersimpan tidak valid');
  }
  const names = new Set();
  return value.map(server => {
    const normalized = validateMcpServer(server, Error);
    if (names.has(normalized.name)) throw new Error('nama server MCP tersimpan duplikat');
    names.add(normalized.name);
    const tools = Array.isArray(server.tools) ? server.tools.slice(0, MAX_MCP_TOOLS).map(tool => ({
      name: typeof tool.name === 'string' ? tool.name.slice(0, 256) : '',
      description: typeof tool.description === 'string' ? tool.description.slice(0, 2000) : '',
      requireApproval: tool.requireApproval !== false
    })).filter(tool => tool.name) : [];
    return {
      ...normalized,
      tools,
      status: typeof server.status === 'string' ? server.status.slice(0, 32) : 'unknown',
      lastError: typeof server.lastError === 'string' ? server.lastError.slice(0, 1000) : ''
    };
  });
}

function publicMcpServer(server) {
  return {
    name: server.name,
    url: server.url,
    headerNames: Object.keys(server.headers),
    tools: server.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      requireApproval: tool.requireApproval
    })),
    status: server.status,
    lastError: server.lastError || ''
  };
}

function toSdkConfig(server) {
  return {
    type: 'http',
    url: server.url,
    headers: server.headers,
    timeout: MCP_CONNECT_TIMEOUT_MS
  };
}

function sanitizeMcpArgs(args, headers) {
  const secrets = [];
  for (const [name, value] of Object.entries(headers || {})) {
    if (typeof value !== 'string' || !value) continue;
    secrets.push(value);
    if (name.toLowerCase() === 'authorization') {
      const credential = value.match(/^(?:Bearer|Token)\s+(.+)$/i);
      if (credential) secrets.push(credential[1]);
    }
  }
  const sensitiveKey = /(?:authorization|token|secret|password|credential|api.?key)/i;
  const seen = new WeakSet();
  function clean(value, key, depth) {
    if (sensitiveKey.test(key || '')) return '[disamarkan]';
    if (typeof value === 'string') {
      let result = value;
      for (const secret of secrets) result = result.split(secret).join('[disamarkan]');
      return result.slice(0, 2000);
    }
    if (!value || typeof value !== 'object') return value;
    if (depth > 8 || seen.has(value)) return '[tidak ditampilkan]';
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 100).map(item => clean(item, '', depth + 1));
    const result = {};
    for (const [childKey, child] of Object.entries(value).slice(0, 100)) {
      result[childKey.slice(0, 256)] = clean(child, childKey, depth + 1);
    }
    return result;
  }
  try {
    let result = clean(args || {}, '', 0);
    let serialized = JSON.stringify(result);
    if (serialized.length > 8000) {
      result = { truncated: serialized.slice(0, 8000) };
      serialized = JSON.stringify(result);
    }
    return result;
  } catch {
    return { unavailable: 'argumen tidak dapat ditampilkan' };
  }
}

function createMcpPermissionHandler({ store, approvals, emit, saveStore = () => {}, approvalMs = MCP_APPROVAL_MS }) {
  return (chat, request) => {
    if (!request || request.kind !== 'mcp') {
      return Promise.resolve({ kind: 'reject', feedback: 'Permission request ini tidak didukung panel.' });
    }
    const server = store.mcpServers.find(item => item.name === request.serverName);
    const tool = server && server.tools.find(item => item.name === request.toolName);
    if (!server) {
      return Promise.resolve({ kind: 'reject', feedback: 'Server MCP tidak lagi terpasang.' });
    }
    if (tool && !tool.requireApproval && request.readOnly === true) {
      return Promise.resolve({ kind: 'approve-once' });
    }
    const id = request.toolCallId || crypto.randomBytes(12).toString('hex');
    const args = sanitizeMcpArgs(request.args, server.headers);
    emit(chat, 'mcp_approval_required', {
      id,
      serverName: server.name,
      toolName: request.toolName,
      title: request.toolTitle || request.toolName,
      args
    });
    return new Promise(resolve => {
      const finish = resolve;
      const timer = setTimeout(() => {
        approvals.delete(id);
        emit(chat, 'approval_result', { id, approved: false, reason: 'permintaan konfirmasi kedaluwarsa' });
        finish({ kind: 'reject', feedback: 'Persetujuan MCP kedaluwarsa.' });
      }, approvalMs);
      approvals.set(id, {
        chatId: chat.id,
        kind: 'mcp',
        resolve(approved, rememberReadOnly = false) {
          clearTimeout(timer);
          approvals.delete(id);
          if (approved && rememberReadOnly) {
            const currentServer = store.mcpServers.find(item => item.name === server.name);
            const currentTool = currentServer && currentServer.tools.find(item => item.name === request.toolName);
            if (!currentTool) {
              finish({ kind: 'reject', feedback: 'Tool MCP tidak lagi terpasang.' });
              return;
            }
            const previous = currentTool.requireApproval;
            currentTool.requireApproval = false;
            try { saveStore(); }
            catch (error) {
              currentTool.requireApproval = previous;
              const reason = 'Pengaturan persetujuan MCP gagal disimpan.';
              finish({ kind: 'reject', feedback: reason });
              emit(chat, 'approval_result', { id, approved: false, reason });
              throw error;
            }
          }
          finish(approved
            ? { kind: 'approve-once', approvedInteractively: true }
            : { kind: 'reject', feedback: 'Pengguna menolak pemanggilan tool MCP.' });
        }
      });
    });
  };
}

async function discoverMcpTools(copilot, server) {
  const sessionId = 'vpsacc-mcp-discovery-' + crypto.randomBytes(16).toString('hex');
  let session;
  try {
    session = await copilot.createSession({
      sessionId,
      model: 'auto',
      mcpServers: { [server.name]: toSdkConfig(server) },
      availableTools: ['mcp:*'],
      permissionMode: 'manual'
    });
    await session.rpc.tools.initializeAndValidate();
    const result = await session.rpc.mcp.listTools({ serverName: server.name });
    return result.tools.slice(0, MAX_MCP_TOOLS).map(tool => ({
      name: String(tool.name).slice(0, 256),
      description: typeof tool.description === 'string' ? tool.description.slice(0, 2000) : '',
      requireApproval: true
    }));
  } finally {
    if (session) {
      try { await session.disconnect(); }
      catch (error) { console.error('[copilot] gagal memutus sesi discovery MCP', error); }
      try { await copilot.deleteSession(sessionId); }
      catch (error) { console.error('[copilot] gagal menghapus sesi discovery MCP', error); }
    }
  }
}

function redactMcpError(error, headers) {
  let message = String(error && error.message || 'koneksi gagal');
  for (const value of Object.values(headers || {})) {
    if (value) message = message.split(value).join('[disamarkan]');
  }
  return message.slice(0, 1000);
}

module.exports = {
  MAX_MCP_SERVERS,
  createMcpPermissionHandler,
  discoverMcpTools,
  normalizeMcpServers,
  publicMcpServer,
  redactMcpError,
  sanitizeMcpArgs,
  toSdkConfig,
  validateMcpServer
};
