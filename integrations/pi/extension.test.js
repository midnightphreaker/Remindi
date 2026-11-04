import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupExtension } from './extension.js';

function fixture(env = { REMINDI_URL: 'https://example.com/mcp', REMINDI_MCP_TOKEN: 'private' }, overrides = {}) {
  const handlers = new Map(), commands = new Map(), flags = new Map();
  const sent = [], timers = [], notices = [], calls = [];
  let closed = 0;
  const pi = {
    on: (name, fn) => handlers.set(name, fn),
    registerFlag: (name, spec) => flags.set(name, spec.default), getFlag: (name) => flags.get(name),
    registerCommand: (name, spec) => commands.set(name, spec),
    sendMessage: (message, options) => { sent.push({ message, options }); },
  };
  const item = { id: 'r1', project_id: '/project', source_session_id: 'current', state: 'due', next_fire_at: '2000-01-01T00:00:00Z', occurrence_no: 1, message: 'scope' };
  const deps = { env, connect: async (args) => { calls.push(args); return { list: async () => ({ items: [item], next_cursor: null }), close: async () => { closed++; } }; },
    schedule: (fn, delay) => { const timer = { fn, delay, cancelled: false, unref() {} }; timers.push(timer); return timer; }, cancel: (timer) => { if (timer) timer.cancelled = true; }, ...overrides };
  const ctx = { cwd: '/project', hasUI: true, isIdle: () => true, sessionManager: { getSessionId: () => 'current', getEntries: () => sent.map(({ message }) => ({ type: 'custom_message', ...message })) }, ui: { notify: (text) => notices.push(text), setStatus() {} } };
  setupExtension(pi, deps);
  return { pi, deps, ctx, handlers, commands, flags, sent, timers, notices, calls, item, closed: () => closed };
}

test('factory starts no resources; session start polls; shutdown cancels timer/closes connection', async () => {
  const f = fixture(); assert.equal(f.calls.length, 0);
  await f.handlers.get('session_start')({}, f.ctx);
  assert.equal(f.sent.length, 1); assert.equal(f.calls[0].token, 'private');
  assert.equal(f.timers[0].delay, 10000);
  await f.handlers.get('session_shutdown')({}, f.ctx); await f.handlers.get('session_shutdown')({}, f.ctx);
  assert.equal(f.timers[0].cancelled, true); assert.equal(f.closed(), 1);
  await f.timers[0].fn(); assert.equal(f.sent.length, 1);
});

test('unconfigured extension is disabled, status exposes identity not credentials', async () => {
  const f = fixture({}); await f.handlers.get('session_start')({}, f.ctx);
  assert.equal(f.calls.length, 0); assert.equal(f.timers.length, 0);
  await f.commands.get('remindi').handler('', f.ctx);
  assert.match(f.notices.at(-1), /disabled/); assert.match(f.notices.at(-1), /current/); assert.match(f.notices.at(-1), /\/project/);
});

test('validates endpoint/token and flag overrides without exposing secrets', async () => {
  for (const env of [{ REMINDI_URL: 'file:///tmp/a' }, { REMINDI_URL: 'https://user:SECRET@example.com' }, { REMINDI_URL: 'https://example.com/mcp' }]) {
    const f = fixture(env); await f.handlers.get('session_start')({}, f.ctx);
    assert.equal(f.calls.length, 0); assert.equal(f.timers.length, 0);
    assert.match(f.notices.join(' '), /configuration/); assert.doesNotMatch(f.notices.join(' '), /SECRET/);
  }
  const f = fixture({ REMINDI_URL: 'https://example.com/mcp', ALT_TOKEN: 'other-private' });
  f.flags.set('remindi-project-id', 'custom'); f.flags.set('remindi-token-env', 'ALT_TOKEN');
  f.item.project_id = 'custom'; await f.handlers.get('session_start')({}, f.ctx); assert.equal(f.sent.length, 1);
  await f.commands.get('remindi').handler('', f.ctx); assert.match(f.notices.at(-1), /custom/); assert.doesNotMatch(f.notices.join(' '), /other-private/);
});

test('connection/list failure retries on next poll and emits only sanitized warning', async () => {
  let attempts = 0, closed = 0;
  const f = fixture(undefined, { connect: async () => {
    attempts++; return { list: async () => { throw new Error('SECRET content'); }, close: async () => { closed++; } };
  } });
  await f.handlers.get('session_start')({}, f.ctx); await f.timers[0].fn();
  assert.equal(attempts, 2); assert.equal(closed, 2);
  assert.equal(f.notices.length, 1); assert.doesNotMatch(f.notices.join(' '), /SECRET/);
});

test('shutdown during connection or list prevents delivery and new timers', async () => {
  for (const stage of ['connect', 'list']) {
    let release, closed = 0;
    const gate = new Promise((r) => { release = r; });
    const f = fixture(undefined, { connect: async () => {
      if (stage === 'connect') await gate;
      return { list: async () => { if (stage === 'list') await gate; return { items: [f.item], next_cursor: null }; }, close: async () => { closed++; } };
    } });
    const start = f.handlers.get('session_start')({}, f.ctx);
    await new Promise((r) => setImmediate(r));
    const stop = f.handlers.get('session_shutdown')({}, f.ctx); release(); await Promise.all([start, stop]);
    assert.equal(f.sent.length, 0); assert.equal(f.timers.length, 0); assert.equal(closed, 1);
  }
});
