'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

const DEFAULTS = Object.freeze({
  bind: '127.0.0.1',
  port: 9900,
  scope: 'home',
  scopePath: '',
  maxReadBytes: 5 * 1024 * 1024,
  maxAuthFailures: 5,
  authBanMinutes: 15,
  fileTicketMinutes: 5,
  websocketTicketSeconds: 120,
  maxTerminals: 8
});
const CONFIG_KEYS = new Set(Object.keys(DEFAULTS));
const HOSTNAME = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*\.?$/;

function configError(message) {
  throw new Error('config.json: ' + message);
}

function integer(value, key, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    configError(key + ' harus integer antara ' + min + ' dan ' + max);
  }
  return value;
}

function loadConfig(rootDir, argv = process.argv) {
  const appRoot = fs.realpathSync(rootDir);
  const configPath = path.join(appRoot, 'config.json');
  let userConfig = {};
  try {
    userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') configError('gagal dibaca: ' + error.message);
  }
  if (!userConfig || typeof userConfig !== 'object' || Array.isArray(userConfig)) {
    configError('isi harus berupa object JSON');
  }
  const unknownKeys = Object.keys(userConfig).filter(key => !CONFIG_KEYS.has(key));
  if (unknownKeys.length) configError('key tidak dikenal: ' + unknownKeys.join(', '));

  const config = { ...DEFAULTS, ...userConfig };
  if (typeof config.bind !== 'string' || !config.bind || config.bind.trim() !== config.bind ||
      (!net.isIP(config.bind) && !HOSTNAME.test(config.bind))) {
    configError('bind harus berupa alamat IP atau hostname yang valid');
  }
  if (typeof config.scope !== 'string' || !['home', 'root', 'full'].includes(config.scope)) {
    configError('scope harus "home", "root", atau "full"');
  }
  if (typeof config.scopePath !== 'string') configError('scopePath harus string path absolut atau kosong');
  const scopeFlag = argv.find(arg => arg.startsWith('--scope='));
  let scopeMode = config.scope;
  if (scopeFlag) {
    const flagValue = scopeFlag.slice('--scope='.length);
    if (!['root', 'home', 'full'].includes(flagValue)) {
      configError('argumen --scope hanya menerima root, home, atau full');
    }
    scopeMode = flagValue;
  }

  let scope = '/';
  if (scopeMode !== 'full') {
    const requestedPath = config.scopePath || os.homedir();
    if (!path.isAbsolute(requestedPath)) configError('scopePath harus path absolut');
    try { scope = fs.realpathSync(requestedPath); }
    catch (error) { configError('scopePath tidak dapat diakses: ' + error.message); }
    if (!fs.statSync(scope).isDirectory()) configError('scopePath harus folder');
    if (scope === '/') configError('scopePath "/" hanya bisa digunakan dengan scope "full"');
    if (['/dev', '/proc', '/sys', '/tmp'].some(root => scope === root || scope.startsWith(root + '/'))) {
      configError('scopePath tidak boleh berada di /dev, /proc, /sys, atau /tmp');
    }
  }

  return Object.freeze({
    port: integer(config.port, 'port', 1, 65535),
    host: config.bind,
    block: appRoot,
    scope,
    maxRead: integer(config.maxReadBytes, 'maxReadBytes', 1024, 100 * 1024 * 1024),
    maxFail: integer(config.maxAuthFailures, 'maxAuthFailures', 1, 100),
    banMs: integer(config.authBanMinutes, 'authBanMinutes', 1, 24 * 60) * 60 * 1000,
    ticketMs: integer(config.fileTicketMinutes, 'fileTicketMinutes', 1, 60) * 60 * 1000,
    wsTicketMs: integer(config.websocketTicketSeconds, 'websocketTicketSeconds', 1, 10 * 60) * 1000,
    maxTerminals: integer(config.maxTerminals, 'maxTerminals', 1, 100),
    mediaRe: /\.(png|jpe?g|gif|webp|bmp|ico|svg|mp4|webm|mov|m4v|mp3|wav|ogg|m4a|flac|aac)$/i
  });
}

module.exports = { loadConfig };
