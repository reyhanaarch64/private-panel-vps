'use strict';

const fsp = require('fs').promises;
const path = require('path');

function registerScriptJobs(app, deps) {
  const { wrap, HttpError, guard, rand, fs, os, spawn, StringDecoder, terminalSessions, getCopilotApi } = deps;
  // jalankan skrip .sh/.bash di pty (lewat 'script'), output diambil pakai long-poll
  const jobs = new Map();
  const MAX_BUF = 2 * 1024 * 1024;
  const KEEP_BUF = Math.floor(MAX_BUF * 0.75);
  const MAX_RUNNING = 4;
  const shq = v => "'" + String(v).replace(/'/g, "'\\''") + "'";

  function jobFlushSoon(job) {
    if (job.flushT) return;
    job.flushT = setTimeout(() => {
      job.flushT = null;
      for (const w of job.waiters.splice(0)) {
        clearTimeout(w.timer);
        if (!w.res.writableEnded) w.res.json(jobView(job, w.from));
      }
    }, 40);
  }
  function jobAppend(job, str) {
    if (!str) return;
    job.buf += str;
    if (job.buf.length > MAX_BUF) {
      const cut = job.buf.length - KEEP_BUF;
      job.buf = job.buf.slice(cut);
      job.base += cut;
    }
    jobFlushSoon(job);
  }
  function jobView(job, from) {
    const start = Math.max(from, job.base);
    return {
      data: job.buf.slice(start - job.base), next: job.base + job.buf.length, truncated: from < job.base,
      running: job.running, code: job.code, killed: job.killed, name: job.name, path: job.path
    };
  }
  function finishJob(job, code) {
    if (!job.running) return;
    job.running = false;
    job.code = code;
    job.ended = Date.now();
    try { fs.rmSync(job.pidfile, { force: true }); } catch (e) { /* abaikan */ }
    jobFlushSoon(job);
  }
  function pruneJobs() {
    const now = Date.now();
    for (const [id, j] of jobs) if (!j.running && now - j.ended > 30 * 60 * 1000) jobs.delete(id);
    const fin = [...jobs.values()].filter(j => !j.running).sort((a, b) => a.ended - b.ended);
    while (fin.length > 15) jobs.delete(fin.shift().id);
  }
  setInterval(pruneJobs, 5 * 60 * 1000).unref();

  function startJob(real, cols) {
    if ([...jobs.values()].filter(j => j.running).length >= MAX_RUNNING) throw new HttpError(429, 'terlalu banyak skrip yang sedang jalan (maks ' + MAX_RUNNING + ')');
    let first = '';
    try {
      const fd = fs.openSync(real, 'r');
      const b = Buffer.alloc(120);
      const n = fs.readSync(fd, b, 0, 120, 0);
      fs.closeSync(fd);
      first = b.toString('utf8', 0, n).split('\n')[0];
    } catch (e) { /* tanpa shebang */ }
    const sh = /^#!.*\bsh\b/.test(first) && !/bash/.test(first) ? 'sh' : 'bash';
    const id = rand();
    const pidfile = path.join(os.tmpdir(), 'vpsacc-' + id + '.pid');
    const cmd = 'stty cols ' + cols + ' rows 30 2>/dev/null; echo $$ > ' + shq(pidfile) + '; exec ' + sh + ' ' + shq(real);
    const job = {
      id, name: path.basename(real), path: real, started: Date.now(), ended: 0, running: true, code: null, killed: false,
      buf: '', base: 0, waiters: [], flushT: null, pidfile, child: null
    };
    const env = Object.assign({}, process.env, { TERM: 'xterm-256color', COLUMNS: String(cols), LINES: '30', SHELL: '/bin/bash' });
    const child = spawn('script', ['-qfec', cmd, '/dev/null'], { cwd: path.dirname(real), env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    job.child = child;
    const dec = new StringDecoder('utf8');
    child.stdout.on('data', b => jobAppend(job, dec.write(b)));
    child.stderr.on('data', b => jobAppend(job, b.toString('utf8')));
    child.stdin.on('error', () => {});
    child.on('error', e => { jobAppend(job, '\r\n[gagal menjalankan: ' + e.message + ']\r\n'); finishJob(job, 127); });
    child.on('close', code => finishJob(job, code));
    jobs.set(id, job);
    pruneJobs();
    return job;
  }

  function killJob(job, force) {
    job.killed = true;
    let pid = 0;
    try { pid = parseInt(fs.readFileSync(job.pidfile, 'utf8'), 10); } catch (e) { /* belum ada */ }
    const sig = force ? 'SIGKILL' : 'SIGTERM';
    const tryKill = p => { try { process.kill(p, sig); return true; } catch (e) { return false; } };
    let ok = false;
    if (pid > 1) ok = tryKill(-pid);
    if (!ok && job.child && job.child.pid) ok = tryKill(-job.child.pid) || tryKill(job.child.pid);
    if (!force) setTimeout(() => { if (job.running) killJob(job, true); }, 4000).unref();
  }
  function killAll() {
    for (const j of jobs.values()) if (j.running) killJob(j, true);
    for (const session of terminalSessions.values()) {
      if (session.running) { try { session.pty.kill('SIGKILL'); } catch (e) { /* sudah berhenti */ } }
    }
  }
  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    killAll();
    const copilotApi = getCopilotApi();
    if (copilotApi) {
      try { await Promise.race([copilotApi.stop(), new Promise(resolve => setTimeout(resolve, 2000))]); }
      catch (e) { console.error('[copilot] gagal menutup SDK', e); }
    }
    process.exit(0);
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  const jobOf = id => {
    const j = jobs.get(String(id));
    if (!j) throw new HttpError(404, 'proses tidak ditemukan atau sudah dihapus');
    return j;
  };

  app.post('/api/run', wrap(async (req, res) => {
    const b = req.body || {};
    const real = await guard(b.path);
    if (!/\.(sh|bash)$/i.test(real)) throw new HttpError(400, 'hanya file .sh atau .bash yang bisa dijalankan');
    if (!(await fsp.stat(real)).isFile()) throw new HttpError(400, 'bukan file');
    const job = startJob(real, Math.max(40, Math.min(200, parseInt(b.cols, 10) || 80)));
    res.json({ id: job.id, name: job.name, path: job.path, started: job.started });
  }));

  app.get('/api/run', (req, res) => {
    res.json({
      jobs: [...jobs.values()].sort((a, b) => b.started - a.started).map(j => ({
        id: j.id, name: j.name, path: j.path, started: j.started, running: j.running, code: j.code, killed: j.killed
      }))
    });
  });

  app.get('/api/run/:id', wrap(async (req, res) => {
    const job = jobOf(req.params.id);
    const from = Math.max(0, parseInt(req.query.from, 10) || 0);
    const wait = Math.min(parseInt(req.query.wait, 10) || 0, 25);
    const v = jobView(job, from);
    if (v.data.length || !job.running || !wait) return res.json(v);
    const w = { res, from, timer: null };
    const drop = () => { clearTimeout(w.timer); const i = job.waiters.indexOf(w); if (i >= 0) job.waiters.splice(i, 1); };
    w.timer = setTimeout(() => { drop(); if (!res.writableEnded) res.json(jobView(job, from)); }, wait * 1000);
    job.waiters.push(w);
    res.on('close', drop);
  }));

  app.post('/api/run/:id/input', wrap(async (req, res) => {
    const job = jobOf(req.params.id);
    const data = (req.body || {}).data;
    if (typeof data !== 'string' || data.length > 4096) throw new HttpError(400, 'data tidak valid');
    if (!job.running) throw new HttpError(409, 'proses sudah selesai');
    job.child.stdin.write(data);
    res.json({ ok: true });
  }));

  app.post('/api/run/:id/kill', wrap(async (req, res) => {
    const job = jobOf(req.params.id);
    if (!job.running) throw new HttpError(409, 'proses sudah selesai');
    killJob(job, !!(req.body || {}).force);
    res.json({ ok: true });
  }));
  return { jobs, killAll };
}

module.exports = registerScriptJobs;
