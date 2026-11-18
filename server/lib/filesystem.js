'use strict';

function createFilesystem({ scope, block, fs, path, crypto, HttpError, describeErr }) {
  const fsp = fs.promises;
  const inScope = target => scope === '/' || target === scope || target.startsWith(scope + '/');
  const inBlock = target => target === block || target.startsWith(block + '/');
  const coversBlock = target => target === '/' || target === block || block.startsWith(target + '/');

  async function realExisting(abs) {
    let current = abs;
    const rest = [];
    for (;;) {
      try {
        const real = await fsp.realpath(current);
        return rest.length ? path.join(real, ...rest.reverse()) : real;
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
        try {
          await fsp.lstat(current);
          throw new HttpError(400, 'symlink rusak: ' + current);
        } catch (statError) {
          if (statError instanceof HttpError) throw statError;
        }
        const parent = path.dirname(current);
        if (parent === current) throw error;
        rest.push(path.basename(current));
        current = parent;
      }
    }
  }

  async function realOf(input, follow) {
    if (typeof input !== 'string' || !input.length || input.includes('\0')) {
      throw new HttpError(400, 'path tidak valid');
    }
    const abs = path.resolve('/', input);
    if (!follow && abs !== '/') {
      const parent = await realExisting(path.dirname(abs));
      return path.join(parent, path.basename(abs));
    }
    return realExisting(abs);
  }

  async function guard(input, options = {}) {
    const real = await realOf(input, options.follow !== false);
    if (!inScope(real)) throw new HttpError(403, 'di luar area yang diizinkan');
    if (inBlock(real) && !options.allowBlock) throw new HttpError(403, 'folder ini dilindungi');
    if (options.destructive && (inBlock(real) || coversBlock(real) || real === scope)) {
      throw new HttpError(403, 'folder ini dilindungi');
    }
    return real;
  }

  const asList = value => {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value) && value.length && value.every(item => typeof item === 'string')) return value;
    throw new HttpError(400, 'daftar path tidak valid');
  };
  const lstatOrNull = async target => {
    try { return await fsp.lstat(target); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  const exists = async target => !!(await lstatOrNull(target));
  const validName = name => typeof name === 'string' && name.length > 0 && name.length <= 255 &&
    !name.includes('/') && !name.includes('\0') && name !== '.' && name !== '..';
  const rand = () => crypto.randomBytes(6).toString('hex');
  const batchRes = result => Object.assign({}, result, { success: result.failed.length === 0 });

  async function eachItem(list, fn) {
    const ok = [];
    const failed = [];
    for (const item of list) {
      try {
        const result = await fn(item);
        ok.push(result === undefined ? item : result);
      } catch (error) {
        failed.push({
          path: typeof item === 'string' ? item : (item && item.path) || '?',
          error: describeErr(error).msg
        });
      }
    }
    return { ok, failed };
  }

  async function freeName(dir, name, tag) {
    const ext = path.extname(name);
    const base = name.slice(0, name.length - ext.length);
    for (let i = 1; ; i++) {
      const candidate = base + ' (' + tag + (i > 1 ? ' ' + i : '') + ')' + ext;
      if (!(await exists(path.join(dir, candidate)))) return candidate;
    }
  }

  async function dirOf(target) {
    const dir = await guard(target);
    if (!(await fsp.stat(dir)).isDirectory()) throw new HttpError(400, 'tujuan bukan folder');
    return dir;
  }

  async function describe(dir, name) {
    const full = path.join(dir, name);
    let stat;
    try { stat = await fsp.lstat(full); } catch (error) { return null; }
    const item = {
      name, type: stat.isDirectory() ? 'dir' : 'file', size: stat.size,
      mtime: stat.mtimeMs, mode: (stat.mode & 0o7777).toString(8)
    };
    if (stat.isSymbolicLink()) {
      item.link = true;
      try {
        item.target = await fsp.readlink(full);
        const target = await fsp.stat(full);
        item.type = target.isDirectory() ? 'dir' : 'file';
        item.size = target.size;
      } catch (error) { item.broken = true; }
    }
    return item;
  }

  return {
    inScope, inBlock, coversBlock, realExisting, realOf, guard, asList, lstatOrNull,
    exists, validName, rand, batchRes, eachItem, freeName, dirOf, describe
  };
}

module.exports = { createFilesystem };
