'use strict';

const { createPublicShareService } = require('../services/public-share');

function registerPublicShares(app, deps) {
  const { wrap, HttpError, guard, path, fsp, tickets, lstatOrNull } = deps;
  const {
    publicShares, dropPublicUnder, newPublicSlug, publicUrl, mimeByName, normExclude,
    savePublicShares, serveDirShare
  } = createPublicShareService(deps);
  // url publikasi: file /p/slug/nama, folder /p/slug/
  function entryUrl(req, e, key) {
    return publicUrl(req, e.slug, e.type === 'dir' ? '' : (e.name || path.basename(key)));
  }

  // publik, tanpa token
  app.get(['/p/:slug', '/p/:slug/*'], wrap(async (req, res) => {
    const slug = String(req.params.slug || '').toLowerCase();
    if (!/^[a-f0-9]{8,16}$/.test(slug)) return res.status(404).send('tidak ditemukan');
    let entry = null, filePath = null;
    for (const [p, e] of Object.entries(publicShares.files)) {
      if (e.slug === slug) { entry = e; filePath = p; break; }
    }
    if (!entry || !entry.active) return res.status(404).send('tidak dipublikasikan');
    if (entry.type === 'dir') {
      let root;
      try { root = await guard(filePath); } catch (e) { return res.status(404).send('tidak ditemukan'); }
      return serveDirShare(req, res, entry, root);
    }
    let real;
    try { real = await guard(filePath); } catch (e) { return res.status(404).send('tidak ditemukan'); }
    const st = await lstatOrNull(real);
    if (!st || !st.isFile()) return res.status(404).send('bukan file');
    entry.hits = (entry.hits || 0) + 1;
    entry.lastAccess = Date.now();
    try { savePublicShares(); } catch (e) { /* abaikan */ }
    res.set({
      'Content-Type': mimeByName(entry.name || path.basename(real)),
      'Content-Length': String(st.size),
      'Content-Disposition': 'inline; filename="' + String(entry.name || path.basename(real)).replace(/["\\]/g, '_') + '"',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Cache-Control': 'public, max-age=120',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox"
    });
    res.sendFile(real, { dotfiles: 'allow' }, err => {
      if (err && !res.headersSent) res.status(404).end();
    });
  }));
  app.options(['/p/:slug', '/p/:slug/*'], (req, res) => {
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }).status(204).end();
  });

  app.get('/api/public', wrap(async (req, res) => {
    const items = [];
    for (const [filePath, e] of Object.entries(publicShares.files)) {
      const st = await lstatOrNull(filePath);
      const isDir = e.type === 'dir';
      items.push({
        path: filePath,
        name: e.name || path.basename(filePath),
        type: isDir ? 'dir' : 'file',
        recursive: isDir ? !!e.recursive : undefined,
        exclude: isDir ? (e.exclude || []) : undefined,
        slug: e.slug,
        active: !!e.active,
        url: entryUrl(req, e, filePath),
        createdAt: e.createdAt || null,
        updatedAt: e.updatedAt || null,
        hits: e.hits || 0,
        lastAccess: e.lastAccess || null,
        exists: !!(st && (isDir ? st.isDirectory() : st.isFile())),
        size: st && st.isFile() ? st.size : null
      });
    }
    items.sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    res.json({ items });
  }));

  app.post('/api/public/publish', wrap(async (req, res) => {
    const body = req.body || {};
    const input = body.path;
    if (typeof input !== 'string') throw new HttpError(400, 'path wajib');
    const real = await guard(input);
    const st = await fsp.lstat(real);
    const isDir = st.isDirectory();
    if (!isDir && !st.isFile()) throw new HttpError(400, 'hanya file atau folder yang bisa dipublikasikan');
    if (isDir && real === '/') throw new HttpError(400, 'folder / terlalu luas untuk dipublikasikan');
    const name = path.basename(real);
    const now = Date.now();
    let e = publicShares.files[real];
    // jenisnya berubah (file jadi folder atau sebaliknya) → dianggap entri baru
    if (e && (e.type === 'dir') !== isDir) e = null;
    if (!e) {
      // entri baru / setelah dihapus dari data → slug random baru
      e = { slug: newPublicSlug(), name, active: true, createdAt: now, updatedAt: now, hits: 0, lastAccess: null };
      if (isDir) { e.type = 'dir'; e.recursive = false; e.exclude = []; }
      publicShares.files[real] = e;
    } else {
      // cabut lalu publish lagi → slug tetap
      e.name = name;
      e.active = true;
      e.updatedAt = now;
      if (!e.slug) e.slug = newPublicSlug();
    }
    if (isDir) {
      if (typeof body.recursive === 'boolean') e.recursive = body.recursive;
      if (body.exclude !== undefined) e.exclude = normExclude(body.exclude);
    }
    savePublicShares();
    res.json({
      ok: true,
      path: real,
      name: e.name,
      type: isDir ? 'dir' : 'file',
      recursive: isDir ? !!e.recursive : undefined,
      exclude: isDir ? e.exclude : undefined,
      slug: e.slug,
      active: true,
      url: entryUrl(req, e, real),
      hits: e.hits || 0
    });
  }));

  // ubah mode dan pengecualian folder yang sudah dipublikasikan
  app.post('/api/public/settings', wrap(async (req, res) => {
    const body = req.body || {};
    if (typeof body.path !== 'string') throw new HttpError(400, 'path wajib');
    const real = await guard(body.path);
    const e = publicShares.files[real];
    if (!e || e.type !== 'dir') throw new HttpError(404, 'folder belum pernah dipublikasikan');
    if (typeof body.recursive === 'boolean') e.recursive = body.recursive;
    if (body.exclude !== undefined) e.exclude = normExclude(body.exclude);
    e.updatedAt = Date.now();
    savePublicShares();
    res.json({ ok: true, path: real, recursive: !!e.recursive, exclude: e.exclude || [] });
  }));

  app.post('/api/public/unpublish', wrap(async (req, res) => {
    const input = req.body && req.body.path;
    if (typeof input !== 'string') throw new HttpError(400, 'path wajib');
    const real = await guard(input);
    const e = publicShares.files[real];
    if (!e) throw new HttpError(404, 'belum pernah dipublikasikan');
    e.active = false;
    e.updatedAt = Date.now();
    savePublicShares();
    res.json({
      ok: true,
      path: real,
      name: e.name,
      slug: e.slug,
      active: false,
      url: entryUrl(req, e, real)
    });
  }));

  // hapus entri dari database publikasi (bukan file fisik) → publish lagi dapat URL baru
  app.post('/api/public/remove', wrap(async (req, res) => {
    const input = req.body && req.body.path;
    if (typeof input !== 'string') throw new HttpError(400, 'path wajib');
    const real = await guard(input);
    const e = publicShares.files[real];
    if (!e) throw new HttpError(404, 'tidak ada di data publikasi');
    const snapshot = { path: real, name: e.name, slug: e.slug };
    delete publicShares.files[real];
    savePublicShares();
    res.json({ ok: true, removed: snapshot });
  }));

  app.get('/dl/:id', (req, res) => {
    const t = tickets.get(req.params.id);
    if (!t || t.exp < Date.now()) { tickets.delete(req.params.id); return res.status(404).send('tiket kedaluwarsa'); }
    res.set('Content-Security-Policy', "default-src 'none'; sandbox");
    const cb = err => { if (err && !res.headersSent) res.status(404).end(); };
    if (t.inline) res.sendFile(t.real, { dotfiles: 'allow' }, cb);
    else res.download(t.real, path.basename(t.real), { dotfiles: 'allow' }, cb);
  });
  return { publicShares, dropPublicUnder };
}

module.exports = registerPublicShares;
