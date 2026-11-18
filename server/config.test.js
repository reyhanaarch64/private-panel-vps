'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadConfig } = require('./config');

function withTempApp(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'private-panel-config-'));
  try { run(root); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('uses safe defaults when config.json is absent', () => {
  withTempApp(root => {
    const config = loadConfig(root, []);
    assert.equal(config.host, '127.0.0.1');
    assert.equal(config.port, 9900);
    assert.equal(config.scope, fs.realpathSync(os.homedir()));
    assert.equal(config.block, fs.realpathSync(root));
    assert.equal(config.maxTerminals, 8);
  });
});

test('loads bind, port, scope and service limits from config.json', () => {
  withTempApp(root => {
    const scopePath = os.homedir();
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
      bind: '0.0.0.0',
      port: 8765,
      scope: 'home',
      scopePath,
      maxReadBytes: 123456,
      maxAuthFailures: 7,
      authBanMinutes: 9,
      fileTicketMinutes: 4,
      websocketTicketSeconds: 30,
      maxTerminals: 12
    }));

    const config = loadConfig(root, []);
    assert.equal(config.host, '0.0.0.0');
    assert.equal(config.port, 8765);
    assert.equal(config.scope, fs.realpathSync(scopePath));
    assert.equal(config.maxRead, 123456);
    assert.equal(config.maxFail, 7);
    assert.equal(config.banMs, 9 * 60 * 1000);
    assert.equal(config.ticketMs, 4 * 60 * 1000);
    assert.equal(config.wsTicketMs, 30 * 1000);
    assert.equal(config.maxTerminals, 12);
  });
});

test('allows an explicit full-scope startup flag and rejects invalid settings', () => {
  withTempApp(root => {
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ scope: 'home' }));
    assert.equal(loadConfig(root, ['node', 'index.js', '--scope=full']).scope, '/');

    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ port: 70000 }));
    assert.throws(() => loadConfig(root, []), /port harus integer/);

    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ bind: 'https://example.com' }));
    assert.throws(() => loadConfig(root, []), /bind harus/);

    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ scopePath: 'relative/path' }));
    assert.throws(() => loadConfig(root, []), /scopePath harus path absolut/);

    fs.writeFileSync(path.join(root, 'config.json'), '{malformed');
    assert.throws(() => loadConfig(root, []), /config.json: gagal dibaca/);
  });
});
