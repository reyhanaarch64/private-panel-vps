'use strict';

function registerFileRoutes(app, deps) {
  const { wrap, HttpError, guard, SCOPE, publicShares, dropPublicUnder, fs, fsp, path,
    Busboy, pipeline, archiver, extract, MEDIA_RE, rand, eachItem, asList, validName,
    describe, inBlock, lstatOrNull, exists, freeName, batchRes, describeErr, MAX_READ,
    tickets, TICKET_MS, crypto } = deps;
  app.get('/api/list', wrap(async (req, res) => {
    const dir = await guard(req.query.path || SCOPE, { allowBlock: true });
    if (!(await fsp.stat(dir)).isDirectory()) throw new HttpError(400, 'bukan folder');
    const names = await fsp.readdir(dir);
    const items = [];
    for (let i = 0; i < names.length; i += 64) {
      const part = await Promise.all(names.slice(i, i + 64).map(n => describe(dir, n)));
      for (const it of part) if (it) items.push(it);
    }
    // tandai file yang pernah dipublikasi (aktif / nonaktif)
    for (const it of items) {
      if (it.type !== 'file' && it.type !== 'dir') continue;
      let key = path.join(dir, it.name);
      if (it.link) {
        try { key = await fsp.realpath(key); } catch (e) { continue; }
      }
      const e = publicShares.files[key];
      if (e) it.pub = e.active ? 'active' : 'inactive';
    }
    res.json({ path: dir, parent: dir === SCOPE || dir === '/' ? null : path.dirname(dir), scope: SCOPE, items });
  }));

  app.get('/api/info', wrap(async (req, res) => {
    const real = await guard(req.query.path, { follow: false, allowBlock: true });
    const st = await fsp.lstat(real);
    const out = {
      path: real, name: path.basename(real) || '/', type: st.isDirectory() ? 'dir' : 'file', link: st.isSymbolicLink(),
      size: st.size, mtime: st.mtimeMs, atime: st.atimeMs, ctime: st.ctimeMs, birth: st.birthtimeMs,
      mode: (st.mode & 0o7777).toString(8), uid: st.uid, gid: st.gid
    };
    if (out.link) {
      try {
        out.target = await fsp.readlink(real);
        const t = await fsp.stat(real);
        out.type = t.isDirectory() ? 'dir' : 'file';
        out.size = t.size;
      } catch (e) { out.broken = true; }
    }
    res.json(out);
  }));

  app.get('/api/read', wrap(async (req, res) => {
    const real = await guard(req.query.path, { allowBlock: true });
    const st = await fsp.stat(real);
    if (!st.isFile()) throw new HttpError(400, 'bukan file');
    if (st.size > MAX_READ) throw new HttpError(413, 'file terlalu besar (maks 5 MB)');
    const buf = await fsp.readFile(real);
    if (buf.subarray(0, 8000).includes(0)) throw new HttpError(415, 'bukan file teks');
    res.json({ path: real, name: path.basename(real), size: st.size, mtime: st.mtimeMs, mode: (st.mode & 0o7777).toString(8), content: buf.toString('utf8') });
  }));

  app.put('/api/write', wrap(async (req, res) => {
    const b = req.body || {};
    if (typeof b.content !== 'string') throw new HttpError(400, 'content harus string');
    const real = await guard(b.path);
    let mode = 0o644;
    const st = await lstatOrNull(real);
    if (st) {
      if (st.isDirectory()) throw new HttpError(400, 'ini folder');
      mode = st.mode & 0o7777;
    }
    const tmp = path.join(path.dirname(real), '.vpsacc-' + rand() + '.tmp');
    try {
      await fsp.writeFile(tmp, b.content);
      await fsp.chmod(tmp, mode);
      await fsp.rename(tmp, real);
    } catch (e) {
      await fsp.rm(tmp, { force: true });
      throw e;
    }
    res.json({ ok: true, path: real, size: Buffer.byteLength(b.content) });
  }));

  app.post('/api/upload', wrap(async (req, res) => {
    const dir = await guard(req.query.path);
    if (!(await fsp.stat(dir)).isDirectory()) throw new HttpError(400, 'tujuan bukan folder');
    if (!(req.headers['content-type'] || '').startsWith('multipart/form-data')) throw new HttpError(400, 'harus multipart/form-data');
    const overwrite = req.query.overwrite === '1';
    const out = { ok: [], failed: [] };
    const jobs = [];
    let finished = false;
    const bb = Busboy({ headers: req.headers, defParamCharset: 'utf8' });
    bb.on('file', (field, stream, info) => {
      const name = path.basename(String(info.filename || '').replace(/\\/g, '/'));
      if (!validName(name)) { out.failed.push({ path: String(info.filename), error: 'nama file tidak valid' }); stream.resume(); return; }
      const target = path.join(dir, name);
      let cur = null;
      try { cur = fs.lstatSync(target); } catch (e) { /* belum ada */ }
      if (cur && (!overwrite || cur.isDirectory())) {
        out.failed.push({ path: name, error: cur.isDirectory() ? 'ada folder bernama sama' : 'sudah ada' });
        stream.resume();
        return;
      }
      const tmp = path.join(dir, '.vpsacc-' + rand() + '.tmp');
      jobs.push(
        pipeline(stream, fs.createWriteStream(tmp, { mode: 0o644 }))
          .then(() => fsp.rename(tmp, target))
          .then(() => { out.ok.push(name); })
          .catch(async e => {
            await fsp.rm(tmp, { force: true });
            out.failed.push({ path: name, error: describeErr(e).msg });
          })
      );
    });
    bb.on('error', async () => {
      if (finished) return;
      finished = true;
      await Promise.allSettled(jobs);
      if (!res.headersSent) res.status(400).json({ error: 'upload gagal atau terputus' });
    });
    bb.on('close', async () => {
      if (finished) return;
      finished = true;
      await Promise.allSettled(jobs);
      res.json(batchRes(out));
    });
    req.pipe(bb);
  }));

  app.get('/api/download', wrap(async (req, res) => {
    const real = await guard(req.query.path, { allowBlock: true });
    if (!(await fsp.stat(real)).isFile()) throw new HttpError(400, 'bukan file, zip dulu kalau folder');
    res.download(real, path.basename(real), { dotfiles: 'allow' });
  }));

  app.post('/api/ticket', wrap(async (req, res) => {
    const b = req.body || {};
    const real = await guard(b.path, { allowBlock: true });
    if (!(await fsp.stat(real)).isFile()) throw new HttpError(400, 'bukan file');
    const id = crypto.randomBytes(16).toString('hex');
    tickets.set(id, { real, inline: !!b.inline && MEDIA_RE.test(real), exp: Date.now() + TICKET_MS });
    res.json({ url: '/dl/' + id });
  }));

  app.post('/api/delete', wrap(async (req, res) => {
    const r = await eachItem(asList((req.body || {}).paths), async p => {
      const real = await guard(p, { follow: false, destructive: true });
      const st = await lstatOrNull(real);
      await fsp.rm(real, { recursive: true });
      // kalau symlink, cuma link-nya yang hilang, file aslinya masih ada
      if (!(st && st.isSymbolicLink())) dropPublicUnder(real);
    });
    res.json(batchRes(r));
  }));

  app.post('/api/rename', wrap(async (req, res) => {
    const b = req.body || {};
    const r = await eachItem(Array.isArray(b.items) ? b.items : [b], async it => {
      if (!it || !validName(it.newName)) throw new HttpError(400, 'nama baru tidak valid');
      const src = await guard(it.path, { follow: false, destructive: true });
      const dst = path.join(path.dirname(src), it.newName);
      if (dst === src) return src;
      await guard(dst, { follow: false });
      if (await exists(dst)) throw new HttpError(409, 'sudah ada');
      await fsp.rename(src, dst);
      return dst;
    });
    res.json(batchRes(r));
  }));

  app.post('/api/move', wrap(async (req, res) => {
    const b = req.body || {};
    const dest = await dirOf(b.to);
    const r = await eachItem(asList(b.from), async p => {
      const src = await guard(p, { follow: false, destructive: true });
      const target = path.join(dest, path.basename(src));
      if (target === src) throw new HttpError(409, 'sudah di folder ini');
      if (dest === src || dest.startsWith(src + '/')) throw new HttpError(400, 'tidak bisa dipindah ke dalam dirinya sendiri');
      const cur = await lstatOrNull(target);
      if (cur) {
        if (!b.overwrite) throw new HttpError(409, 'sudah ada di tujuan');
        if (cur.isDirectory()) throw new HttpError(409, 'folder bernama sama sudah ada di tujuan');
        await fsp.rm(target);
      }
      try {
        await fsp.rename(src, target);
      } catch (e) {
        if (e.code !== 'EXDEV') throw e;
        await fsp.cp(src, target, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
        await fsp.rm(src, { recursive: true });
      }
      return target;
    });
    res.json(batchRes(r));
  }));

  app.post('/api/copy', wrap(async (req, res) => {
    const b = req.body || {};
    const dest = await dirOf(b.to);
    const overwrite = !!b.overwrite;
    const r = await eachItem(asList(b.from), async p => {
      const src = await guard(p, { follow: false });
      if (dest === src || dest.startsWith(src + '/')) throw new HttpError(400, 'tidak bisa menyalin ke dalam dirinya sendiri');
      let name = path.basename(src);
      if (!overwrite && (await exists(path.join(dest, name)))) name = await freeName(dest, name, 'salinan');
      const target = path.join(dest, name);
      await fsp.cp(src, target, { recursive: true, force: overwrite, errorOnExist: false, verbatimSymlinks: true, preserveTimestamps: true, filter: s => !inBlock(s) });
      return target;
    });
    res.json(batchRes(r));
  }));

  app.post('/api/mkdir', wrap(async (req, res) => {
    const b = req.body || {};
    const r = await eachItem(asList(b.paths || b.path), async p => {
      const real = await guard(p);
      await fsp.mkdir(real, { recursive: true });
      return real;
    });
    res.json(batchRes(r));
  }));

  async function chmodTree(p, mode) {
    const st = await fsp.lstat(p);
    if (st.isSymbolicLink()) return;
    await fsp.chmod(p, mode);
    if (st.isDirectory()) {
      for (const n of await fsp.readdir(p)) {
        const c = path.join(p, n);
        if (!inBlock(c)) await chmodTree(c, mode);
      }
    }
  }

  app.post('/api/chmod', wrap(async (req, res) => {
    const b = req.body || {};
    if (!/^[0-7]{3,4}$/.test(String(b.mode))) throw new HttpError(400, 'mode harus octal, contoh 755');
    const mode = parseInt(b.mode, 8);
    const r = await eachItem(asList(b.paths || b.path), async p => {
      const real = await guard(p);
      if (b.recursive) await chmodTree(real, mode);
      else await fsp.chmod(real, mode);
      return real;
    });
    res.json(batchRes(r));
  }));

  async function addTree(archive, real, name, skip) {
    if (inBlock(real) || skip(real)) return;
    const st = await fsp.lstat(real);
    if (st.isSymbolicLink()) {
      archive.symlink(name, await fsp.readlink(real), st.mode & 0o7777);
    } else if (st.isDirectory()) {
      archive.append(null, { name: name + '/', mode: st.mode & 0o7777, date: st.mtime });
      for (const n of await fsp.readdir(real)) await addTree(archive, path.join(real, n), name + '/' + n, skip);
    } else if (st.isFile()) {
      archive.file(real, { name, stats: st });
    }
  }

  app.post('/api/zip', wrap(async (req, res) => {
    const b = req.body || {};
    const srcs = [];
    for (const p of asList(b.paths)) srcs.push(await guard(p, { follow: false }));
    const names = srcs.map(s => path.basename(s));
    if (new Set(names).size !== names.length) throw new HttpError(400, 'ada nama item yang kembar');
    let outIn = b.out ? String(b.out) : path.join(path.dirname(srcs[0]), (srcs.length === 1 ? names[0] : 'arsip') + '.zip');
    if (!/\.zip$/i.test(outIn)) outIn += '.zip';
    let out = await guard(outIn, { follow: false });
    if (!(await fsp.stat(path.dirname(out))).isDirectory()) throw new HttpError(400, 'folder tujuan tidak ada');
    if (await exists(out)) {
      const ext = path.extname(out);
      const base = out.slice(0, out.length - ext.length);
      for (let i = 2; await exists(out); i++) out = base + ' (' + i + ')' + ext;
    }
    const tmp = path.join(path.dirname(out), '.vpsacc-' + rand() + '.tmp');
    const archive = archiver('zip', { zlib: { level: 6 } });
    const ws = fs.createWriteStream(tmp);
    const done = new Promise((ok, bad) => { ws.on('close', ok); ws.on('error', bad); archive.on('error', bad); });
    archive.on('warning', () => {});
    archive.pipe(ws);
    try {
      const skip = p => p === tmp || p === out;
      for (let i = 0; i < srcs.length; i++) await addTree(archive, srcs[i], names[i], skip);
      await archive.finalize();
      await done;
      await fsp.rename(tmp, out);
    } catch (e) {
      ws.destroy();
      await fsp.rm(tmp, { force: true });
      throw e;
    }
    res.json({ ok: true, path: out, size: (await fsp.stat(out)).size });
  }));

  app.post('/api/unzip', wrap(async (req, res) => {
    const b = req.body || {};
    const toDir = b.to ? await guard(b.to) : null;
    const sub = b.subfolder !== false;
    const r = await eachItem(asList(b.paths), async p => {
      const zip = await guard(p);
      if (!(await fsp.stat(zip)).isFile()) throw new HttpError(400, 'bukan file');
      const base = toDir || path.dirname(zip);
      const dest = await guard(sub ? path.join(base, path.basename(zip).replace(/\.zip$/i, '') || 'hasil') : base);
      if (sub && !b.overwrite && (await exists(dest))) throw new HttpError(409, 'folder tujuan sudah ada');
      await fsp.mkdir(dest, { recursive: true });
      try {
        await extract(zip, { dir: dest });
      } catch (e) {
        throw new HttpError(400, 'gagal ekstrak: ' + e.message);
      }
      return dest;
    });
    res.json(batchRes(r));
  }));

  app.get('/api/search', wrap(async (req, res) => {
    const base = await guard(req.query.path || SCOPE);
    const qRaw = String(req.query.q || '').trim();
    const q = qRaw.toLowerCase();
    if (!q) throw new HttpError(400, 'kata kunci kosong');
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
    const depthLimit = req.query.depth === '1' ? 1 : 0;
    const typeFilter = String(req.query.type || 'all').toLowerCase();
    const skipDirs = new Set(['/proc', '/sys', '/dev', '/run']);
    const items = [];
    let visited = 0;
    let truncated = false;
    let aborted = false;
    res.on('close', () => { if (!res.writableFinished) aborted = true; });

    const isGlob = q.includes('*') || q.includes('?');
    let nameRe = null;
    if (isGlob) {
      const esc = qRaw.replace(/[.+^${}()|\[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
      nameRe = new RegExp('^' + esc + '$', 'i');
    }

    const TYPE_RE = {
      image: /\.(png|jpe?g|gif|webp|bmp|ico|svg)$/i,
      video: /\.(mp4|webm|mov|m4v|mkv|avi)$/i,
      audio: /\.(mp3|wav|ogg|m4a|flac|aac)$/i,
      archive: /\.(zip|tar|gz|tgz|bz2|xz|7z|rar)$/i,
      doc: /\.(pdf|txt|md|markdown|csv|tsv|xml|doc|docx|xls|xlsx|ppt|pptx|rtf|odt)$/i,
      code: /\.(js|mjs|cjs|ts|tsx|jsx|py|go|java|kt|c|h|cpp|rs|rb|pl|lua|cs|php|html?|s?css|json|ya?ml|toml|sh|bash|sql)$/i
    };

    function matchName(name) {
      if (q === '*') return true;
      if (nameRe) return nameRe.test(name);
      return name.toLowerCase().includes(q);
    }
    function matchType(name, isDir) {
      if (typeFilter === 'all') return true;
      if (typeFilter === 'dir') return isDir;
      if (isDir) return false;
      const re = TYPE_RE[typeFilter];
      return re ? re.test(name) : true;
    }

    async function walk(dir, depth) {
      let ents;
      try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const e of ents) {
        if (truncated || aborted) return;
        const full = path.join(dir, e.name);
        if (inBlock(full)) continue;
        if (++visited > 300000) { truncated = true; return; }
        const isDir = e.isDirectory();
        if (matchName(e.name) && matchType(e.name, isDir)) {
          try {
            const st = await fsp.lstat(full);
            items.push({ path: full, name: e.name, dir, type: isDir ? 'dir' : 'file', size: st.size, mtime: st.mtimeMs });
          } catch (err) { /* hilang di tengah jalan */ }
          if (items.length >= limit) { truncated = true; return; }
        }
        if (isDir && !skipDirs.has(full) && (depthLimit === 0 || depth < depthLimit)) {
          await walk(full, depth + 1);
        }
      }
    }
    await walk(base, 0);
    res.json({ path: base, q: qRaw, count: items.length, truncated, items });
  }));
}

module.exports = registerFileRoutes;
