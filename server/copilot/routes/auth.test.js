'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const registerCopilotAuthRoutes = require('./auth');
const { HttpError, wrap } = require('../../lib/errors');

function createRoutes(overrides = {}) {
  const routes = new Map();
  const deps = {
    wrap,
    HttpError,
    scope: '/',
    getClient: async () => { throw new Error('SDK protocol version mismatch'); },
    getLoginJob: () => ({ id: 'login-1', output: '', running: true, done: false, error: null }),
    startLogin: () => ({ id: 'login-1', running: true }),
    enablePlaintextTokenStorage() {},
    store: { settings: {} },
    SETTINGS_LANGUAGES: new Set(),
    SETTINGS_VERBOSITIES: new Set(),
    MAX_CUSTOM_INSTRUCTIONS: 12000,
    DEFAULT_SETTINGS: {},
    sessions: new Map(),
    saveStore() {},
    refreshClientAfterLogin: async () => { throw new Error('SDK protocol version mismatch'); },
    beginSessionConfigChange() { return () => {}; },
    ...overrides
  };
  const app = {
    get(route, handler) { routes.set('GET ' + route, handler); },
    post(route, handler) { routes.set('POST ' + route, handler); },
    put(route, handler) { routes.set('PUT ' + route, handler); }
  };
  registerCopilotAuthRoutes(app, deps);
  return routes;
}

async function invoke(handler, req) {
  let response;
  await handler(req, {
    status(code) { this.statusCode = code; return this; },
    json(value) { response = value; }
  }, error => { throw error; });
  return response;
}

test('starts device login without requiring the Copilot SDK', async () => {
  let started = false;
  const routes = createRoutes({
    startLogin() {
      started = true;
      return { id: 'login-1', running: true };
    }
  });
  const response = await invoke(routes.get('POST /api/copilot/login'), {
    body: { allowPlaintext: true }
  });
  assert.equal(started, true);
  assert.deepEqual(response, { id: 'login-1', running: true });
});

test('returns device login output while the SDK is unavailable', async () => {
  const job = {
    id: 'login-1',
    output: 'https://github.com/login/device\nABCD-EFGH\n',
    running: true,
    done: false,
    error: null
  };
  const routes = createRoutes({ getLoginJob: () => job });
  const response = await invoke(routes.get('GET /api/copilot/login/:id'), {
    params: { id: job.id },
    query: { after: '0' }
  });
  assert.equal(response.output, job.output);
  assert.equal(response.running, true);
  assert.equal(response.authenticated, false);
});

test('preserves login output when SDK auth refresh fails after device login', async () => {
  const job = {
    id: 'login-1',
    output: 'https://github.com/login/device\nABCD-EFGH\n',
    running: false,
    done: true,
    error: null
  };
  const routes = createRoutes({ getLoginJob: () => job });
  const response = await invoke(routes.get('GET /api/copilot/login/:id'), {
    params: { id: job.id },
    query: { after: '0' }
  });
  assert.equal(response.output, job.output);
  assert.equal(response.authenticated, false);
  assert.match(response.error, /SDK protocol version mismatch/);
});
