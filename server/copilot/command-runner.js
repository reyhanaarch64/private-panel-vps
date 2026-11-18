'use strict';

function createCommandRunner(deps) {
  const { scope, approvals, emit, saveStore, spawn, crypto, MAX_COMMAND_OUTPUT,
    MAX_STORED_OUTPUT, COMMAND_ACTIVITY_SAVE_INTERVAL_MS, APPROVAL_MS } = deps;
  function awaitApproval(chat, id, command, cwd) {
    emit(chat, 'approval_required', { id, command, cwd, expiresAt: Date.now() + APPROVAL_MS });
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        approvals.delete(id);
        emit(chat, 'approval_result', { id, approved: false, reason: 'permintaan konfirmasi kedaluwarsa' });
        resolve(false);
      }, APPROVAL_MS);
      approvals.set(id, {
        chatId: chat.id,
        resolve(approved) {
          clearTimeout(timer);
          approvals.delete(id);
          resolve(approved);
        }
      });
    });
  }

  function commandArgs(program, args, cwd) {
    if (scope === '/') return { command: program, args, cwd };
    return {
      command: 'bwrap',
      args: [
        '--die-with-parent',
        '--ro-bind', '/', '/',
        '--bind', scope, scope,
        '--dev', '/dev',
        '--proc', '/proc',
        '--ro-bind', '/sys', '/sys',
        '--tmpfs', '/tmp',
        '--cap-drop', 'ALL',
        '--chdir', cwd,
        '--', program, ...args
      ],
      cwd: scope
    };
  }

  async function runCommand(chat, options, toolCallId) {
    const id = toolCallId || crypto.randomBytes(8).toString('hex');
    if (options.needsApproval && !(await awaitApproval(chat, id, options.command, options.cwd))) {
      throw new Error('command ditolak atau tidak dikonfirmasi oleh pengguna');
    }
    const launch = commandArgs(options.program, options.args, options.cwd);
    const startedAt = Date.now();
    let output = '';
    const activity = {
      id,
      kind: 'command',
      command: options.command,
      cwd: options.cwd,
      startedAt,
      endedAt: null,
      running: true,
      code: null,
      signal: null,
      output: ''
    };
    const previousUpdatedAt = chat.updatedAt;
    chat.activities.push(activity);
    chat.updatedAt = startedAt;
    try { saveStore(); }
    catch (error) {
      chat.activities.pop();
      chat.updatedAt = previousUpdatedAt;
      throw error;
    }
    emit(chat, 'command_start', { id, command: options.command, cwd: options.cwd, approved: !!options.needsApproval });
    let storageErrorReported = false;
    const persistProgress = () => {
      activity.output = output.slice(-MAX_STORED_OUTPUT);
      chat.updatedAt = Date.now();
      try {
        saveStore();
        storageErrorReported = false;
      }
      catch (error) {
        if (!storageErrorReported) {
          console.error('[copilot] gagal menyimpan progres command', error);
          storageErrorReported = true;
          emit(chat, 'storage_error', { message: 'Progres command belum tersimpan sepenuhnya.' });
        }
      }
    };
    const persistTimer = setInterval(persistProgress, COMMAND_ACTIVITY_SAVE_INTERVAL_MS);
    persistTimer.unref();
    let result;
    try {
      result = await new Promise((resolve, reject) => {
        const child = spawn(launch.command, launch.args, {
          cwd: launch.cwd,
          env: Object.assign({}, process.env, { TERM: 'xterm-256color', COLUMNS: '120', LINES: '40' }),
          stdio: ['ignore', 'pipe', 'pipe']
        });
        let completed = false;
        const finish = value => {
          if (completed) return;
          completed = true;
          clearTimeout(timeout);
          resolve(value);
        };
        const append = chunk => {
          const text = chunk.toString('utf8');
          output += text;
          if (output.length > MAX_COMMAND_OUTPUT) output = output.slice(-MAX_COMMAND_OUTPUT);
          activity.output = output.slice(-MAX_STORED_OUTPUT);
          emit(chat, 'command_output', { id, text });
        };
        const timeout = setTimeout(() => {
          child.kill('SIGTERM');
          setTimeout(() => child.kill('SIGKILL'), 3000).unref();
        }, 120000);
        child.stdout.on('data', append);
        child.stderr.on('data', append);
        child.on('error', error => {
          if (completed) return;
          completed = true;
          clearTimeout(timeout);
          reject(error);
        });
        child.on('close', (code, signal) => finish({ code, signal }));
      });
    } catch (error) {
      clearInterval(persistTimer);
      activity.running = false;
      activity.endedAt = Date.now();
      activity.error = error.message || 'command gagal dijalankan';
      activity.output = output.slice(-MAX_STORED_OUTPUT);
      chat.updatedAt = Date.now();
      emit(chat, 'command_end', {
        id,
        code: null,
        signal: null,
        error: activity.error,
        output: activity.output
      });
      try { saveStore(); }
      catch (saveError) {
        console.error('[copilot] gagal menyimpan hasil command', saveError);
        emit(chat, 'storage_error', { message: 'Hasil command gagal disimpan.' });
      }
      throw error;
    }
    clearInterval(persistTimer);
    activity.running = false;
    activity.endedAt = Date.now();
    activity.code = result.code;
    activity.signal = result.signal || null;
    activity.output = output.slice(-MAX_STORED_OUTPUT);
    chat.updatedAt = Date.now();
    emit(chat, 'command_end', {
      id,
      code: result.code,
      signal: result.signal || null,
      output: activity.output
    });
    try { saveStore(); }
    catch (error) {
      console.error('[copilot] gagal menyimpan hasil command', error);
      emit(chat, 'storage_error', { message: 'Hasil command gagal disimpan.' });
      throw error;
    }
    return JSON.stringify({ code: result.code, signal: result.signal || null, output: activity.output });
  }
  return { awaitApproval, commandArgs, runCommand };
}

module.exports = { createCommandRunner };
