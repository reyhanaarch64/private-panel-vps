'use strict';

function createCopilotFileTools(deps) {
  const { scope, block, guard, fsp, path, crypto, MAX_FILE, validName, dropPublicUnder } = deps;
  async function checkedDirectory(input) {
    const real = await guard(typeof input === 'string' && input ? input : scope);
    const st = await fsp.stat(real);
    if (!st.isDirectory()) throw new Error('path bukan folder');
    return real;
  }

  async function listFiles(input) {
    const dir = await checkedDirectory(input);
    const names = await fsp.readdir(dir);
    const items = [];
    for (const name of names) {
      const full = path.join(dir, name);
      if (full === block || full.startsWith(block + '/')) continue;
      try {
        const st = await fsp.lstat(full);
        items.push({
          name,
          type: st.isDirectory() ? 'directory' : (st.isSymbolicLink() ? 'symlink' : 'file'),
          size: st.size,
          modified: st.mtime.toISOString()
        });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (items.length >= 500) break;
    }
    return JSON.stringify({ path: dir, items });
  }

  async function readTextFile(input) {
    const real = await guard(input);
    const st = await fsp.stat(real);
    if (!st.isFile()) throw new Error('bukan file');
    if (st.size > MAX_FILE) throw new Error('file terlalu besar untuk dibaca (maks 5 MB)');
    const data = await fsp.readFile(real);
    if (data.subarray(0, 8000).includes(0)) throw new Error('file bukan teks');
    return data.toString('utf8');
  }

  async function writeTextFile(input, content) {
    if (typeof content !== 'string') throw new Error('content harus berupa teks');
    if (Buffer.byteLength(content) > MAX_FILE) throw new Error('file terlalu besar (maks 5 MB)');
    const real = await guard(input);
    const current = await fsp.lstat(real).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (current && !current.isFile()) throw new Error('target bukan file');
    const mode = current ? current.mode & 0o7777 : 0o644;
    const tmp = path.join(path.dirname(real), '.vpsacc-' + crypto.randomBytes(6).toString('hex') + '.tmp');
    try {
      await fsp.writeFile(tmp, content, { mode });
      await fsp.chmod(tmp, mode);
      await fsp.rename(tmp, real);
    } catch (error) {
      await fsp.rm(tmp, { force: true });
      throw error;
    }
    return JSON.stringify({ ok: true, path: real, bytes: Buffer.byteLength(content) });
  }

  async function removePath(input) {
    const real = await guard(input, { follow: false, destructive: true });
    const st = await fsp.lstat(real);
    await fsp.rm(real, { recursive: true });
    if (!st.isSymbolicLink()) dropPublicUnder(real);
    return JSON.stringify({ ok: true, path: real });
  }

  async function renamePath(input, newName) {
    if (!validName(newName)) throw new Error('nama baru tidak valid');
    const src = await guard(input, { follow: false, destructive: true });
    const dst = path.join(path.dirname(src), newName);
    if (dst === src) return JSON.stringify({ ok: true, path: src });
    await guard(dst, { follow: false });
    try {
      await fsp.lstat(dst);
      throw new Error('nama tujuan sudah ada');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await fsp.rename(src, dst);
    return JSON.stringify({ ok: true, path: dst });
  }
  return {
    checkedDirectory, listFiles, readTextFile, writeTextFile, removePath, renamePath
  };
}

module.exports = { createCopilotFileTools };
