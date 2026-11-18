'use strict';

const crypto = require('crypto');

function registerPackageRoutes(app, deps) {
  const { wrap, SCOPE, spawn } = deps;
  // package manager (apt/dpkg): lihat + cari bisa di semua mode, pasang cuma di scope full
  const { execFile } = require('child_process');
  const PKG_NAME_RE = /^[a-z0-9][a-z0-9+.\-]*$/;
  const PKG_RECOMMENDED = [
    { name: 'git', desc: 'Kontrol versi kode' },
    { name: 'curl', desc: 'Ambil/kirim data lewat HTTP dari terminal' },
    { name: 'wget', desc: 'Download file dari web' },
    { name: 'htop', desc: 'Pantau CPU dan RAM interaktif' },
    { name: 'tmux', desc: 'Sesi terminal yang tetap jalan walau putus' },
    { name: 'nano', desc: 'Editor teks simpel' },
    { name: 'vim', desc: 'Editor teks di terminal' },
    { name: 'python3', desc: 'Interpreter Python 3' },
    { name: 'python3-pip', desc: 'Pemasang library Python (pip)' },
    { name: 'build-essential', desc: 'Compiler gcc, g++, make' },
    { name: 'ffmpeg', desc: 'Olah video dan audio' },
    { name: 'imagemagick', desc: 'Olah gambar lewat command line' },
    { name: 'zip', desc: 'Buat arsip zip' },
    { name: 'unzip', desc: 'Ekstrak arsip zip' },
    { name: 'jq', desc: 'Olah JSON di terminal' },
    { name: 'ripgrep', desc: 'Cari teks di banyak file, super cepat' },
    { name: 'rsync', desc: 'Sinkron dan salin file' },
    { name: 'tree', desc: 'Tampilkan struktur folder' },
    { name: 'ncdu', desc: 'Cek pemakaian disk per folder' },
    { name: 'net-tools', desc: 'ifconfig, netstat, dan kawan-kawan' },
    { name: 'sqlite3', desc: 'Database SQLite via command line' },
    { name: 'nginx', desc: 'Web server dan reverse proxy' },
    { name: 'redis-server', desc: 'Database cache in-memory' },
    { name: 'ufw', desc: 'Firewall yang gampang diatur' },
    { name: 'fail2ban', desc: 'Blokir IP yang brute force login' },
    { name: 'certbot', desc: 'Sertifikat SSL gratis (Let\'s Encrypt)' },
    { name: 'bubblewrap', desc: 'Sandbox terminal untuk scope terbatas' }
  ];

  const pkgJobs = new Map();
  let pkgActive = null;

  function runOut(cmd, args) {
    return new Promise(resolve => {
      execFile(cmd, args, { timeout: 20000, maxBuffer: 32 * 1024 * 1024, env: Object.assign({}, process.env, { LC_ALL: 'C' }) }, (err, stdout) => {
        resolve(String(stdout || ''));
      });
    });
  }

  // daftar package yang statusnya terpasang (ii)
  async function pkgInstalled() {
    const out = await runOut('dpkg-query', ['-W', '-f', '${db:Status-Abbrev}\t${Package}\t${Version}\t${Installed-Size}\t${binary:Summary}\n']);
    const map = new Map();
    for (const line of out.split('\n')) {
      const f = line.split('\t');
      if (f.length < 5 || f[0].trim() !== 'ii') continue;
      map.set(f[1], { name: f[1], version: f[2], size: (parseInt(f[3], 10) || 0) * 1024, desc: f.slice(4).join(' ') });
    }
    return map;
  }

  async function pkgManualSet() {
    const out = await runOut('apt-mark', ['showmanual']);
    return new Set(out.split('\n').map(x => x.trim()).filter(Boolean));
  }

  function pkgJobInfo(j) {
    return j ? { id: j.id, kind: j.kind, name: j.name, status: j.status, code: j.code } : null;
  }

  // jalanin apt-get di background, log disimpan buat dipoll. cuma satu job dalam satu waktu
  function startPkgJob(kind, name, args) {
    if (pkgActive && pkgActive.status === 'running') return null;
    const j = { id: crypto.randomBytes(6).toString('hex'), kind, name, status: 'running', code: null, log: '$ apt-get ' + args.join(' ') + '\n' };
    pkgJobs.set(j.id, j);
    for (const id of [...pkgJobs.keys()].slice(0, -5)) pkgJobs.delete(id);
    pkgActive = j;
    const add = d => { if (j.log.length < 300000) j.log += d.toString('utf8'); };
    const p = spawn('apt-get', args, {
      env: Object.assign({}, process.env, { DEBIAN_FRONTEND: 'noninteractive', LC_ALL: 'C' }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    p.stdout.on('data', add);
    p.stderr.on('data', add);
    p.on('error', e => { add('\n[gagal jalanin apt-get: ' + e.message + ']\n'); j.status = 'failed'; j.code = -1; });
    p.on('close', code => {
      j.code = code;
      if (j.status === 'running') j.status = code === 0 ? 'done' : 'failed';
    });
    return j;
  }

  function pkgGate(res) {
    if (SCOPE === '/') return true;
    res.status(403).json({ error: 'pasang package dimatikan di scope terbatas, ubah scope ke full di config.json lalu restart' });
    return false;
  }

  app.get('/api/pkg/overview', wrap(async (req, res) => {
    const [inst, manual] = await Promise.all([pkgInstalled(), pkgManualSet()]);
    const packages = [...inst.values()]
      .map(x => Object.assign({}, x, { manual: manual.has(x.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    // rekomendasi yang sudah terpasang otomatis pindah ke daftar terpasang
    const recommended = PKG_RECOMMENDED.filter(r => !inst.has(r.name));
    res.json({ full: SCOPE === '/', packages, recommended, job: pkgJobInfo(pkgActive) });
  }));

  app.get('/api/pkg/search', wrap(async (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    if (!/^[a-z0-9][a-z0-9+._ \-]{0,59}$/.test(q) || words.some(w => w[0] === '-')) {
      return res.status(400).json({ error: 'kata kunci tidak valid' });
    }
    const pats = words.map(w => w.replace(/[.+]/g, '\\$&'));
    const [out, inst] = await Promise.all([runOut('apt-cache', ['search', '--names-only'].concat(pats)), pkgInstalled()]);
    const rows = [];
    for (const line of out.split('\n')) {
      const i = line.indexOf(' - ');
      if (i < 1) continue;
      const name = line.slice(0, i);
      if (inst.has(name)) continue;
      rows.push({ name, desc: line.slice(i + 3) });
    }
    const w0 = words[0];
    const rank = r => (r.name === q ? 0 : r.name.startsWith(w0) ? 1 : r.name.includes(w0) ? 2 : 3);
    rows.sort((a, b) => rank(a) - rank(b) || a.name.length - b.name.length || a.name.localeCompare(b.name));
    res.json({ q, total: rows.length, results: rows.slice(0, 60) });
  }));

  app.post('/api/pkg/install', wrap(async (req, res) => {
    if (!pkgGate(res)) return;
    const name = String((req.body || {}).name || '').trim().toLowerCase();
    if (!PKG_NAME_RE.test(name) || name.endsWith('-')) return res.status(400).json({ error: 'nama package tidak valid' });
    const j = startPkgJob('install', name, ['install', '-y', '--no-remove', '-o', 'Dpkg::Options::=--force-confold', name]);
    if (!j) return res.status(409).json({ error: 'masih ada proses package yang jalan' });
    res.json({ job: pkgJobInfo(j) });
  }));

  app.post('/api/pkg/update', wrap(async (req, res) => {
    if (!pkgGate(res)) return;
    const j = startPkgJob('update', '', ['update']);
    if (!j) return res.status(409).json({ error: 'masih ada proses package yang jalan' });
    res.json({ job: pkgJobInfo(j) });
  }));

  app.get('/api/pkg/job/:id', wrap(async (req, res) => {
    const j = pkgJobs.get(String(req.params.id));
    if (!j) return res.status(404).json({ error: 'job tidak ditemukan' });
    const from = Math.max(0, parseInt(req.query.from, 10) || 0);
    res.json({ status: j.status, code: j.code, log: j.log.slice(from), next: j.log.length });
  }));
}

module.exports = registerPackageRoutes;
