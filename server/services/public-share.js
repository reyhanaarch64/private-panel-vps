'use strict';

const { createShareRenderer } = require('./public-share-renderer');

function createPublicShareService(deps) {
  const { SCOPE, BLOCK, HOST, PORT, fs, fsp, path, crypto, os, archiver,
    tickets, lstatOrNull, inBlock, exists, publicDbPath } = deps;
  // ===== public file shares (URL stabil per path) =====
  const PUBLIC_DB = publicDbPath;
  let publicShares = { files: {} }; // path -> { slug, name, active, createdAt, updatedAt, hits, lastAccess }

  function loadPublicShares() {
    try {
      const raw = fs.readFileSync(PUBLIC_DB, 'utf8');
      const data = JSON.parse(raw);
      if (data && data.files && typeof data.files === 'object') publicShares = data;
      else publicShares = { files: {} };
    } catch (e) {
      publicShares = { files: {} };
    }
  }
  function savePublicShares() {
    const tmp = PUBLIC_DB + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(publicShares, null, 2));
    fs.renameSync(tmp, PUBLIC_DB);
  }
  loadPublicShares();

  // hapus entri publikasi buat path yang dihapus (termasuk isi folder), jadi slug baru kalau dibuat lagi
  function dropPublicUnder(real) {
    let changed = false;
    for (const p of Object.keys(publicShares.files)) {
      if (p === real || p.startsWith(real + '/')) {
        delete publicShares.files[p];
        changed = true;
      }
    }
    if (changed) {
      try { savePublicShares(); } catch (e) { /* abaikan */ }
    }
  }

  function newPublicSlug() {
    // random 10 hex; pastikan belum dipakai
    for (let i = 0; i < 8; i++) {
      const s = crypto.randomBytes(5).toString('hex');
      let used = false;
      for (const e of Object.values(publicShares.files)) {
        if (e.slug === s) { used = true; break; }
      }
      if (!used) return s;
    }
    return crypto.randomBytes(8).toString('hex');
  }
  function publicUrl(req, slug, name) {
    const host = req.get('x-forwarded-host') || req.get('host') || (HOST + ':' + PORT);
    const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
    const safe = encodeURIComponent(name).replace(/%2F/gi, '');
    return proto + '://' + host + '/p/' + slug + '/' + safe;
  }
  function mimeByName(name) {
    const ext = String(name).toLowerCase().split('.').pop();
    const map = {
      js: 'application/javascript; charset=utf-8', mjs: 'application/javascript; charset=utf-8',
      cjs: 'application/javascript; charset=utf-8', json: 'application/json; charset=utf-8',
      css: 'text/css; charset=utf-8', html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
      md: 'text/markdown; charset=utf-8', markdown: 'text/markdown; charset=utf-8',
      txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8',
      xml: 'application/xml; charset=utf-8', svg: 'image/svg+xml',
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon',
      pdf: 'application/pdf', zip: 'application/zip', gz: 'application/gzip', tgz: 'application/gzip',
      mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm',
      wasm: 'application/wasm', map: 'application/json; charset=utf-8', sh: 'text/x-shellscript; charset=utf-8',
      py: 'text/x-python; charset=utf-8', ts: 'text/typescript; charset=utf-8', go: 'text/plain; charset=utf-8'
    };
    return map[ext] || 'application/octet-stream';
  }

  // ===== publikasi folder: daftar isi + download, sumbernya folder asli (live) =====
  const globCache = new Map();
  function globRe(g) {
    let re = globCache.get(g);
    if (!re) {
      re = new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + '$');
      globCache.set(g, re);
    }
    return re;
  }

  // daftar pengecualian: pisah baris atau koma, nama (".git", "*.log") atau path relatif ("sub/cache")
  function normExclude(v) {
    const raw = Array.isArray(v) ? v : String(v || '').split(/[\n,]/);
    const out = [];
    for (let x of raw) {
      x = String(x).trim().replace(/^(\.\/)+/, '').replace(/^\/+/, '').replace(/\/+$/, '');
      if (!x || x.length > 200 || x.includes('\0') || out.includes(x)) continue;
      out.push(x);
      if (out.length >= 100) break;
    }
    return out;
  }

  // rel = path relatif dari folder publikasi, tanpa slash di depan
  function isExcluded(rel, pats) {
    if (!rel || !pats || !pats.length) return false;
    const segs = rel.split('/');
    for (const pat of pats) {
      const re = globRe(pat);
      if (pat.includes('/')) {
        for (let i = 1; i <= segs.length; i++) if (re.test(segs.slice(0, i).join('/'))) return true;
      } else if (segs.some(sg => re.test(sg))) return true;
    }
    return false;
  }

  // path harus tetap di dalam folder publikasi (symlink keluar ditolak), bukan folder panel, dan tidak dikecualikan
  async function shareResolve(root, segs, e) {
    const rel = segs.join('/');
    if (rel && isExcluded(rel, e.exclude)) return null;
    let real;
    try { real = await fsp.realpath(path.join(root, ...segs)); } catch (err) { return null; }
    if (real !== root && !real.startsWith(root + '/')) return null;
    if (inBlock(real)) return null;
    if (real !== root && isExcluded(real.slice(root.length + 1), e.exclude)) return null;
    return real;
  }

  async function shareList(root, dir, e) {
    let names;
    try { names = await fsp.readdir(dir); } catch (err) { return { items: [], truncated: false }; }
    const items = [];
    let truncated = false;
    for (const name of names) {
      const abs = path.join(dir, name);
      if (isExcluded(abs.slice(root.length + 1), e.exclude)) continue;
      let real;
      try { real = await fsp.realpath(abs); } catch (err) { continue; }
      if (real === root || !real.startsWith(root + '/') || inBlock(real)) continue;
      if (isExcluded(real.slice(root.length + 1), e.exclude)) continue;
      let st;
      try { st = await fsp.stat(real); } catch (err) { continue; }
      const isDir = st.isDirectory();
      if (!isDir && !st.isFile()) continue;
      if (isDir && !e.recursive) continue;
      items.push({ name, isDir, size: st.size, mtime: st.mtimeMs });
      if (items.length >= 5000) { truncated = true; break; }
    }
    items.sort((a, b) => (a.isDir === b.isDir ? 0 : a.isDir ? -1 : 1) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    return { items, truncated };
  }

  const { renderShareHtml, shareTextProbe, renderShareText } = createShareRenderer({ fsp });

  const SHARE_ZIP_MAX_FILES = 20000;
  const SHARE_ZIP_MAX_BYTES = 512 * 1024 * 1024;
  let shareZipBusy = 0;

  // kumpulin file buat zip, aturan exclude dan symlink sama kayak daftar isi. null kalau kegedean
  async function shareZipCollect(root, startReal, startRel, e) {
    const files = [];
    let total = 0;
    let over = false;
    async function walk(dirReal, relShare, relZip, chain) {
      let names;
      try { names = await fsp.readdir(dirReal); } catch (err) { return; }
      for (const name of names) {
        if (over) return;
        const nShare = relShare ? relShare + '/' + name : name;
        if (isExcluded(nShare, e.exclude)) continue;
        let real;
        try { real = await fsp.realpath(path.join(dirReal, name)); } catch (err) { continue; }
        if (real === root || !real.startsWith(root + '/') || inBlock(real)) continue;
        if (isExcluded(real.slice(root.length + 1), e.exclude)) continue;
        let st;
        try { st = await fsp.stat(real); } catch (err) { continue; }
        const nZip = relZip ? relZip + '/' + name : name;
        if (st.isDirectory()) {
          // symlink yang muter balik ke folder induk dilewati
          if (!e.recursive || chain.has(real)) continue;
          chain.add(real);
          await walk(real, nShare, nZip, chain);
          chain.delete(real);
        } else if (st.isFile()) {
          files.push({ real, name: nZip });
          total += st.size;
          if (files.length > SHARE_ZIP_MAX_FILES || total > SHARE_ZIP_MAX_BYTES) { over = true; return; }
        }
      }
    }
    await walk(startReal, startRel, '', new Set([startReal]));
    return over ? null : { files, total };
  }

  async function shareServeZip(req, res, e, root, real, segs) {
    const top = segs.length ? segs[segs.length - 1] : (e.name || path.basename(root) || 'folder');
    res.set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox"
    });
    res.attachment(top + '.zip');
    if (req.method === 'HEAD') return res.end();
    if (shareZipBusy >= 2) {
      res.removeHeader('Content-Disposition');
      res.set('Retry-After', '5');
      return res.status(429).type('text/plain').send('server lagi sibuk bikin zip, coba lagi sebentar');
    }
    shareZipBusy++;
    let released = false;
    const release = () => { if (!released) { released = true; shareZipBusy--; } };
    try {
      const got = await shareZipCollect(root, real, segs.join('/'), e);
      if (!got) {
        release();
        res.removeHeader('Content-Disposition');
        return res.status(413).type('text/plain').send('folder terlalu besar buat di-zip (maks ' + SHARE_ZIP_MAX_FILES + ' file / ' + shareBytes(SHARE_ZIP_MAX_BYTES) + ')');
      }
      shareHit(e);
      const archive = archiver('zip', { zlib: { level: 1 } });
      archive.on('warning', () => {});
      archive.on('error', () => { release(); res.destroy(); });
      res.on('close', () => {
        if (!res.writableFinished) archive.abort();
        release();
      });
      archive.pipe(res);
      for (const f of got.files) archive.file(f.real, { name: top + '/' + f.name });
      archive.finalize();
    } catch (err) {
      release();
      if (!res.headersSent) res.status(500).type('text/plain').send('gagal bikin zip');
      else res.destroy();
    }
  }

  function shareHit(e) {
    e.hits = (e.hits || 0) + 1;
    e.lastAccess = Date.now();
    try { savePublicShares(); } catch (err) { /* abaikan */ }
  }

  async function serveDirShare(req, res, e, root) {
    if (root === '/') return res.status(404).send('tidak ditemukan');
    const rst = await lstatOrNull(root);
    if (!rst || !rst.isDirectory()) return res.status(404).send('folder tidak ada');
    const segs = String(req.params[0] || '').split('/').filter(Boolean);
    if (segs.some(sg => sg === '.' || sg === '..' || sg.includes('\0'))) return res.status(404).send('tidak ditemukan');
    // mode biasa: cuma isi folder, sub folder tidak bisa dibuka
    if (!e.recursive && segs.length > 1) return res.status(404).send('tidak ditemukan');
    const real = await shareResolve(root, segs, e);
    if (!real) return res.status(404).send('tidak ditemukan');
    let st;
    try { st = await fsp.stat(real); } catch (err) { return res.status(404).send('tidak ditemukan'); }
    if (st.isDirectory()) {
      if (!e.recursive && real !== root) return res.status(404).send('tidak ditemukan');
      const url = req.originalUrl.split('?')[0];
      if (!url.endsWith('/')) return res.redirect(302, url + '/');
      if (req.query.zip !== undefined) return shareServeZip(req, res, e, root, real, segs);
      const { items, truncated } = await shareList(root, real, e);
      shareHit(e);
      res.set({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
      });
      return res.send(renderShareHtml(e, e.slug, segs, items, truncated));
    }
    if (!st.isFile()) return res.status(404).send('tidak ditemukan');
    // browser buka file teks: masuk halaman lihat kode. curl/wget/fetch (Accept bukan html) tetap dapat file mentah
    const wantsPage = /text\/html/i.test(req.get('accept') || '') && req.query.dl === undefined;
    if (wantsPage && segs.length) {
      const v = await shareTextProbe(real, st.size);
      if (v) {
        shareHit(e);
        const nonce = crypto.randomBytes(16).toString('base64');
        res.set({
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Vary': 'Accept',
          'X-Content-Type-Options': 'nosniff',
          'X-Robots-Tag': 'noindex',
          'Referrer-Policy': 'no-referrer',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
        });
        return res.send(renderShareText(e, e.slug, segs, v, st.size, nonce));
      }
    }
    shareHit(e);
    const fname = segs.length ? segs[segs.length - 1] : path.basename(real);
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox"
    });
    res.vary('Accept');
    res.download(real, fname, { dotfiles: 'allow' }, err => {
      if (err && !res.headersSent) res.status(404).end();
    });
  }
  return {
    publicShares, dropPublicUnder, newPublicSlug, publicUrl, mimeByName,
    normExclude, savePublicShares, serveDirShare
  };
}

module.exports = { createPublicShareService };
