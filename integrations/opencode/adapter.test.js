import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupBridge, decodeList } from './adapter.js';

test('decodes structured MCP results and refuses application/tool errors', () => {
  const data = { items: [{ id: 'one' }], next_cursor: null };
  assert.deepEqual(decodeList({ structuredContent: { ok: true, data } }), data);
  assert.deepEqual(decodeList({ content: [{ type: 'text', text: JSON.stringify({ ok: true, data }) }] }), data);
  assert.throws(() => decodeList({ isError: true }), /Remindi/);
  assert.throws(() => decodeList({ structuredContent: { ok: false } }), /Remindi/);
  assert.throws(() => decodeList({ structuredContent: { ok: true, data: {} } }), /Remindi/);
});

test('requires an explicit project and URL; never silently chooses a session', async () => {
  await assert.rejects(setupBridge({ options: {}, location: { directory: '/project' } }), /projectID/);
});

test('retains the validated token for reconnects if the process environment changes', async () => {
  const key = 'REMINDI_BRIDGE_TEST_TOKEN'; const old = process.env[key];
  process.env[key] = 'test-token';
  let received;
  const stop = await setupBridge({
    options: { projectID: 'home', url: 'http://localhost/mcp', tokenEnv: key },
    location: { directory: '/project' }, session: {}, storage: {},
  }, {
    connect: async (options) => { received = options.token; return { list: async () => ({ items: [], next_cursor: null }), close: async () => {} }; },
    schedule: () => 0, cancel: () => {},
  });
  try { delete process.env[key]; await new Promise(setImmediate); assert.equal(received, 'test-token'); }
  finally { await stop(); if (old === undefined) delete process.env[key]; else process.env[key] = old; }
});

test('runs one model-free poll, schedules ten seconds, and cleans up its timer and MCP connection', async () => {
  let polls = 0; let closed = 0; let cancelled; let scheduled;
  const token = { unref() {} };
  const ctx = {
    options: { projectID: 'home', url: 'http://localhost:8080/mcp' },
    location: { directory: '/project' },
    session: { get: () => assert.fail('no reminders, no session lookup'), synthetic: () => assert.fail('no model or message call') },
    storage: {},
  };
  const stop = await setupBridge(ctx, {
    connect: async () => ({ list: async (args) => { polls++; assert.equal(args.project_id, 'home'); return { items: [], next_cursor: null }; }, close: async () => { closed++; } }),
    schedule: (fn, delay) => { scheduled = { fn, delay }; return token; },
    cancel: (value) => { cancelled = value; },
  });
  await new Promise(setImmediate);
  assert.equal(polls, 1); assert.equal(scheduled.delay, 10000);
  await stop(); assert.equal(cancelled, token); assert.equal(closed, 1);
  await scheduled.fn(); assert.equal(polls, 1);
});
