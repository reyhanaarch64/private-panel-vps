'use strict';

const fsp = require('fs').promises;

function registerLegacyEditorRoutes(app, deps) {
  const { wrap, HttpError, guard, MAX_FILE, EDITOR_JOB_TTL, editorJobs, crypto, path,
    requireAuthenticatedClient, editorSystemMessage, emitEditor } = deps;
  function pruneEditorJobs() {
    const cutoff = Date.now() - EDITOR_JOB_TTL;
    for (const [id, job] of editorJobs) {
      if (job.createdAt < cutoff && job.done) editorJobs.delete(id);
    }
  }

  app.post('/api/copilot/editor', wrap(async (req, res) => {
    const body = req.body || {};
    if (typeof body.path !== 'string' || typeof body.content !== 'string' || typeof body.prompt !== 'string' || !body.prompt.trim()) {
      throw new HttpError(400, 'path, content, dan prompt wajib diisi');
    }
    if (Buffer.byteLength(body.content) > MAX_FILE || body.prompt.length > 4000) {
      throw new HttpError(413, 'file atau prompt terlalu besar');
    }
    const real = await guard(body.path);
    if (!(await fsp.stat(real)).isFile()) throw new HttpError(400, 'bukan file');
    const copilot = await requireAuthenticatedClient();
    pruneEditorJobs();
    if ([...editorJobs.values()].filter(job => !job.done).length >= 3) {
      throw new HttpError(429, 'maksimal 3 proses editor Copilot aktif');
    }
    const id = crypto.randomBytes(12).toString('hex');
    const sessionId = 'vpsacc-editor-' + crypto.randomBytes(16).toString('hex');
    const job = { id, path: real, createdAt: Date.now(), text: '', done: false, events: [], eventSeq: 0 };
    const session = await copilot.createSession({
      sessionId,
      model: 'auto',
      workingDirectory: path.dirname(real),
      systemMessage: { mode: 'append', content: editorSystemMessage },
      tools: [],
      availableTools: []
    });
    editorJobs.set(id, job);
    session.on('assistant.message_delta', event => {
      const text = event.data && event.data.deltaContent;
      if (!text) return;
      job.text += text;
      emitEditor(job, 'delta', { text });
    });
    session.on('assistant.message', event => {
      const content = event.data && event.data.content;
      if (typeof content === 'string' && content && content !== job.text) {
        job.text = content;
        emitEditor(job, 'replace', { text: content });
      }
    });
    session.on('session.idle', () => {
      job.done = true;
      emitEditor(job, 'done', { hasText: !!job.text });
      copilot.deleteSession(sessionId).catch(error => console.error('[copilot] gagal menghapus sesi editor sementara', error));
    });
    session.on('session.error', event => {
      const data = event.data || {};
      job.done = true;
      emitEditor(job, 'error', { message: String(data.message || 'Copilot mengalami error').slice(0, 1000) });
      copilot.deleteSession(sessionId).catch(error => console.error('[copilot] gagal menghapus sesi editor sementara', error));
    });
    const prompt = [
      'Path file: ' + real,
      'Instruksi pengguna:',
      body.prompt.trim(),
      '',
      'Isi file saat ini:',
      '<file>',
      body.content,
      '</file>',
      '',
      'Tulis ulang file lengkap sesuai instruksi. Balas hanya dengan isi file akhir.'
    ].join('\n');
    try {
      await session.send({ prompt });
    } catch (error) {
      job.done = true;
      emitEditor(job, 'error', { message: error.message || 'gagal mengirim instruksi ke Copilot' });
      copilot.deleteSession(sessionId).catch(stopError => console.error('[copilot] gagal menghapus sesi editor sementara', stopError));
      throw error;
    }
    res.status(202).json({ id, path: real });
  }));

  app.get('/api/copilot/editor/:id/events', wrap(async (req, res) => {
    const job = editorJobs.get(req.params.id);
    if (!job) throw new HttpError(404, 'proses editor tidak ditemukan atau kedaluwarsa');
    const after = Math.max(0, Number.parseInt(req.query.after, 10) || 0);
    res.json({ events: job.events.filter(event => event.seq > after), next: job.eventSeq, done: job.done });
  }));
}

module.exports = registerLegacyEditorRoutes;
