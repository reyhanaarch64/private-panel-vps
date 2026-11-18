// Ubah config.json lalu jalankan npm run up agar perubahan diterapkan.
module.exports = {
  apps: [{
    name: 'private-panel-vps',
    script: 'index.js',
    cwd: __dirname,
    max_memory_restart: '250M',
    autorestart: true
  }]
};
