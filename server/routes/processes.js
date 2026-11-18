'use strict';

const os = require('os');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFileSync } = require('child_process');

function registerProcessRoutes(app, deps) {
  const { wrap, HttpError, SCOPE, terminalSessions, websocketTickets, WS_TICKET_MS,
    MAX_TERMINALS, normIp, jobs, crypto } = deps;
  // process monitoring menggunakan /proc agar tidak perlu menjalankan `ps` berulang kali.
  const processCpuSamples = new Map();
  const userNames = new Map();
  let lastSystemCpu = null;
  let clockTicks = 100;
  try { clockTicks = Math.max(1, parseInt(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim(), 10) || 100); } catch (e) { /* default Linux umumnya 100 */ }

  function loadUserNames() {
    try {
      for (const line of fs.readFileSync('/etc/passwd', 'utf8').split('\n')) {
        const p = line.split(':');
        if (p.length >= 3) userNames.set(Number(p[2]), p[0]);
      }
    } catch (e) { /* gunakan UID numerik */ }
  }
  loadUserNames();

  function parseProcStat(raw) {
    const a = raw.lastIndexOf(')');
    if (a < 0) throw new Error('stat proses tidak valid');
    const comm = raw.slice(raw.indexOf('(') + 1, a);
    const f = raw.slice(a + 2).trim().split(/\s+/);
    return {
      name: comm, state: f[0] || '?', ppid: Number(f[1]) || 0,
      cpuTicks: (Number(f[11]) || 0) + (Number(f[12]) || 0),
      startTicks: Number(f[19]) || 0
    };
  }

  async function readProcess(pid, now) {
    const dir = '/proc/' + pid;
    try {
      const stat = parseProcStat(await fsp.readFile(path.join(dir, 'stat'), 'utf8'));
      let uid = null, rss = 0;
      try {
        const status = await fsp.readFile(path.join(dir, 'status'), 'utf8');
        const u = status.match(/^Uid:\s+(\d+)/m);
        const r = status.match(/^VmRSS:\s+(\d+)\s+kB/m);
        if (u) uid = Number(u[1]);
        if (r) rss = Number(r[1]) * 1024;
      } catch (e) { /* proses mungkin sudah keluar */ }
      let command = '';
      try { command = (await fsp.readFile(path.join(dir, 'cmdline'))).toString('utf8').replace(/\0/g, ' ').trim(); } catch (e) { /* kernel thread */ }
      let executable = '';
      try { executable = await fsp.readlink(path.join(dir, 'exe')); } catch (e) { /* permission atau proses berakhir */ }
      const previous = processCpuSamples.get(pid);
      const elapsed = previous ? (now - previous.at) / 1000 : 0;
      const cpu = previous && previous.startTicks === stat.startTicks && elapsed > 0 && stat.cpuTicks >= previous.ticks
        ? ((stat.cpuTicks - previous.ticks) / clockTicks / elapsed) * 100 : 0;
      processCpuSamples.set(pid, { ticks: stat.cpuTicks, at: now, startTicks: stat.startTicks });
      return {
        pid, ppid: stat.ppid, name: stat.name, command: (command || stat.name).slice(0, 3000),
        executable, uid, user: uid == null ? '?' : (userNames.get(uid) || String(uid)),
        state: stat.state, cpu: Math.max(0, Math.min(9999, cpu)), rss, startTime: stat.startTicks,
        source: 'global'
      };
    } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'ESRCH' || e.code === 'EACCES') return null;
      return null;
    }
  }

  function systemCpuUsage() {
    try {
      const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
      const a = line.trim().split(/\s+/).slice(1, 9).map(Number);
      const total = a.reduce((x, y) => x + y, 0);
      const idle = (a[3] || 0) + (a[4] || 0);
      let value = 0;
      if (lastSystemCpu && total > lastSystemCpu.total) {
        const dt = total - lastSystemCpu.total;
        const di = idle - lastSystemCpu.idle;
        value = Math.max(0, Math.min(100, (1 - di / dt) * 100));
      }
      lastSystemCpu = { total, idle };
      return value;
    } catch (e) { return 0; }
  }

  async function scanProcesses() {
    const now = Date.now();
    let pids = [];
    try { pids = (await fsp.readdir('/proc')).filter(x => /^\d+$/.test(x)).map(Number); } catch (e) { throw new HttpError(500, 'tidak bisa membaca /proc'); }
    const processes = [];
    for (let i = 0; i < pids.length; i += 48) {
      const part = await Promise.all(pids.slice(i, i + 48).map(pid => readProcess(pid, now)));
      for (const p of part) if (p) processes.push(p);
    }
    const live = new Set(processes.map(p => p.pid));
    for (const pid of processCpuSamples.keys()) if (!live.has(pid)) processCpuSamples.delete(pid);

    const terminalRoots = new Set([...terminalSessions.values()].filter(s => s.running && s.pid > 0).map(s => s.pid));
    for (const job of jobs.values()) {
      if (!job.running) continue;
      try { const legacyPid = Number(fs.readFileSync(job.pidfile, 'utf8').trim()); if (legacyPid > 1) terminalRoots.add(legacyPid); } catch (e) { /* pidfile belum tersedia */ }
    }
    const terminalTree = new Set(terminalRoots);
    let changed = true;
    while (changed) {
      changed = false;
      for (const p of processes) {
        if (!terminalTree.has(p.pid) && terminalTree.has(p.ppid)) { terminalTree.add(p.pid); changed = true; }
      }
    }
    for (const p of processes) if (terminalTree.has(p.pid)) p.source = 'terminal';
    const protectedIds = protectedProcessIds();
    for (const p of processes) p.protected = protectedIds.has(p.pid);

    const memTotal = os.totalmem();
    let memAvailable = os.freemem();
    try {
      const mem = fs.readFileSync('/proc/meminfo', 'utf8');
      const m = mem.match(/^MemAvailable:\s+(\d+)\s+kB/m);
      if (m) memAvailable = Number(m[1]) * 1024;
    } catch (e) { /* fallback os.freemem */ }
    const cpu = systemCpuUsage();
    for (const p of processes) p.rssPct = memTotal > 0 ? (p.rss / memTotal) * 100 : 0;
    processes.sort((a, b) => b.cpu - a.cpu || b.rss - a.rss);
    return {
      ok: true, sampledAt: now, cpu, mem: { total: memTotal, available: memAvailable, used: Math.max(0, memTotal - memAvailable) },
      count: processes.length, processes
    };
  }

  function protectedProcessIds() {
    const protectedIds = new Set([1, process.pid]);
    let pid = process.pid;
    for (let i = 0; i < 32 && pid > 1; i++) {
      try {
        const p = parseProcStat(fs.readFileSync('/proc/' + pid + '/stat', 'utf8'));
        pid = p.ppid;
        if (pid > 0) protectedIds.add(pid);
      } catch (e) { break; }
    }
    return protectedIds;
  }

  app.get('/api/processes', wrap(async (req, res) => {
    res.json(await scanProcesses());
  }));

  app.post('/api/processes/:pid/signal', wrap(async (req, res) => {
    const pid = Number(req.params.pid);
    if (!Number.isSafeInteger(pid) || pid <= 1) throw new HttpError(400, 'PID tidak valid');
    const body = req.body || {};
    const signal = body.signal === 'KILL' ? 'SIGKILL' : body.signal === 'TERM' ? 'SIGTERM' : null;
    if (!signal) throw new HttpError(400, 'signal tidak didukung');
    const expectedStart = Number(body.startTime);
    if (!Number.isSafeInteger(expectedStart) || expectedStart < 0) throw new HttpError(400, 'identitas proses tidak valid');
    if (protectedProcessIds().has(pid)) throw new HttpError(403, 'proses panel atau proses sistem inti dilindungi');
    let current;
    try { current = parseProcStat(await fsp.readFile('/proc/' + pid + '/stat', 'utf8')); }
    catch (e) { throw new HttpError(404, 'proses sudah tidak ditemukan'); }
    if (current.startTicks !== expectedStart) throw new HttpError(409, 'PID sudah digunakan proses lain, segarkan daftar');
    try { process.kill(pid, signal); }
    catch (e) {
      if (e.code === 'ESRCH') throw new HttpError(404, 'proses sudah berhenti');
      if (e.code === 'EPERM') throw new HttpError(403, 'hak akses OS tidak mengizinkan menghentikan proses ini');
      throw e;
    }
    res.json({ ok: true, pid, signal });
  }));

  app.post('/api/terminal-ticket', wrap(async (req, res) => {
    if (terminalSessions.size >= MAX_TERMINALS) throw new HttpError(429, 'maksimal ' + MAX_TERMINALS + ' terminal aktif');
    const id = crypto.randomBytes(24).toString('hex');
    websocketTickets.set(id, { exp: Date.now() + WS_TICKET_MS, ip: normIp(req.socket.remoteAddress) });
    res.json({ ticket: id, expiresIn: WS_TICKET_MS });
  }));
}

module.exports = registerProcessRoutes;
