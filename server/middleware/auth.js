'use strict';

function createAuth(token, { crypto, maxFail, banMs }) {
  const sha = value => crypto.createHash('sha256').update(String(value)).digest();
  const tokenHash = sha(token);
  const fails = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [ip, failure] of fails) {
      if (failure.until < now && now - failure.last > banMs) fails.delete(ip);
    }
  }, 10 * 60 * 1000).unref();

  return function auth(req, res, next) {
    const ip = req.socket.remoteAddress || 'x';
    const now = Date.now();
    let failure = fails.get(ip);
    if (failure && failure.until > now) {
      const minutes = Math.ceil((failure.until - now) / 60000);
      res.set('Retry-After', String(Math.ceil((failure.until - now) / 1000)));
      return res.status(429).json({ error: 'terlalu banyak percobaan salah, coba lagi ' + minutes + ' menit lagi' });
    }
    const match = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!match) return res.status(401).json({ error: 'token wajib (header Authorization: Bearer ...)' });
    if (crypto.timingSafeEqual(sha(match[1]), tokenHash)) {
      fails.delete(ip);
      return next();
    }
    if (!failure || now - failure.last > banMs) failure = { n: 0, until: 0, last: now };
    failure.n++;
    failure.last = now;
    if (failure.n >= maxFail) {
      failure.until = now + banMs;
      failure.n = 0;
    }
    fails.set(ip, failure);
    console.log('[auth] token salah dari', ip, 'percobaan', failure.n);
    return res.status(401).json({ error: 'token salah' });
  };
}

module.exports = { createAuth };
