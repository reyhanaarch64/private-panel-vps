'use strict';

const {
  MAX_MCP_SERVERS,
  discoverMcpTools,
  publicMcpServer,
  redactMcpError,
  validateMcpServer
} = require('../mcp');

function registerCopilotMcpRoutes(app, deps) {
  const {
    wrap, HttpError, store, saveStore, requireAuthenticatedClient,
    beginSessionConfigChange, invalidateSessions
  } = deps;

  app.get('/api/copilot/mcp/servers', wrap(async (req, res) => {
    res.json({ servers: store.mcpServers.map(publicMcpServer) });
  }));

  app.post('/api/copilot/mcp/servers', wrap(async (req, res) => {
    const config = validateMcpServer(req.body, HttpError);
    const release = beginSessionConfigChange();
    try {
      if (store.mcpServers.some(server => server.name === config.name)) {
        throw new HttpError(409, 'nama server MCP sudah digunakan');
      }
      if (store.mcpServers.length >= MAX_MCP_SERVERS) {
        throw new HttpError(413, 'maksimal ' + MAX_MCP_SERVERS + ' server MCP');
      }

      const copilot = await requireAuthenticatedClient();
      let tools;
      try {
        tools = await discoverMcpTools(copilot, config);
      } catch (error) {
        throw new HttpError(502, 'MCP gagal tersambung: ' + redactMcpError(error, config.headers));
      }
      await invalidateSessions();
      const server = { ...config, tools, status: 'connected', lastError: '' };
      const previous = store.mcpServers;
      store.mcpServers = [server, ...previous];
      try { saveStore(); }
      catch (error) {
        store.mcpServers = previous;
        throw error;
      }
      res.status(201).json({ server: publicMcpServer(server) });
    } finally {
      release();
    }
  }));

  app.put('/api/copilot/mcp/servers/:name', wrap(async (req, res) => {
    const release = beginSessionConfigChange();
    try {
      const current = store.mcpServers.find(server => server.name === req.params.name);
      if (!current) throw new HttpError(404, 'server MCP tidak ditemukan');
      const body = req.body || {};
      const replacements = body.headers === undefined ? {} : body.headers;
      if (!replacements || typeof replacements !== 'object' || Array.isArray(replacements)) {
        throw new HttpError(400, 'header MCP harus berupa object JSON');
      }
      const normalizeHeaderNames = (value, label) => {
        if (value === undefined) return [];
        if (!Array.isArray(value) || value.length > 30 ||
            value.some(name => typeof name !== 'string' || !name || /[\r\n\0]/.test(name))) {
          throw new HttpError(400, label + ' tidak valid');
        }
        return value;
      };
      const removeNames = normalizeHeaderNames(body.removeHeaderNames, 'daftar header yang dihapus');
      const oldNames = new Map(Object.keys(current.headers).map(name => [name.toLowerCase(), name]));
      const remove = new Set(removeNames.map(name => name.toLowerCase()));
      const preserveNames = body.preserveHeaderNames === undefined
        ? Object.keys(current.headers).filter(name => !remove.has(name.toLowerCase()))
        : normalizeHeaderNames(body.preserveHeaderNames, 'daftar header yang dipertahankan');
      const preserve = new Set(preserveNames.map(name => name.toLowerCase()));
      if ([...preserve, ...remove].some(name => !oldNames.has(name)) ||
          [...preserve].some(name => remove.has(name))) {
        throw new HttpError(400, 'header yang dipertahankan atau dihapus tidak dikenal');
      }
      const mergedHeaders = Object.create(null);
      for (const [lower, name] of oldNames) {
        if (preserve.has(lower)) {
          Object.defineProperty(mergedHeaders, name, {
            value: current.headers[name], enumerable: true, configurable: true, writable: true
          });
        }
      }
      for (const [name, value] of Object.entries(replacements)) {
        const oldName = oldNames.get(name.toLowerCase());
        if (oldName) delete mergedHeaders[oldName];
        Object.defineProperty(mergedHeaders, name, {
          value, enumerable: true, configurable: true, writable: true
        });
      }
      const config = validateMcpServer({
        name: current.name,
        url: body.url === undefined ? current.url : body.url,
        headers: mergedHeaders
      }, HttpError);
      const copilot = await requireAuthenticatedClient();
      let discoveredTools;
      try {
        discoveredTools = await discoverMcpTools(copilot, config);
      } catch (error) {
        throw new HttpError(502, 'MCP gagal tersambung: ' + redactMcpError(error, config.headers));
      }
      const previous = store.mcpServers;
      const oldPolicies = new Map(current.tools.map(tool => [tool.name, tool.requireApproval]));
      const updated = {
        ...config,
        tools: discoveredTools.map(tool => ({
          ...tool,
          requireApproval: oldPolicies.has(tool.name) ? oldPolicies.get(tool.name) : true
        })),
        status: 'connected',
        lastError: ''
      };
      await invalidateSessions();
      store.mcpServers = previous.map(server => server === current ? updated : server);
      try { saveStore(); }
      catch (error) {
        store.mcpServers = previous;
        throw error;
      }
      res.json({ server: publicMcpServer(updated) });
    } finally {
      release();
    }
  }));

  app.delete('/api/copilot/mcp/servers/:name', wrap(async (req, res) => {
    const release = beginSessionConfigChange();
    try {
      const previous = store.mcpServers;
      const next = previous.filter(server => server.name !== req.params.name);
      if (next.length === previous.length) throw new HttpError(404, 'server MCP tidak ditemukan');
      await invalidateSessions();
      store.mcpServers = next;
      try { saveStore(); }
      catch (error) {
        store.mcpServers = previous;
        throw error;
      }
      res.json({ ok: true });
    } finally {
      release();
    }
  }));

  app.put('/api/copilot/mcp/servers/:name/tool-policy', wrap(async (req, res) => {
    const release = beginSessionConfigChange();
    try {
      const server = store.mcpServers.find(item => item.name === req.params.name);
      if (!server) throw new HttpError(404, 'server MCP tidak ditemukan');
      const body = req.body || {};
      if (body.allowAllReadOnly === true) {
        await invalidateSessions();
        const previous = server.tools.map(tool => tool.requireApproval);
        server.tools.forEach(tool => { tool.requireApproval = false; });
        try { saveStore(); }
        catch (error) {
          server.tools.forEach((tool, index) => { tool.requireApproval = previous[index]; });
          throw error;
        }
        res.json({ ok: true, updated: server.tools.length, readOnlyOnly: true });
        return;
      }
      const { toolName, requireApproval } = body;
      if (typeof toolName !== 'string' || typeof requireApproval !== 'boolean') {
        throw new HttpError(400, 'nama tool dan kebijakan izin tidak valid');
      }
      const tool = server.tools.find(item => item.name === toolName);
      if (!tool) throw new HttpError(404, 'tool MCP tidak ditemukan; sambungkan ulang server untuk memperbarui daftar tools');
      await invalidateSessions();
      const previous = tool.requireApproval;
      tool.requireApproval = requireApproval;
      try { saveStore(); }
      catch (error) {
        tool.requireApproval = previous;
        throw error;
      }
      res.json({ ok: true, requireApproval });
    } finally {
      release();
    }
  }));
}

module.exports = registerCopilotMcpRoutes;
