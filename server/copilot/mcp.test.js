'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { HttpError } = require('../lib/errors');
const registerCopilotMcpRoutes = require('./routes/mcp');
const {
  createMcpPermissionHandler,
  discoverMcpTools,
  publicMcpServer,
  redactMcpError,
  sanitizeMcpArgs,
  validateMcpServer
} = require('./mcp');

test('validates remote MCP endpoints and headers', () => {
  const config = validateMcpServer({
    name: 'docs-server',
    url: 'https://mcp.example/api/mcp',
    headers: { Authorization: 'Bearer secret' }
  }, HttpError);
  assert.equal(config.url, 'https://mcp.example/api/mcp');
  assert.deepEqual(config.headers, { Authorization: 'Bearer secret' });
  const unusualHeader = validateMcpServer({
    name: 'headers',
    url: 'https://mcp.example/mcp',
    headers: JSON.parse('{"__proto__":"safe"}')
  }, HttpError);
  assert.equal(Object.hasOwn(unusualHeader.headers, '__proto__'), true);

  for (const url of [
    'file:///tmp/mcp',
    'https://user:pass@mcp.example/mcp',
    'https://mcp.example/mcp?token=secret',
    'https://mcp.example/not-mcp'
  ]) {
    assert.throws(() => validateMcpServer({ name: 'invalid', url }, HttpError), HttpError);
  }
  assert.throws(() => validateMcpServer({
    name: 'invalid', url: 'https://mcp.example/mcp', headers: { Authorization: 'Bearer x\r\nInjected: y' }
  }, HttpError), HttpError);
});

test('redacts headers from connection errors and public settings', () => {
  const config = validateMcpServer({
    name: 'docs',
    url: 'https://mcp.example/mcp',
    headers: { Authorization: 'Bearer private-value' }
  }, HttpError);
  assert.equal(redactMcpError(new Error('request failed Bearer private-value'), config.headers),
    'request failed [disamarkan]');
  const publicServer = publicMcpServer({
    ...config,
    tools: [{ name: 'search', description: 'Search docs', requireApproval: true }],
    status: 'connected',
    lastError: ''
  });
  assert.deepEqual(publicServer.headerNames, ['Authorization']);
  assert.equal(JSON.stringify(publicServer).includes('private-value'), false);
  assert.deepEqual(sanitizeMcpArgs({
    query: 'private-value',
    access_token: 'other-secret',
    nested: { password: 'secret' }
  }, config.headers), {
    query: '[disamarkan]',
    access_token: '[disamarkan]',
    nested: { password: '[disamarkan]' }
  });
});

test('MCP approval is per invocation or saved per tool and auto-approval requires explicit readOnly', async () => {
  const chat = { id: 'chat-1' };
  const events = [];
  const store = {
    mcpServers: [{
      name: 'docs', tools: [
        { name: 'search', requireApproval: true },
        { name: 'lookup', requireApproval: false }
      ]
    }]
  };
  const approvals = new Map();
  let saved = 0;
  const handler = createMcpPermissionHandler({
    store,
    approvals,
    emit: (...args) => events.push(args),
    saveStore: () => { saved++; },
    approvalMs: 1000
  });

  const pending = handler(chat, {
    kind: 'mcp',
    serverName: 'docs',
    toolName: 'search',
    toolTitle: 'Search',
    toolCallId: 'call-1',
    args: { query: 'docs' }
  });
  assert.equal(events[0][1], 'mcp_approval_required');
  assert.equal(approvals.has('call-1'), true);
  approvals.get('call-1').resolve(true);
  assert.deepEqual(await pending, { kind: 'approve-once', approvedInteractively: true });

  const remembered = handler(chat, {
    kind: 'mcp', serverName: 'docs', toolName: 'search', toolTitle: 'Search', toolCallId: 'call-remember'
  });
  approvals.get('call-remember').resolve(true, true);
  assert.deepEqual(await remembered, { kind: 'approve-once', approvedInteractively: true });
  assert.equal(store.mcpServers[0].tools[0].requireApproval, false);
  assert.equal(saved, 1);
  assert.deepEqual(await handler(chat, {
    kind: 'mcp', serverName: 'docs', toolName: 'search', toolTitle: 'Search', readOnly: true
  }), { kind: 'approve-once' });

  const mutating = handler(chat, {
    kind: 'mcp',
    serverName: 'docs',
    toolName: 'search',
    toolTitle: 'Search',
    toolCallId: 'call-mutating',
    readOnly: false
  });
  assert.equal(events.at(-1)[1], 'mcp_approval_required');
  approvals.get('call-mutating').resolve(false);
  assert.deepEqual(await mutating, { kind: 'reject', feedback: 'Pengguna menolak pemanggilan tool MCP.' });

  const unknown = handler(chat, {
    kind: 'mcp', serverName: 'docs', toolName: 'search', toolTitle: 'Search', toolCallId: 'call-unknown'
  });
  assert.equal(events.at(-1)[1], 'mcp_approval_required');
  approvals.get('call-unknown').resolve(true);
  assert.deepEqual(await unknown, { kind: 'approve-once', approvedInteractively: true });
});

test('discovers tools using a temporary remote MCP session', async () => {
  let config;
  let disconnected = false;
  let deleted = false;
  const tools = await discoverMcpTools({
    async createSession(value) {
      config = value;
      return {
        rpc: {
          tools: { initializeAndValidate: async () => ({}) },
          mcp: { listTools: async ({ serverName }) => {
            assert.equal(serverName, 'docs');
            return { tools: [{ name: 'search', description: 'Find documentation' }] };
          } }
        },
        disconnect: async () => { disconnected = true; }
      };
    },
    async deleteSession() { deleted = true; }
  }, {
    name: 'docs',
    url: 'https://mcp.example/mcp',
    headers: { Authorization: 'Bearer secret' }
  });
  assert.equal(config.mcpServers.docs.type, 'http');
  assert.deepEqual(config.mcpServers.docs.headers, { Authorization: 'Bearer secret' });
  assert.deepEqual(tools, [{
    name: 'search',
    description: 'Find documentation',
    requireApproval: true
  }]);
  assert.equal(disconnected, true);
  assert.equal(deleted, true);
});

test('MCP routes save secrets privately and expose per-tool policy controls', async () => {
  const routes = new Map();
  const app = {
    get: (path, handler) => routes.set('GET ' + path, handler),
    post: (path, handler) => routes.set('POST ' + path, handler),
    put: (path, handler) => routes.set('PUT ' + path, handler),
    delete: (path, handler) => routes.set('DELETE ' + path, handler)
  };
  const store = { chats: [], mcpServers: [] };
  let persisted = 0;
  let invalidated = 0;
  let activeConfigChanges = 0;
  let configChangesStarted = 0;
  let discoveredTools = [{ name: 'search', description: 'Find documentation' }];
  const copilot = {
    async createSession() {
      return {
        rpc: {
          tools: { initializeAndValidate: async () => ({}) },
          mcp: { listTools: async () => ({ tools: discoveredTools }) }
        },
        disconnect: async () => {}
      };
    },
    async deleteSession() {}
  };
  registerCopilotMcpRoutes(app, {
    wrap: handler => handler,
    HttpError,
    store,
    saveStore: () => { persisted++; },
    requireAuthenticatedClient: async () => copilot,
    beginSessionConfigChange() {
      activeConfigChanges++;
      configChangesStarted++;
      return () => { activeConfigChanges--; };
    },
    invalidateSessions: async () => { invalidated++; }
  });

  const response = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  });
  const added = response();
  await routes.get('POST /api/copilot/mcp/servers')({
    body: { name: 'docs', url: 'https://mcp.example/mcp', headers: { Authorization: 'Bearer private' } }
  }, added);
  assert.equal(added.statusCode, 201);
  assert.equal(store.mcpServers[0].tools[0].requireApproval, true);

  const listed = response();
  await routes.get('GET /api/copilot/mcp/servers')({}, listed);
  assert.equal(JSON.stringify(listed.body).includes('Bearer private'), false);
  assert.deepEqual(listed.body.servers[0].headerNames, ['Authorization']);

  const changed = response();
  await routes.get('PUT /api/copilot/mcp/servers/:name/tool-policy')({
    params: { name: 'docs' }, body: { toolName: 'search', requireApproval: false }
  }, changed);
  assert.equal(store.mcpServers[0].tools[0].requireApproval, false);
  assert.equal(invalidated, 2);
  assert.equal(persisted, 2);
  assert.equal(activeConfigChanges, 0);

  discoveredTools = [
    { name: 'search', description: 'Updated docs search' },
    { name: 'create', description: 'Create a document' }
  ];
  const updated = response();
  await routes.get('PUT /api/copilot/mcp/servers/:name')({
    params: { name: 'docs' },
    body: {
      url: 'https://mcp.example/v2/mcp',
      headers: { 'X-Workspace': 'private-workspace' },
      preserveHeaderNames: [],
      removeHeaderNames: ['Authorization']
    }
  }, updated);
  assert.equal(updated.body.server.url, 'https://mcp.example/v2/mcp');
  assert.deepEqual(updated.body.server.headerNames, ['X-Workspace']);
  assert.equal(JSON.stringify(updated.body).includes('private-workspace'), false);
  assert.deepEqual(store.mcpServers[0].tools.map(tool => [tool.name, tool.requireApproval]), [
    ['search', false], ['create', true]
  ]);
  assert.equal(store.mcpServers[0].headers.Authorization, undefined);
  assert.equal(store.mcpServers[0].headers['X-Workspace'], 'private-workspace');
  assert.equal(invalidated, 3);
  assert.equal(persisted, 3);

  const preserved = response();
  await routes.get('PUT /api/copilot/mcp/servers/:name')({
    params: { name: 'docs' },
    body: {
      url: 'https://mcp.example/v2/mcp',
      headers: {},
      preserveHeaderNames: ['X-Workspace']
    }
  }, preserved);
  assert.deepEqual(preserved.body.server.headerNames, ['X-Workspace']);
  assert.equal(JSON.stringify(preserved.body).includes('private-workspace'), false);
  assert.equal(store.mcpServers[0].headers['X-Workspace'], 'private-workspace');
  assert.equal(invalidated, 4);
  assert.equal(persisted, 4);

  const allowedReadOnly = response();
  await routes.get('PUT /api/copilot/mcp/servers/:name/tool-policy')({
    params: { name: 'docs' }, body: { allowAllReadOnly: true }
  }, allowedReadOnly);
  assert.equal(allowedReadOnly.body.readOnlyOnly, true);
  assert.deepEqual(store.mcpServers[0].tools.map(tool => tool.requireApproval), [false, false]);
  assert.equal(invalidated, 5);
  assert.equal(persisted, 5);

  await assert.rejects(routes.get('PUT /api/copilot/mcp/servers/:name/tool-policy')({
    params: { name: 'docs' }, body: { toolName: 'search', requireApproval: 'no' }
  }, response()));
  assert.equal(configChangesStarted, 6);
  assert.equal(activeConfigChanges, 0);
});
