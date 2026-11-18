# Private Panel VPS

Panel pribadi berbasis Node.js/Express untuk mengelola VPS melalui file manager, terminal interaktif, process manager, dan Copilot.

## Instalasi

- Node.js 20.19+ atau 22.12+.
- Linux dengan `/proc` aktif.
- `node-pty` membutuhkan toolchain native saat instalasi (`python3`, `make`, dan compiler C/C++).
- Scope terbatas membutuhkan `bubblewrap` (`bwrap`).

Contoh Debian/Ubuntu:

```bash
apt-get update
apt-get install -y git openssl python3 make g++ bubblewrap
git clone https://github.com/reyhanaarch64/private-panel-vps.git
cd private-panel-vps
cp config.example.json config.json
openssl rand -hex 32 > token.txt
chmod 600 config.json token.txt
npm ci
npm start
```

Secara default, server hanya bind ke `127.0.0.1:9900`. Gunakan SSH tunnel atau pasang reverse proxy HTTPS di depan panel. Jika memang ingin menerima koneksi langsung dari jaringan, ubah `bind` ke `0.0.0.0` dan batasi akses menggunakan firewall.

Untuk menjalankan dengan PM2, pasang PM2 secara global (`npm install -g pm2`) lalu gunakan `npm run up`.

## Konfigurasi

Salin `config.example.json` ke `config.json` sebelum menjalankan panel. File ini diabaikan Git dan dibaca saat startup; setelah mengubahnya, restart proses panel agar pengaturan berlaku. `token.txt` adalah token login panel dan harus tetap dirahasiakan.

| Key | Default | Fungsi |
| --- | --- | --- |
| `bind` | `127.0.0.1` | Alamat interface/hostname yang didengarkan (`0.0.0.0` untuk semua interface). |
| `port` | `9900` | Port HTTP dan WebSocket. |
| `scope` | `home` | `home` membatasi file manager/terminal ke home pengguna; `full` memakai seluruh filesystem tanpa sandbox tambahan. `root` diterima sebagai alias `home`. |
| `scopePath` | `""` | Folder absolut untuk scope terbatas; kosong berarti home pengguna yang menjalankan panel. Folder harus ada dan tidak boleh berada di `/dev`, `/proc`, `/sys`, atau `/tmp`. |
| `maxReadBytes` | `5242880` | Batas ukuran file yang dapat dibuka melalui file manager. |
| `maxAuthFailures` | `5` | Percobaan token salah sebelum IP diblokir sementara. |
| `authBanMinutes` | `15` | Durasi blokir setelah terlalu banyak percobaan salah. |
| `fileTicketMinutes` | `5` | Masa berlaku tiket download/share. |
| `websocketTicketSeconds` | `120` | Masa berlaku tiket koneksi terminal sekali pakai. |
| `maxTerminals` | `8` | Jumlah terminal aktif maksimum. |

`--scope=full` masih didukung untuk override saat menjalankan `npm start`, tetapi konfigurasi yang disarankan adalah melalui `config.json`. Panel tetap harus dijalankan dengan akun OS yang memiliki akses sesuai scope yang dipilih.

## Scope

Dengan `scope: "home"`, operasi file manager dibatasi ke folder `scopePath` (atau home pengguna). Terminal interaktif menggunakan `bubblewrap`: filesystem host dipasang read-only, scope dipasang writable, `/proc` tetap tersedia agar utilitas TUI seperti `top` dapat berjalan, dan Linux capabilities dijatuhkan. Command di luar scope tetap berjalan dengan permission OS, tetapi filesystem host di luar scope dipasang read-only.

Dengan `scope: "full"`, terminal berjalan tanpa sandbox filesystem tambahan dan memperoleh akses sesuai UID/capabilities proses backend. Gunakan mode ini hanya jika memang diperlukan.

Process manager membaca proses host melalui `/proc`, termasuk proses terminal web. CPU dihitung dari delta CPU time antar-sampling; RAM menggunakan RSS per proses dan MemAvailable untuk ringkasan host. Aksi penghentian memakai `SIGTERM` atau `SIGKILL`; kernel tetap menerapkan permission proses Node yang menjalankan panel. PID 1, proses panel, dan seluruh ancestor proses panel dilindungi. Identitas proses divalidasi memakai start time untuk mengurangi risiko PID reuse.

## Terminal

Frontend menggunakan xterm.js dan FitAddon melalui CDN. Backend menggunakan `node-pty` dan WebSocket pada bind/port yang sama dengan HTTP, sesuai `config.json`. Ticket WebSocket bersifat sekali pakai, terikat ke IP koneksi, dan masa berlakunya dapat dikonfigurasi. Token Bearer utama tidak dikirim melalui URL WebSocket.

Jika CDN tidak dapat dijangkau dari browser, library xterm.js tidak akan termuat. Jika scope terbatas gagal membuat shell, pastikan `bwrap` tersedia dan namespace PID/mount diizinkan oleh kernel/provider VPS.

Backend memakai CommonJS tanpa langkah build. `index.js` menjadi composition root; konfigurasi, middleware autentikasi, utilitas filesystem, route per fitur, job service, terminal WebSocket, serta route dan tool Copilot dipisahkan ke modul `server/`. `copilot.js` menghubungkan layanan Copilot dengan aplikasi. Route menerima dependency yang diperlukan dari root sehingga batas antarfitur dan titik pengujian lebih jelas.

## Copilot

Tab Copilot dan tombol robot di editor menggunakan GitHub Copilot SDK. Login dilakukan dari tab Copilot melalui alur OAuth device-code: buka halaman GitHub yang ditampilkan dan masukkan kode verifikasi. Login disimpan pada home Copilot khusus panel di `~/.vpsacc-copilot`; login CLI terpisah di `~/.copilot` tidak otomatis digunakan. Jika VPS tidak menyediakan system keychain, panel meminta persetujuan sebelum menyimpan token tanpa enkripsi di `settings.json`; folder home panel dibatasi ke permission `0700`. Pemakaian menggunakan kuota dan hak akses akun Copilot yang ditautkan, termasuk batas akun Free bila digunakan.

Pengaturan Copilot menyediakan bahasa jawaban, tingkat detail, dan prompt tambahan yang berlaku untuk semua chat. Perubahan diterapkan pada giliran berikutnya dan tidak dapat disimpan saat masih ada chat yang berjalan. Instruksi khusus tidak mengubah batas scope filesystem atau kewajiban persetujuan command.

Konektor MCP dapat ditambahkan dari tombol **+** di composer chat. Daftar konektor hanya menampilkan nama; detail konektor terpisah untuk mengubah URL dan header, melihat tools, mengatur izin, atau menghapusnya. Saat mengedit header, nilai kosong mempertahankan rahasia tersimpan, nilai baru menggantinya, dan aksi **Hapus** menghapusnya secara eksplisit. Saat ini hanya endpoint remote HTTP/HTTPS yang URL-nya berakhir dengan `/mcp`; konfigurasi OAuth browser belum didukung. Header autentikasi opsional tersimpan di `panel-chats.json` tanpa enkripsi dengan permission file `0600`, dan nilainya tidak dikirim kembali ke UI.

Setiap tool MCP memerlukan persetujuan secara default. **Izinkan sekali** berlaku hanya untuk satu pemanggilan; **Izinkan & jangan tanya lagi** menyimpan izin untuk tool yang sama, tetapi panggilan berikutnya dilewati hanya jika runtime secara eksplisit menandainya `readOnly === true`. Aksi bulk **Izinkan semua panggilan read-only** mengikuti batas yang sama. Pemanggilan mutating atau yang sifatnya tidak diketahui tetap meminta persetujuan. Perubahan konfigurasi MCP memutus sesi chat yang idle dan diterapkan saat sesi dibuat kembali.

File yang dikelola tool Copilot langsung berubah di disk dalam scope panel. Sebaliknya, hasil dari Copilot di editor dikirim bertahap ke buffer editor dan belum tersimpan sampai tombol **Simpan** ditekan. Command inspeksi tertentu tersedia tanpa konfirmasi; command shell lainnya menampilkan command dan output, lalu harus disetujui di UI sebelum dijalankan. Command berjalan dengan permission proses panel: scope terbatas menggunakan `bubblewrap`, sedangkan `scope: "full"` tidak memakai sandbox filesystem tambahan.

Di editor, mode **Patch per blok** menjadi pilihan default: perubahan diterapkan segera setelah tiap patch valid diterima, hanya pada teks yang cocok unik, lalu editor menyorot dan menggulir ke lokasi perubahan. Patch yang teks acuannya tidak ditemukan atau tidak unik dilewati dan dilaporkan. Pilih **Tulis ulang kode penuh** jika memang ingin Copilot menghasilkan isi seluruh file. Kedua mode hanya mengubah buffer; simpan file secara manual setelah memeriksa hasilnya.
