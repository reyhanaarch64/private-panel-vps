'use strict';
// vpsAcces: personal VPS administration panel
// mode scope: default folder home, ubah ke full di config.json untuk akses seluruh /
const express = require('express');
const Busboy = require('busboy');
const archiver = require('archiver');
const extract = require('extract-zip');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');
const pty = require('node-pty');
const { createCopilotApi } = require('./copilot');
const { loadConfig } = require('./server/config');
const { HttpError, describeErr, wrap } = require('./server/lib/errors');
const { createFilesystem } = require('./server/lib/filesystem');
const { normIp } = require('./server/lib/network');
const { createAuth } = require('./server/middleware/auth');
const state = require('./server/state');
const registerPublicShares = require('./server/routes/public-shares');
const registerProcessRoutes = require('./server/routes/processes');
const registerFileRoutes = require('./server/routes/files');
const registerScriptJobs = require('./server/services/script-jobs');
const registerPackageRoutes = require('./server/routes/packages');
const registerTerminalWebsocket = require('./server/terminal/websocket');

let copilotApi = null;

const config = loadConfig(__dirname);
const {
  port: PORT, host: HOST, block: BLOCK, scope: SCOPE, maxRead: MAX_READ,
  maxFail: MAX_FAIL, banMs: BAN_MS, ticketMs: TICKET_MS,
  wsTicketMs: WS_TICKET_MS, maxTerminals: MAX_TERMINALS, mediaRe: MEDIA_RE
} = config;

const TOKEN = fs.readFileSync(path.join(__dirname, 'token.txt'), 'utf8').trim();
if (TOKEN.length < 8) {
  console.error('token.txt kosong atau kurang dari 8 karakter');
  process.exit(1);
}
const filesystem = createFilesystem({ scope: SCOPE, block: BLOCK, fs, path, crypto, HttpError, describeErr });
const {
  inBlock, guard, asList, lstatOrNull, exists,
  validName, rand, batchRes, eachItem, freeName, dirOf, describe
} = filesystem;
const auth = createAuth(TOKEN, { crypto, maxFail: MAX_FAIL, banMs: BAN_MS });

// anti brute force: salah token 5x, ip diblok 15 menit
const { tickets, websocketTickets, terminalSessions } = state;
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of tickets) if (v.exp < now) tickets.delete(k);
  for (const [k, v] of websocketTickets) if (v.exp < now) websocketTickets.delete(k);
}, 10 * 60 * 1000).unref();

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; font-src https://fonts.gstatic.com https://cdn.jsdelivr.net; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  });
  next();
});
// JSON body diparsing setelah autentikasi endpoint API.

const PUB = path.join(__dirname, 'public');
const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
app.get(['/', '/index.html'], wrap(async (req, res) => {
  const html = (await fsp.readFile(path.join(PUB, 'index.html'), 'utf8')).replace(/\{\{HOSTNAME\}\}/g, escHtml(os.hostname()));
  res.type('html').set('Cache-Control', 'no-cache').send(html);
}));
app.get('/manifest.webmanifest', (req, res) => {
  const host = os.hostname();
  res.type('application/manifest+json').set('Cache-Control', 'no-cache').send(JSON.stringify({
    id: '/', name: host + ' panel', short_name: host + ' panel', description: 'Panel administrasi VPS ' + host,
    start_url: '/', scope: '/', display: 'standalone', orientation: 'any', lang: 'id',
    background_color: '#f2f2f7', theme_color: '#f2f2f7', categories: ['utilities', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  }));
});
// Semua request API diautentikasi sebelum body parser maupun static fallback.
app.use('/api', auth);
app.use('/api', express.json({ limit: '25mb' }));
app.use(express.static(PUB, { index: false, dotfiles: 'ignore', maxAge: 0 }));


const { publicShares, dropPublicUnder } = registerPublicShares(app, {
  wrap, HttpError, guard, SCOPE, BLOCK, HOST, PORT, fs, fsp, path, crypto, os, archiver,
  tickets, lstatOrNull, inBlock, exists, publicDbPath: path.join(__dirname, 'public_file.json')
});
registerFileRoutes(app, {
  wrap, HttpError, guard, SCOPE, publicShares, dropPublicUnder, fs, fsp, path,
  Busboy, pipeline, archiver, extract, MEDIA_RE, rand, eachItem, asList, validName, describe,
  inBlock, lstatOrNull, exists, freeName, batchRes, describeErr, MAX_READ, tickets, TICKET_MS, crypto
});
app.get('/api/ping', wrap(async (req, res) => {
  let disk = null;
  try {
    const s = await fsp.statfs('/');
    disk = { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch (e) { /* abaikan */ }
  res.json({
    ok: true, hostname: os.hostname(), scope: SCOPE, full: SCOPE === '/', uptime: os.uptime(),
    load: os.loadavg(), mem: { total: os.totalmem(), free: os.freemem() }, disk,
    node: process.version, platform: os.platform() + ' ' + os.release()
  });
}));


const scriptJobs = registerScriptJobs(app, {
  wrap, HttpError, guard, rand, fs, os, spawn, StringDecoder, terminalSessions,
  getCopilotApi: () => copilotApi
});
registerProcessRoutes(app, {
  wrap, HttpError, SCOPE, terminalSessions, websocketTickets,
  WS_TICKET_MS, MAX_TERMINALS, normIp, jobs: scriptJobs.jobs, crypto
});

registerPackageRoutes(app, { wrap, SCOPE, spawn });

copilotApi = createCopilotApi(app, {
  wrap, HttpError, guard, scope: SCOPE, block: BLOCK, validName, dropPublicUnder
});

app.use('/api', (req, res) => res.status(404).json({ error: 'endpoint tidak ada' }));

app.use((err, req, res, next) => {
  const d = describeErr(err);
  if (d.status >= 500) console.error('[error]', req.method, req.url, err);
  if (res.headersSent) return next(err);
  res.status(d.status).json({ error: d.msg });
});

const server = app.listen(PORT, HOST, () => {
  console.log(os.hostname() + ' panel jalan di ' + HOST + ':' + PORT + ' | scope: ' + SCOPE + ' | dilindungi: ' + BLOCK);
});
registerTerminalWebsocket(server, { terminalSessions, websocketTickets, normIp, MAX_TERMINALS, SCOPE, crypto, pty });
server.requestTimeout = 0;
server.headersTimeout = 60000;
