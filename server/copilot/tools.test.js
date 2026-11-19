'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createCopilotTools, normalizeVisualization } = require('./tools');

const sampleVisualization = {
  title: 'VPS Monitor',
  icon: 'monitoring',
  elements: [
    { type: 'metric', id: 'cpu', label: 'CPU', value: '42%', icon: 'speed', tone: 'success' },
    { type: 'progress', label: 'RAM', value: 68, max: 100, unit: '%' },
    { type: 'status', label: 'nginx', value: 'running', icon: 'dns', tone: 'success' },
    { type: 'chart', title: 'Resource usage', labels: ['CPU', 'RAM'], values: [42, 68] },
    { type: 'range', label: 'CPU usage', value: 42, min: 0, max: 100, step: 1, unit: '%', target: 'cpu' }
  ]
};

test('normalizes only supported visualization elements, tones, and icons', () => {
  const result = normalizeVisualization(sampleVisualization);
  assert.equal(result.title, 'VPS Monitor');
  assert.equal(result.elements[1].tone, 'accent');
  assert.equal(result.elements[0].icon, 'speed');
  assert.equal(result.elements[4].target, 'cpu');
  assert.deepEqual(normalizeVisualization({
    title: 'Layout',
    elements: [{ type: 'icon', icon: 'analytics', text: 'Live' }, { type: 'divider' }]
  }).elements, [
    { type: 'icon', icon: 'analytics', text: 'Live' },
    { type: 'divider' }
  ]);
  assert.throws(() => normalizeVisualization({
    title: 'Layout',
    elements: [{ type: 'icon' }]
  }), /wajib diisi/);
  assert.throws(() => normalizeVisualization({
    ...sampleVisualization,
    elements: [{ type: 'html', text: '<script>bad()</script>' }]
  }), /tipe elemen/);
  assert.throws(() => normalizeVisualization({
    ...sampleVisualization,
    icon: 'javascript'
  }), /icon visualisasi/);
  assert.throws(() => normalizeVisualization({
    ...sampleVisualization,
    elements: [{ type: 'range', label: 'Range', value: 10, min: 20, max: 10, step: 1 }]
  }), /visualisasi tidak valid/);
  assert.throws(() => normalizeVisualization({
    ...sampleVisualization,
    elements: Array(25).fill(sampleVisualization.elements[0])
  }), /terlalu besar/);
  assert.throws(() => normalizeVisualization({
    ...sampleVisualization,
    elements: [{ type: 'range', label: 'Range', value: 10, min: 0, max: 20, step: 1, target: 'missing' }]
  }), /target kontrol/);
});

test('render_visualization emits and persists a bounded native component spec', () => {
  const events = [];
  let saved = 0;
  const chat = { activeTurnId: 'turn-1', activities: [] };
  const { copilotTools } = createCopilotTools({
    SAFE_COMMANDS: {},
    MAX_COMMAND: 2000,
    files: {},
    runCommand() {},
    guard() {},
    store: {},
    saveStore() { saved++; },
    emit: (...args) => events.push(args)
  });
  const tool = copilotTools(chat).find(item => item.name === 'render_visualization');
  assert.ok(tool);

  const output = tool.handler(sampleVisualization, { toolCallId: 'viz-1' });
  assert.deepEqual(JSON.parse(output), { rendered: true });
  assert.equal(saved, 1);
  assert.equal(chat.activities[0].kind, 'visualization');
  assert.equal(chat.activities[0].turnId, 'turn-1');
  assert.equal(events[0][1], 'visualization');
  assert.equal(events[0][2].id, 'viz-1');
  assert.deepEqual(events[0][2].spec, normalizeVisualization(sampleVisualization));
});

test('render_visualization rolls back when persisting its activity fails', () => {
  const events = [];
  const chat = { activeTurnId: 'turn-1', activities: [], updatedAt: 123 };
  const { copilotTools } = createCopilotTools({
    SAFE_COMMANDS: {},
    MAX_COMMAND: 2000,
    files: {},
    runCommand() {},
    guard() {},
    store: {},
    saveStore() { throw new Error('disk full'); },
    emit: (...args) => events.push(args)
  });
  const tool = copilotTools(chat).find(item => item.name === 'render_visualization');
  assert.throws(() => tool.handler(sampleVisualization, { toolCallId: 'viz-fail' }), /disk full/);
  assert.deepEqual(chat.activities, []);
  assert.equal(chat.updatedAt, 123);
  assert.equal(events.length, 0);
});
