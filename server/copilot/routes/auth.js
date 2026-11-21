'use strict';

function registerCopilotAuthRoutes(app, deps) {
  const { wrap, HttpError, scope, getClient, getLoginJob, startLogin, enablePlaintextTokenStorage,
    store, SETTINGS_LANGUAGES, SETTINGS_VERBOSITIES, MAX_CUSTOM_INSTRUCTIONS, DEFAULT_SETTINGS,
    sessions, saveStore, refreshClientAfterLogin, beginSessionConfigChange } = deps;
  app.get('/api/copilot/status', wrap(async (req, res) => {
    const copilot = await getClient();
    const status = await copilot.getAuthStatus();
    res.json({
      ready: true,
      authenticated: !!status.isAuthenticated,
      login: status.login || null,
      authType: status.authType || null,
      loginFlow: getLoginJob() && getLoginJob().running ? { id: getLoginJob().id } : null,
      scope
    });
  }));

  app.get('/api/copilot/settings', wrap(async (req, res) => {
    res.json({ settings: store.settings });
  }));

  app.put('/api/copilot/settings', wrap(async (req, res) => {
    const body = req.body || {};
    if (!SETTINGS_LANGUAGES.has(body.language) || !SETTINGS_VERBOSITIES.has(body.verbosity) ||
        typeof body.instructions !== 'string') {
      throw new HttpError(400, 'pengaturan bahasa, detail jawaban, atau instruksi tidak valid');
    }
    if (body.instructions.length > MAX_CUSTOM_INSTRUCTIONS) {
      throw new HttpError(413, 'instruksi tambahan terlalu panjang (maks 12000 karakter)');
    }
    const next = {
      language: body.language,
      verbosity: body.verbosity,
      instructions: body.instructions.trim()
    };
    const unchanged = Object.keys(DEFAULT_SETTINGS).every(key => store.settings[key] === next[key]);
    if (unchanged) {
      res.json({ settings: store.settings, applied: true });
      return;
    }
    const release = beginSessionConfigChange();
    try {
      for (const [chatId, session] of [...sessions.entries()]) {
        await session.disconnect();
        sessions.delete(chatId);
      }
      const previous = store.settings;
      store.settings = next;
      try { saveStore(); }
      catch (error) {
        store.settings = previous;
        throw error;
      }
      res.json({ settings: store.settings, applied: true });
    } finally {
      release();
    }
  }));

  app.post('/api/copilot/login', wrap(async (req, res) => {
    if (!req.body || req.body.allowPlaintext !== true) {
      throw new HttpError(400, 'persetujuan penyimpanan token plaintext diperlukan');
    }
    enablePlaintextTokenStorage();
    const job = startLogin();
    res.status(202).json({ id: job.id, running: job.running });
  }));

  app.get('/api/copilot/login/:id', wrap(async (req, res) => {
    const job = getLoginJob();
    if (!job || job.id !== req.params.id) throw new HttpError(404, 'proses login tidak ditemukan atau sudah diganti');
    const after = Math.max(0, Number.parseInt(req.query.after, 10) || 0);
    let authenticated = false;
    let error = job.error;
    if (job.done && !job.error) {
      try {
        let copilot = await getClient();
        let status = await copilot.getAuthStatus();
        if (!status.isAuthenticated) {
          copilot = await refreshClientAfterLogin(job);
          status = await copilot.getAuthStatus();
        }
        authenticated = !!status.isAuthenticated;
      } catch (statusError) {
        error = 'login selesai, tapi status autentikasi Copilot gagal diperiksa: ' +
          (statusError.message || 'error tidak diketahui');
      }
    }
    res.json({
      output: job.output.slice(after),
      next: job.output.length,
      running: job.running,
      done: job.done,
      authenticated,
      error
    });
  }));
}

module.exports = registerCopilotAuthRoutes;
