'use strict';

function normIp(ip) {
  ip = String(ip || '');
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  if (ip === '::1') return '127.0.0.1';
  return ip;
}

module.exports = { normIp };
