'use strict';

const path = require('path');
const crypto = require('crypto');
const { defineTool } = require('@github/copilot-sdk');

const VISUALIZATION_TYPES = new Set(['heading', 'text', 'icon', 'divider', 'metric', 'progress', 'status', 'chart', 'range']);
const VISUALIZATION_TONES = new Set(['neutral', 'success', 'warning', 'danger', 'accent']);
const VISUALIZATION_ICONS = new Set([
  'analytics', 'bolt', 'check_circle', 'cloud', 'database', 'developer_board', 'dns', 'error',
  'info', 'language', 'lightbulb', 'memory', 'monitoring', 'network_check', 'query_stats',
  'router', 'schedule', 'security', 'settings', 'shield', 'signal_cellular_alt', 'speed',
  'storage', 'task_alt', 'terminal', 'visibility', 'warning'
]);

function jsonSchema(properties, required) {
  return { type: 'object', properties, required, additionalProperties: false };
}

function normalizeVisualization(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      typeof input.title !== 'string' || !input.title.trim() || input.title.length > 100 ||
      (input.description !== undefined && (typeof input.description !== 'string' || input.description.length > 240)) ||
      !Array.isArray(input.elements) || !input.elements.length || input.elements.length > 24) {
    throw new Error('data visualisasi tidak valid atau terlalu besar');
  }
  const normalizeIcon = icon => {
    if (icon === undefined || icon === '') return '';
    if (typeof icon !== 'string' || !VISUALIZATION_ICONS.has(icon)) throw new Error('icon visualisasi tidak didukung');
    return icon;
  };
  const normalizeTone = tone => {
    if (tone === undefined) return 'accent';
    if (typeof tone !== 'string' || !VISUALIZATION_TONES.has(tone)) throw new Error('warna visualisasi tidak didukung');
    return tone;
  };
  const normalizeKey = key => {
    if (key === undefined || key === '') return '';
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{1,32}$/.test(key)) {
      throw new Error('id visualisasi tidak valid');
    }
    return key;
  };
  const shortText = (value, label, max = 120) => {
    if (typeof value !== 'string' || !value.trim() || value.length > max) {
      throw new Error(label + ' visualisasi tidak valid');
    }
    return value.trim();
  };
  const finite = (value, label, min = 0, max = 1000000000) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      throw new Error(label + ' visualisasi tidak valid');
    }
    return value;
  };
  const elements = input.elements.map(element => {
    if (!element || typeof element !== 'object' || Array.isArray(element) ||
        typeof element.type !== 'string' || !VISUALIZATION_TYPES.has(element.type)) {
      throw new Error('tipe elemen visualisasi tidak didukung');
    }
    if (element.type === 'heading' || element.type === 'text') {
      return { type: element.type, text: shortText(element.text, 'teks') };
    }
    if (element.type === 'divider') return { type: element.type };
    if (element.type === 'icon') {
      const icon = normalizeIcon(element.icon);
      if (!icon) throw new Error('icon visualisasi wajib diisi');
      return {
        type: element.type,
        icon,
        text: typeof element.text === 'string' ? element.text.slice(0, 120) : ''
      };
    }
    if (element.type === 'metric') {
      const value = typeof element.value === 'number'
        ? String(finite(element.value, 'nilai'))
        : shortText(element.value, 'nilai', 80);
      return {
        type: element.type,
        id: normalizeKey(element.id),
        label: shortText(element.label, 'label'),
        value,
        unit: typeof element.unit === 'string' ? element.unit.slice(0, 16) : '',
        icon: normalizeIcon(element.icon),
        tone: normalizeTone(element.tone)
      };
    }
    if (element.type === 'progress') {
      const max = finite(element.max, 'batas maksimum', Number.MIN_VALUE);
      return {
        type: element.type,
        id: normalizeKey(element.id),
        label: shortText(element.label, 'label'),
        value: finite(element.value, 'nilai', 0, max),
        max,
        unit: typeof element.unit === 'string' ? element.unit.slice(0, 16) : '',
        tone: normalizeTone(element.tone)
      };
    }
    if (element.type === 'status') {
      return {
        type: element.type,
        label: shortText(element.label, 'label'),
        value: shortText(element.value, 'status', 48),
        icon: normalizeIcon(element.icon),
        tone: normalizeTone(element.tone)
      };
    }
    if (element.type === 'chart') {
      if (!Array.isArray(element.labels) || !Array.isArray(element.values) ||
          !element.labels.length || element.labels.length > 12 || element.labels.length !== element.values.length) {
        throw new Error('data grafik visualisasi tidak valid');
      }
      return {
        type: element.type,
        title: shortText(element.title, 'judul grafik'),
        labels: element.labels.map(label => shortText(label, 'label grafik', 48)),
        values: element.values.map(value => finite(value, 'nilai grafik')),
        tone: normalizeTone(element.tone)
      };
    }
    const min = finite(element.min, 'nilai minimum', -1000000000, 1000000000);
    const max = finite(element.max, 'nilai maksimum', -1000000000, 1000000000);
    const value = finite(element.value, 'nilai', min, max);
    const step = finite(element.step, 'langkah', Number.MIN_VALUE, 1000000000);
    if (min >= max) throw new Error('rentang kontrol visualisasi tidak valid');
    return {
      type: element.type,
      target: normalizeKey(element.target),
      label: shortText(element.label, 'label'),
      value,
      min,
      max,
      step,
      unit: typeof element.unit === 'string' ? element.unit.slice(0, 16) : ''
    };
  });
  const bindableKeys = new Set();
  for (const element of elements) {
    if (!element.id) continue;
    if (bindableKeys.has(element.id)) throw new Error('id visualisasi duplikat');
    bindableKeys.add(element.id);
  }
  if (elements.some(element => element.target && !bindableKeys.has(element.target))) {
    throw new Error('target kontrol visualisasi tidak ditemukan');
  }
  return {
    title: input.title.trim(),
    description: typeof input.description === 'string' ? input.description.trim() : '',
    icon: normalizeIcon(input.icon),
    elements
  };
}

function createCopilotTools(deps) {
  const { SAFE_COMMANDS, MAX_COMMAND, files, runCommand, guard, store, saveStore, emit } = deps;
  const { checkedDirectory, listFiles, readTextFile, writeTextFile, removePath, renamePath } = files;
  function cleanDisplayArgs(toolName, args) {
    if (!args || typeof args !== 'object') return {};
    if (toolName === 'render_visualization') return {};
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
      defineTool('render_visualization', {
        ...base,
        description: 'Render one interactive native visualization inside the current chat reply. Use for dashboards, metrics, charts, progress indicators, service statuses, and range controls. Call it between normal text so explanations can appear before and after it; a range target can update a metric or progress element by id.',
        parameters: jsonSchema({
          title: { type: 'string', maxLength: 100, description: 'Short title shown at the top of the visualization.' },
          description: { type: 'string', maxLength: 240, description: 'Optional subtitle.' },
          icon: { type: 'string', enum: [...VISUALIZATION_ICONS], description: 'Optional supported icon name.' },
          elements: {
            type: 'array',
            minItems: 1,
            maxItems: 24,
            items: jsonSchema({
              type: { type: 'string', enum: [...VISUALIZATION_TYPES], description: 'heading, text, icon, divider, metric, progress, status, chart, or range.' },
              id: { type: 'string', maxLength: 32, pattern: '^[a-zA-Z0-9_-]+$', description: 'Unique key for a metric or progress element that a range can target.' },
              target: { type: 'string', maxLength: 32, pattern: '^[a-zA-Z0-9_-]+$', description: 'For range elements, the id of a metric or progress element to update.' },
              title: { type: 'string', maxLength: 120, description: 'Chart title.' },
              text: { type: 'string', maxLength: 120, description: 'Text for a heading or text element.' },
              label: { type: 'string', maxLength: 120, description: 'Label for a metric, status, progress bar, or range.' },
              value: { type: ['string', 'number'], description: 'Metric/status value or numeric progress/range value.' },
              min: { type: 'number', description: 'Minimum range value.' },
              max: { type: 'number', description: 'Maximum progress/range value.' },
              step: { type: 'number', description: 'Range slider step.' },
              unit: { type: 'string', maxLength: 16, description: 'Optional value suffix, such as % or GB.' },
              icon: { type: 'string', enum: [...VISUALIZATION_ICONS], description: 'Optional supported icon name.' },
              tone: { type: 'string', enum: [...VISUALIZATION_TONES], description: 'Optional accent: neutral, success, warning, danger, or accent.' },
              labels: { type: 'array', items: { type: 'string', maxLength: 48 }, maxItems: 12, description: 'Chart bar labels.' },
              values: { type: 'array', items: { type: 'number' }, maxItems: 12, description: 'Chart bar values, aligned with labels.' }
            }, ['type'])
          }
        }, ['title', 'elements']),
        handler: (input, invocation) => {
          assertToolAvailable();
          const spec = normalizeVisualization(input);
          const id = invocation && invocation.toolCallId || crypto.randomBytes(12).toString('hex');
          const at = Date.now();
          const activity = {
            kind: 'visualization',
            id,
            turnId: chat.activeTurnId || null,
            startedAt: at,
            spec
          };
          const previousActivities = chat.activities;
          const previousUpdatedAt = chat.updatedAt;
          chat.activities = [...(Array.isArray(previousActivities) ? previousActivities : []), activity].slice(-1000);
          chat.updatedAt = at;
          try { saveStore(); }
          catch (error) {
            chat.activities = previousActivities;
            chat.updatedAt = previousUpdatedAt;
            throw error;
          }
          emit(chat, 'visualization', { id, turnId: activity.turnId, spec });
          return JSON.stringify({ rendered: true });
        }
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

module.exports = { createCopilotTools, normalizeVisualization };
