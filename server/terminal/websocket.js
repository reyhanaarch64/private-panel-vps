'use strict';

const { WebSocketServer, WebSocket } = require('ws');

function registerTerminalWebsocket(server, deps) {
  const { terminalSessions, websocketTickets, normIp, MAX_TERMINALS, SCOPE, crypto, pty } = deps;
  // WebSocket + PTY untuk terminal interaktif xterm.js.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024, perMessageDeflate: false });
  function sendWs(ws, payload) {
    if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 4 * 1024 * 1024) ws.send(JSON.stringify(payload));
  }
  function startInteractiveTerminal(ws, cols, rows) {
    const id = crypto.randomBytes(9).toString('hex');
    const shell = '/bin/bash';
    const scoped = SCOPE !== '/';
    const home = scoped ? SCOPE : (process.env.HOME || '/root');
    const user = process.env.USER || process.env.LOGNAME || 'root';
    // env bersih: jangan warisin flag bashrc dari proses panel (mis. DEBIAN_DASHBOARD_LOADED)
    const env = {
      PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LANG: process.env.LANG || 'C.UTF-8',
      LC_ALL: process.env.LC_ALL || process.env.LANG || 'C.UTF-8',
      SHELL: shell,
      HOME: home,
      USER: user,
      LOGNAME: user,
      COLUMNS: String(cols),
      LINES: String(rows),
      TMPDIR: '/tmp',
      FORCE_COLOR: '1',
      CLICOLOR: '1',
      CLICOLOR_FORCE: '1'
    };
    // bawa path node biar command node/npm tetap ada
    if (process.env.PATH) env.PATH = process.env.PATH;
    let command = shell;
    // login + interactive biar .profile -> .bashrc (dashboard + PS1 warna) ke-load
    let args = ['--login', '-i'];
    let cwd = scoped ? SCOPE : '/';
    if (scoped) {
      env.TMPDIR = '/tmp';
      command = 'bwrap';
      args = [
        '--die-with-parent',
        '--ro-bind', '/', '/',
        '--bind', SCOPE, SCOPE,
        '--dev', '/dev',
        '--proc', '/proc',
        '--ro-bind', '/sys', '/sys',
        '--tmpfs', '/tmp',
        '--cap-drop', 'ALL',
        '--chdir', SCOPE,
        '--', shell, '--login', '-i'
      ];
    }
    const proc = pty.spawn(command, args, { name: 'xterm-256color', cols, rows, cwd, env, encoding: 'utf8' });
    const session = { id, pid: proc.pid, started: Date.now(), running: true, pty: proc, ws };
    terminalSessions.set(id, session);
    sendWs(ws, { type: 'ready', id, pid: proc.pid, scope: SCOPE, shell, sandbox: SCOPE !== '/' });
    proc.onData(data => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (ws.bufferedAmount >= 4 * 1024 * 1024) { ws.close(1013, 'terminal output terlalu cepat'); return; }
      sendWs(ws, { type: 'data', data });
    });
    proc.onExit(event => {
      session.running = false;
      session.exitCode = event.exitCode;
      session.signal = event.signal;
      if (terminalSessions.get(id) === session) terminalSessions.delete(id);
      sendWs(ws, { type: 'exit', code: event.exitCode, signal: event.signal });
      if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'shell selesai');
    });
    return session;
  }

  server.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch (e) { socket.destroy(); return; }
    if (url.pathname !== '/ws/terminal') { socket.destroy(); return; }
    const origin = req.headers.origin || '';
    let originOk = true;
    try {
      if (origin) originOk = new URL(origin).host === req.headers.host;
    } catch (e) { originOk = !origin; }
    const ticketId = url.searchParams.get('ticket') || '';
    const ticket = websocketTickets.get(ticketId);
    websocketTickets.delete(ticketId);
    const ip = normIp(req.socket.remoteAddress);
    const ticketOk = !!(ticket && ticket.exp >= Date.now());
    // ip cuma warning, jangan blok keras (proxy/cdn/ipv4-mapped bisa beda)
    if (!ticketOk) {
      console.log('[ws] tolak ticket invalid', { ticketId: ticketId.slice(0, 8), ip, origin });
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
      return;
    }
    if (origin && !originOk) {
      console.log('[ws] origin beda host, tetap lanjut karena ticket valid', { origin, host: req.headers.host });
    }
    if (terminalSessions.size >= MAX_TERMINALS) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
      return;
    }
    const initCols = Math.max(20, Math.min(300, parseInt(url.searchParams.get('cols'), 10) || 80));
    const initRows = Math.max(8, Math.min(120, parseInt(url.searchParams.get('rows'), 10) || 24));
    wss.handleUpgrade(req, socket, head, ws => {
      ws._initCols = initCols;
      ws._initRows = initRows;
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', ws => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', () => { try { ws.terminate(); } catch (e) { /* sudah ditutup */ } });
    let session = null;
    try { session = startInteractiveTerminal(ws, ws._initCols || 80, ws._initRows || 24); }
    catch (e) {
      console.error('[ws] gagal PTY', e);
      const msg = SCOPE !== '/' && (e.code === 'ENOENT' || /bwrap|bubblewrap/i.test(String(e.message)))
        ? 'scope terbatas membutuhkan bubblewrap (bwrap) terpasang di VPS'
        : 'gagal membuat PTY: ' + (e.message || e);
      sendWs(ws, { type: 'error', message: msg });
      try { ws.close(1011, 'gagal membuat terminal'); } catch (e2) {}
      return;
    }
    ws.on('message', (raw, isBinary) => {
      if (!session || !session.running || isBinary) return;
      let msg;
      try { msg = JSON.parse(raw.toString('utf8')); } catch (e) { return; }
      if (msg.type === 'input') {
        if (typeof msg.data !== 'string' || msg.data.length > 8192) return;
        try { session.pty.write(msg.data); } catch (e) { /* session sudah berakhir */ }
      } else if (msg.type === 'resize') {
        const cols = Math.max(2, Math.min(300, Number(msg.cols) || 80));
        const rows = Math.max(2, Math.min(120, Number(msg.rows) || 24));
        try { session.pty.resize(cols, rows); } catch (e) { /* session sudah berakhir */ }
      }
    });
    ws.on('close', () => {
      if (session && session.running) {
        try { session.pty.kill('SIGHUP'); } catch (e) { /* session sudah berakhir */ }
        session.running = false;
        terminalSessions.delete(session.id);
      }
    });
  });

  // heartbeat membersihkan PTY yang koneksi browser-nya hilang tanpa close frame.
  const wsHeartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (client.isAlive === false) { client.terminate(); continue; }
      client.isAlive = false;
      try { client.ping(); } catch (e) { client.terminate(); }
    }
  }, 30000);
  wsHeartbeat.unref();
  return { wss, heartbeat: wsHeartbeat };
}

module.exports = registerTerminalWebsocket;
