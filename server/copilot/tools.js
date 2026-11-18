'use strict';

const path = require('path');
const { defineTool } = require('@github/copilot-sdk');

function jsonSchema(properties, required) {
  return { type: 'object', properties, required, additionalProperties: false };
}

function createCopilotTools(deps) {
  const { SAFE_COMMANDS, MAX_COMMAND, files, runCommand, guard, store, saveStore, emit } = deps;
  const { checkedDirectory, listFiles, readTextFile, writeTextFile, removePath, renamePath } = files;
  function cleanDisplayArgs(toolName, args) {
    if (!args || typeof args !== 'object') return {};
    if (toolName === 'write_file') return { path: args.path, bytes: Buffer.byteLength(String(args.content || '')) };
    if (toolName === 'run_command') return { command: args.command, cwd: args.cwd };
    return Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'content'));
  }
  function copilotTools(chat) {
    const base = {
      skipPermission: true,
      defer: 'never'
    };
    const assertToolAvailable = () => {
      if (chat.editorTurn) throw new Error('Gunakan respons editor; tools tidak tersedia untuk permintaan edit ini.');
    };
    return [
      defineTool('list_files', {
        ...base,
        description: 'List files in a directory inside the configured scope.',
        parameters: jsonSchema({ path: { type: 'string', description: 'Absolute directory path; defaults to the current scope.' } }, []),
        handler: ({ path: input }) => { assertToolAvailable(); return listFiles(input); }
      }),
      defineTool('read_file', {
        ...base,
        description: 'Read a UTF-8 text file inside the configured scope.',
        parameters: jsonSchema({ path: { type: 'string' } }, ['path']),
        handler: ({ path: input }) => { assertToolAvailable(); return readTextFile(input); }
      }),
      defineTool('write_file', {
        ...base,
        description: 'Create or replace a text file inside the configured scope. Changes are applied immediately.',
        parameters: jsonSchema({ path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']),
        handler: ({ path: input, content }) => { assertToolAvailable(); return writeTextFile(input, content); }
      }),
      defineTool('delete_path', {
        ...base,
        description: 'Delete a file or directory inside the configured scope. Do not use for the scope root or protected panel directory.',
        parameters: jsonSchema({ path: { type: 'string' } }, ['path']),
        handler: ({ path: input }) => { assertToolAvailable(); return removePath(input); }
      }),
      defineTool('rename_path', {
        ...base,
        description: 'Rename a file or directory in its current directory.',
        parameters: jsonSchema({ path: { type: 'string' }, newName: { type: 'string' } }, ['path', 'newName']),
        handler: ({ path: input, newName }) => { assertToolAvailable(); return renamePath(input, newName); }
      }),
      defineTool('open_file', {
        ...base,
        description: 'Open a text file in the panel editor for the user. Use when the user asks to open or inspect a file in the editor.',
        parameters: jsonSchema({ path: { type: 'string' } }, ['path']),
        handler: async ({ path: input }, invocation) => {
          assertToolAvailable();
          const real = await guard(input);
          await readTextFile(real);
          const directory = path.dirname(real);
          const hadDirectories = Array.isArray(chat.directories);
          const directories = hadDirectories ? chat.directories : (chat.directory ? [chat.directory] : []);
          if (!directories.includes(directory)) {
            chat.directories = directories;
            chat.directories.push(directory);
            try { saveStore(); }
            catch (error) {
              chat.directories.pop();
              if (!hadDirectories) delete chat.directories;
              throw error;
            }
          }
          emit(chat, 'open_file', {
            id: invocation && invocation.toolCallId,
            path: real
          });
          return JSON.stringify({ opened: true, path: real });
        }
      }),
      defineTool('run_safe_command', {
        ...base,
        description: 'Run one predefined read-only VPS inspection command without asking. These commands are also shown in the activity panel.',
        parameters: jsonSchema({
          action: { type: 'string', enum: Object.keys(SAFE_COMMANDS) },
          cwd: { type: 'string', description: 'Working directory inside the configured scope.' }
        }, ['action']),
        handler: async ({ action, cwd }, invocation) => {
          assertToolAvailable();
          const spec = SAFE_COMMANDS[action];
          if (!spec) throw new Error('command inspeksi tidak didukung');
          const dir = await checkedDirectory(cwd);
          return runCommand(chat, {
            command: [spec.program, ...spec.args].join(' '),
            program: spec.program,
            args: spec.args,
            cwd: dir,
            needsApproval: false
          }, invocation && invocation.toolCallId);
        }
      }),
      defineTool('run_command', {
        ...base,
        description: 'Run a shell command inside the configured scope. Always ask the user for approval first; show the exact command and stream its output.',
        parameters: jsonSchema({
          command: { type: 'string', description: 'Shell command to run.' },
          cwd: { type: 'string', description: 'Working directory inside the configured scope.' }
        }, ['command']),
        handler: async ({ command, cwd }, invocation) => {
          assertToolAvailable();
          if (typeof command !== 'string' || !command.trim() || command.length > MAX_COMMAND || command.includes('\0')) {
            throw new Error('command kosong atau terlalu panjang (maks 2000 karakter)');
          }
          const dir = await checkedDirectory(cwd);
          return runCommand(chat, {
            command: command.trim(),
            program: '/bin/bash',
            args: ['-lc', command.trim()],
            cwd: dir,
            needsApproval: true
          }, invocation && invocation.toolCallId);
        }
      })
    ];
  }
  return { cleanDisplayArgs, copilotTools };
}

module.exports = { createCopilotTools };
