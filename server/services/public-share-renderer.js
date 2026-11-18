'use strict';

function createShareRenderer({ fsp }) {
  const shareEsc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  function shareBytes(n) {
    if (n < 1024) return n + ' B';
    const u = ['KB', 'MB', 'GB', 'TB'];
    let i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return (n >= 100 ? n.toFixed(0) : n.toFixed(1)).replace(/\.0$/, '') + ' ' + u[i];
  }
  function shareDate(ms) {
    const d = new Date(ms);
    const p = x => String(x).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  const SHARE_CSS = `
  :root{--bg:#f6f7f9;--card:#fff;--text:#1b1f24;--sub:#6b7480;--line:#e6e9ee;--accent:#2563eb;--hover:#f1f4f9}
  @media(prefers-color-scheme:dark){:root{--bg:#0f1216;--card:#171b21;--text:#e7eaee;--sub:#8b95a1;--line:#262c35;--accent:#6ea0ff;--hover:#1d232b}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .wrap{max-width:900px;margin:0 auto;padding:28px 16px 40px}
  h1{margin:0 0 6px;font-size:22px;word-break:break-word}
  .crumbs{font-size:14px;color:var(--sub);word-break:break-word}
  .crumbs a{color:var(--accent);text-decoration:none}
  .crumbs a:hover{text-decoration:underline}
  .crumbs .sep{margin:0 6px;opacity:.6}
  .crumbs .cur{color:var(--text)}
  .meta{margin:10px 0 14px;font-size:13px;color:var(--sub)}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  table{width:100%;border-collapse:collapse}
  th{padding:10px 14px;text-align:left;font-size:11px;font-weight:600;letter-spacing:.4px;text-transform:uppercase;color:var(--sub);border-bottom:1px solid var(--line)}
  th.s{text-align:right}
  td{padding:0;border-bottom:1px solid var(--line)}
  tr:last-child td{border-bottom:0}
  tbody tr:hover{background:var(--hover)}
  td.n a{display:flex;align-items:center;gap:10px;padding:11px 14px;color:var(--text);text-decoration:none;word-break:break-all}
  td.s,td.m{padding:0 14px;color:var(--sub);font-size:13px;white-space:nowrap}
  td.s{text-align:right;width:90px}
  td.m{width:150px}
  .ic{flex:none;width:20px;height:20px;background:center/contain no-repeat}
  .ic.dir{background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='%23f5b942' d='M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z'/></svg>")}
  .ic.file{background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='%2394a3b8' d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm0 1.5L18.5 8H14V3.5z'/></svg>")}
  .ic.up{background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='%2394a3b8' d='M12 4l-8 8h5v8h6v-8h5z'/></svg>")}
  .empty{padding:30px;text-align:center;color:var(--sub)}
  footer{margin-top:14px;font-size:12px;color:var(--sub);text-align:center}
  @media(max-width:560px){th.m,td.m{display:none}}
  .bar{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}
  .btn{display:inline-flex;align-items:center;justify-content:center;height:40px;padding:0 16px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--accent);font:600 14px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-decoration:none;cursor:pointer}
  .btn:hover{background:var(--hover)}
  .wrap.wide{max-width:1200px}
  .code{display:flex;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .code pre{margin:0;font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;tab-size:4}
  .gut{flex:none;padding:12px 10px 12px 14px;text-align:right;color:var(--sub);user-select:none;-webkit-user-select:none;border-right:1px solid var(--line);background:var(--hover)}
  .src{flex:1;min-width:0;overflow-x:auto;padding:12px 14px;white-space:pre}
  .note{padding:30px 16px;text-align:center;color:var(--sub)}
  `;

  function renderShareHtml(e, slug, segs, items, truncated) {
    const base = '/p/' + slug + '/';
    const enc = a => a.map(encodeURIComponent).join('/');
    const here = segs.length ? enc(segs) + '/' : '';
    const rootName = e.name || 'folder';
    const curName = segs.length ? segs[segs.length - 1] : rootName;
    const crumbs = shareCrumbs(e, slug, segs);
    let nd = 0, nf = 0, total = 0;
    const rows = [];
    if (segs.length) {
      const up = segs.length > 1 ? base + enc(segs.slice(0, -1)) + '/' : base;
      rows.push('<tr><td class="n" colspan="3"><a href="' + up + '"><i class="ic up"></i><span>..</span></a></td></tr>');
    }
    for (const it of items) {
      const href = base + here + encodeURIComponent(it.name) + (it.isDir ? '/' : '');
      if (it.isDir) nd++; else { nf++; total += it.size; }
      rows.push('<tr><td class="n"><a href="' + href + '"><i class="ic ' + (it.isDir ? 'dir' : 'file') + '"></i><span>' + shareEsc(it.name) + '</span></a></td>' +
        '<td class="s">' + (it.isDir ? '' : shareBytes(it.size)) + '</td><td class="m">' + shareDate(it.mtime) + '</td></tr>');
    }
    const meta = (e.recursive ? nd + ' folder · ' : '') + nf + ' file · ' + shareBytes(total) + (truncated ? ' · hanya 5000 item pertama yang ditampilkan' : '');
    const body = items.length
      ? '<table><thead><tr><th>Nama</th><th class="s">Ukuran</th><th class="m">Diubah</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>'
      : (segs.length ? '<table><tbody>' + rows.join('') + '</tbody></table>' : '') + '<div class="empty">Folder ini kosong</div>';
    return '<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">' +
      '<title>' + shareEsc(curName) + '</title><style>' + SHARE_CSS + '</style></head><body><div class="wrap"><h1>' + shareEsc(curName) + '</h1>' +
      '<div class="crumbs">' + crumbs + '</div><div class="meta">' + shareEsc(meta) + '</div>' +
      (items.length ? '<div class="bar"><a class="btn" href="' + base + here + '?zip=1">' + (segs.length ? 'Unduh folder ini (.zip)' : 'Unduh semua (.zip)') + '</a></div>' : '') +
      '<div class="card">' + body + '</div>' +
      '<footer>' + (e.recursive ? 'Termasuk sub folder' : 'Hanya isi folder ini') + '</footer></div></body></html>';
  }

  function shareCrumbs(e, slug, segs) {
    const base = '/p/' + slug + '/';
    const enc = a => a.map(encodeURIComponent).join('/');
    const rootName = e.name || 'folder';
    let crumbs = segs.length ? '<a href="' + base + '">' + shareEsc(rootName) + '</a>' : '<span class="cur">' + shareEsc(rootName) + '</span>';
    segs.forEach((sg, i) => {
      crumbs += '<span class="sep">/</span>';
      if (i === segs.length - 1) crumbs += '<span class="cur">' + shareEsc(sg) + '</span>';
      else crumbs += '<a href="' + base + enc(segs.slice(0, i + 1)) + '/">' + shareEsc(sg) + '</a>';
    });
    return crumbs;
  }

  const SHARE_VIEW_MAX = 1024 * 1024;

  // cek file teks (utf-8 valid, tanpa byte NUL). hasil: { text } / { big: true } / null kalau bukan teks
  async function shareTextProbe(real, size) {
    let fh;
    try {
      fh = await fsp.open(real, 'r');
      const big = size > SHARE_VIEW_MAX;
      const len = big ? 8192 : size;
      const buf = Buffer.alloc(len);
      const r = await fh.read(buf, 0, len, 0);
      const data = buf.subarray(0, r.bytesRead);
      if (data.includes(0)) return null;
      const text = new TextDecoder('utf-8', { fatal: true }).decode(data, { stream: big });
      return big ? { big: true } : { text };
    } catch (err) {
      return null;
    } finally {
      if (fh) await fh.close().catch(() => {});
    }
  }

  function renderShareText(e, slug, segs, v, size, nonce) {
    const base = '/p/' + slug + '/';
    const enc = a => a.map(encodeURIComponent).join('/');
    const fname = segs[segs.length - 1];
    const parent = segs.length > 1 ? base + enc(segs.slice(0, -1)) + '/' : base;
    const dl = base + enc(segs) + '?dl=1';
    let body, meta, copyBtn = '';
    if (v.big) {
      meta = shareBytes(size);
      body = '<div class="card"><div class="note">File terlalu besar buat ditampilkan (maks ' + shareBytes(SHARE_VIEW_MAX) + '). Unduh aja filenya.</div></div>';
    } else {
      const lines = v.text.split(/\r\n|\r|\n/);
      if (lines.length && lines[lines.length - 1] === '') lines.pop();
      meta = lines.length + ' baris · ' + shareBytes(size);
      if (!lines.length) {
        body = '<div class="card"><div class="note">File kosong</div></div>';
      } else {
        const nums = [];
        for (let i = 1; i <= lines.length; i++) nums.push(i);
        body = '<div class="code"><pre class="gut" aria-hidden="true">' + nums.join('\n') + '</pre><pre class="src"><code id="code">' + shareEsc(v.text) + '</code></pre></div>';
        copyBtn = '<button class="btn" id="cp" type="button">Salin teks</button>';
      }
    }
    const script = copyBtn ? '<script nonce="' + nonce + '">(function(){' +
      'var b=document.getElementById("cp"),c=document.getElementById("code");' +
      'function done(ok){b.textContent=ok?"Tersalin":"Gagal salin";setTimeout(function(){b.textContent="Salin teks"},1500)}' +
      'function fallback(t){try{var a=document.createElement("textarea");a.value=t;a.setAttribute("readonly","");a.style.position="fixed";a.style.opacity="0";document.body.appendChild(a);a.select();var ok=document.execCommand("copy");document.body.removeChild(a);done(ok)}catch(x){done(false)}}' +
      'b.addEventListener("click",function(){var t=c.textContent;' +
      'if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(function(){done(true)},function(){fallback(t)})}else{fallback(t)}});' +
      '})();</script>' : '';
    return '<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">' +
      '<title>' + shareEsc(fname) + '</title><style>' + SHARE_CSS + '</style></head><body><div class="wrap wide"><h1>' + shareEsc(fname) + '</h1>' +
      '<div class="crumbs">' + shareCrumbs(e, slug, segs) + '</div><div class="meta">' + shareEsc(meta) + '</div>' +
      '<div class="bar">' + copyBtn + '<a class="btn" href="' + dl + '">Unduh file</a><a class="btn" href="' + parent + '">Kembali</a></div>' +
      body + '</div>' + script + '</body></html>';
  }
  return { renderShareHtml, shareTextProbe, renderShareText };
}

module.exports = { createShareRenderer };
