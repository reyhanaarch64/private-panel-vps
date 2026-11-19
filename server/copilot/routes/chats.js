'use strict';

function registerCopilotChatRoutes(app, deps) {
  const { wrap, HttpError, guard, MAX_PROMPT, MAX_FILE, path, fsp, store, createChatRecord,
    getChat, approvals, getClient, sessions, saveStore, emit, getSession, crypto,
    assertSessionConfigReady } = deps;
  app.get('/api/copilot/chats', wrap(async (req, res) => {
    res.json({
      chats: store.chats
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(chat => ({
          id: chat.id,
          title: chat.title,
          directory: chat.directory || null,
          createdAt: chat.createdAt,
          updatedAt: chat.updatedAt,
          running: !!chat.running
        }))
    });
  }));

  app.post('/api/copilot/chats', wrap(async (req, res) => {
    assertSessionConfigReady();
    const chat = await createChatRecord();
    res.status(201).json({ id: chat.id, title: chat.title, messages: [], activities: [], running: false, eventSeq: 0 });
  }));

  app.post('/api/copilot/chats/for-directory', wrap(async (req, res) => {
    assertSessionConfigReady();
    if (!req.body || typeof req.body.path !== 'string') throw new HttpError(400, 'path wajib diisi');
    const real = await guard(req.body.path);
    if (!(await fsp.stat(real)).isFile()) throw new HttpError(400, 'bukan file');
    const directory = path.dirname(real);
    const existing = store.chats.find(chat =>
      chat.directory === directory || (Array.isArray(chat.directories) && chat.directories.includes(directory))
    );
    if (existing) {
      res.json({ id: existing.id, title: existing.title, directory, created: false });
      return;
    }
    const chat = await createChatRecord({
      title: 'Folder · ' + (path.basename(directory) || directory),
      directory
    });
    res.status(201).json({ id: chat.id, title: chat.title, directory, created: true });
  }));

  app.get('/api/copilot/chats/:id', wrap(async (req, res) => {
    const chat = getChat(req.params.id);
    const turnStart = chat.running
      ? [...chat.events].reverse().find(event => event.type === 'turn_start')
      : null;
    res.json({
      id: chat.id,
      title: chat.title,
      directory: chat.directory || null,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      messages: chat.messages,
      activities: chat.activities,
      running: !!chat.running,
      liveAssistant: chat.liveAssistant,
      eventSeq: chat.eventSeq,
      turnStartSeq: turnStart ? turnStart.seq : chat.eventSeq
    });
  }));

  app.delete('/api/copilot/chats/:id', wrap(async (req, res) => {
    assertSessionConfigReady();
    const chat = getChat(req.params.id);
    if (chat.running) throw new HttpError(409, 'chat yang sedang berjalan tidak bisa dihapus');
    for (const [id, pending] of approvals) {
      if (pending.chatId === chat.id) pending.resolve(false);
    }
    const copilot = await getClient();
    await copilot.deleteSession(chat.sessionId);
    const session = sessions.get(chat.id);
    if (session) {
      try { await session.disconnect(); }
      catch (error) { console.error('[copilot] gagal memutus sesi chat', error); }
      sessions.delete(chat.id);
    }
    store.chats = store.chats.filter(item => item.id !== chat.id);
    saveStore();
    res.json({ ok: true });
  }));

  app.post('/api/copilot/chats/:id/messages', wrap(async (req, res) => {
    assertSessionConfigReady();
    const chat = getChat(req.params.id);
    if (chat.running) throw new HttpError(409, 'Copilot masih memproses pesan sebelumnya');
    const prompt = req.body && req.body.message;
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > MAX_PROMPT) {
      throw new HttpError(400, 'pesan kosong atau terlalu panjang (maks 12000 karakter)');
    }
    const session = await getSession(chat);
    assertSessionConfigReady();
    const message = prompt.trim();
    const previousTitle = chat.title;
    const previousUpdatedAt = chat.updatedAt;
    chat.messages.push({ role: 'user', content: message, at: Date.now() });
    if (chat.title === 'Chat baru') chat.title = message.replace(/\s+/g, ' ').slice(0, 64);
    chat.updatedAt = Date.now();
    chat.running = true;
    chat.liveAssistant = '';
    chat.activeTurnId = crypto.randomBytes(16).toString('hex');
    try { saveStore(); }
    catch (error) {
      chat.messages.pop();
      chat.title = previousTitle;
      chat.updatedAt = previousUpdatedAt;
      chat.running = false;
      chat.liveAssistant = '';
      chat.activeTurnId = null;
      throw error;
    }
    emit(chat, 'turn_start', {});
    try {
      await session.send({ prompt: message });
    } catch (error) {
      chat.running = false;
      chat.liveAssistant = '';
      chat.activeTurnId = null;
      emit(chat, 'error', { message: error.message || 'gagal mengirim pesan ke Copilot' });
      emit(chat, 'turn_end', {});
      saveStore();
      throw error;
    }
    res.status(202).json({ ok: true, running: true });
  }));

  app.post('/api/copilot/chats/:id/editor', wrap(async (req, res) => {
    assertSessionConfigReady();
    const chat = getChat(req.params.id);
    if (chat.running) throw new HttpError(409, 'Copilot masih memproses pesan sebelumnya');
    const body = req.body || {};
    if (typeof body.path !== 'string' || typeof body.content !== 'string' ||
        typeof body.prompt !== 'string' || !body.prompt.trim()) {
      throw new HttpError(400, 'path, content, dan prompt wajib diisi');
    }
    if (body.mode !== undefined && body.mode !== 'patch' && body.mode !== 'full') {
      throw new HttpError(400, 'mode editor tidak valid');
    }
    if (Buffer.byteLength(body.content) > MAX_FILE || body.prompt.length > 4000) {
      throw new HttpError(413, 'file atau prompt terlalu besar');
    }
    const real = await guard(body.path);
    if (!(await fsp.stat(real)).isFile()) throw new HttpError(400, 'bukan file');
    const session = await getSession(chat);
    assertSessionConfigReady();
    const instruction = body.prompt.trim();
    const mode = body.mode || 'patch';
    const message = 'Edit file ' + real + ': ' + instruction;
    const sessionPrompt = [
      'Permintaan berasal dari editor file. Jangan jalankan tools dan jangan mengubah file langsung.',
      'Path file: ' + real,
      'Instruksi pengguna:',
      instruction,
      '',
      'Isi file saat ini:',
      '<file>',
      body.content,
      '</file>',
      '',
      ...(mode === 'patch' ? [
        'Edit mode: incremental patch.',
        'Jangan mengembalikan seluruh file. Keluarkan satu JSON object per baris untuk setiap perubahan, tanpa Markdown fence atau teks lain.',
        'Format setiap baris: {"id":1,"find":"teks persis yang ada saat ini","replace":"teks pengganti"}',
        'Gunakan id integer unik berurutan mulai dari 1. find harus non-kosong, cukup spesifik dan harus cocok persis tepat satu kali di isi file yang berlaku saat patch diterapkan.',
        'Untuk menyisipkan teks, gunakan find berisi konteks yang tetap dipertahankan dan sertakan konteks itu dalam replace.',
        'Buat patch sekecil mungkin dan urutkan agar setiap find cocok setelah patch sebelumnya. Jangan sertakan penjelasan.'
      ] : [
        'Edit mode: full file.',
        'Balas hanya dengan isi lengkap file setelah perubahan, tanpa Markdown fence atau penjelasan.'
      ])
    ].join('\n');
    const previousUpdatedAt = chat.updatedAt;
    chat.messages.push({ role: 'user', content: message, at: Date.now() });
    chat.updatedAt = Date.now();
    chat.running = true;
    chat.editorTurn = true;
    chat.editorMode = mode;
    chat.liveAssistant = '';
    try { saveStore(); }
    catch (error) {
      chat.messages.pop();
      chat.updatedAt = previousUpdatedAt;
      chat.running = false;
      chat.editorTurn = false;
      chat.editorMode = null;
      chat.liveAssistant = '';
      throw error;
    }
    const after = chat.eventSeq;
    emit(chat, 'turn_start', {});
    try {
      await session.send({ prompt: sessionPrompt });
    } catch (error) {
      chat.running = false;
      chat.editorTurn = false;
      chat.editorMode = null;
      emit(chat, 'error', { message: error.message || 'gagal mengirim permintaan editor ke Copilot' });
      emit(chat, 'turn_end', {});
      saveStore();
      throw error;
    }
    res.status(202).json({ ok: true, running: true, after });
  }));

  app.get('/api/copilot/chats/:id/events', wrap(async (req, res) => {
    const chat = getChat(req.params.id);
    const after = Math.max(0, Number.parseInt(req.query.after, 10) || 0);
    res.json({
      events: chat.events.filter(event => event.seq > after),
      next: chat.eventSeq,
      running: !!chat.running
    });
  }));

  app.post('/api/copilot/chats/:id/approvals/:approvalId', wrap(async (req, res) => {
    const chat = getChat(req.params.id);
    const pending = approvals.get(req.params.approvalId);
    if (!pending || pending.chatId !== chat.id) throw new HttpError(404, 'konfirmasi tidak ditemukan atau sudah kedaluwarsa');
    const body = req.body || {};
    if (typeof body.approve !== 'boolean') throw new HttpError(400, 'approve harus boolean');
    if (body.rememberReadOnly !== undefined && typeof body.rememberReadOnly !== 'boolean') {
      throw new HttpError(400, 'rememberReadOnly harus boolean');
    }
    if (body.rememberReadOnly && (!body.approve || pending.kind !== 'mcp')) {
      throw new HttpError(400, 'izin tersimpan hanya tersedia untuk pemanggilan MCP yang disetujui');
    }
    pending.resolve(body.approve, body.rememberReadOnly === true);
    emit(chat, 'approval_result', { id: req.params.approvalId, approved: body.approve });
    res.json({ ok: true });
  }));
}

module.exports = registerCopilotChatRoutes;
