'use strict';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const CODE_MSG = {
  ENOENT: [404, 'tidak ditemukan'],
  EACCES: [403, 'izin ditolak'],
  EPERM: [403, 'izin ditolak'],
  EEXIST: [409, 'sudah ada'],
  ENOTDIR: [400, 'bukan folder'],
  EISDIR: [400, 'ini folder'],
  ENOTEMPTY: [409, 'folder tidak kosong'],
  ENOSPC: [507, 'disk penuh'],
  EROFS: [403, 'filesystem read-only']
};

function describeErr(error) {
  if (error instanceof HttpError) return { status: error.status, msg: error.message };
  if (error.type === 'entity.parse.failed') return { status: 400, msg: 'json tidak valid' };
  if (error.type === 'entity.too.large') return { status: 413, msg: 'body terlalu besar' };
  const code = CODE_MSG[error.code];
  if (code) return { status: code[0], msg: code[1] };
  return { status: 500, msg: error.message || 'error' };
}

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { HttpError, describeErr, wrap };
