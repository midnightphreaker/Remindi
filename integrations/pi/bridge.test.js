import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBridge } from './bridge.js';

function fixture(overrides = {}) {
  let now = 100000, items = [];
  const sent = [], errors = [], requests = [], entries = [];
  const options = {
    projectID: 'home', sessionID: 'pi-session', endpoint: 'https://example.com/mcp', entries,
    now: () => now,
    list: async (args) => { requests.push(args); return { items, next_cursor: null }; },
    deliver: (message, options) => { sent.push({ message, options }); entries.push({ type: 'custom_message', ...message }); }, onError: (error) => errors.push(error), ...overrides,
  };
  const reminder = (changes = {}) => ({ id: 'r1', project_id: 'home', source_session_id: 'pi-session', state: 'scheduled', occurrence_no: 1, next_fire_at: '1970-01-01T00:01:40.000Z', message: 'Reassess scope', instructions: 'Read original request', ...changes });
  return { bridge: createBridge(options), options, sent, requests, errors, reminder, setItems: (x) => { items = x; }, setNow: (x) => { now = x; } };
}

test('delivers message/instructions as native steering without an idle-turn request', async () => {
  const f = fixture(); f.setItems([f.reminder()]);
  assert.equal(await f.bridge.poll(), 10000);
  assert.deepEqual(f.requests[0], { project_id: 'home', states: ['scheduled', 'due', 'overdue', 'snoozed'], limit: 200 });
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].message.customType, 'remindi-reminder');
  assert.match(f.sent[0].message.content, /Reassess scope/);
  assert.match(f.sent[0].message.content, /Read original request/);
  assert.match(f.sent[0].message.content, /not acknowledgement/);
  assert.deepEqual(f.sent[0].options, { deliverAs: 'steer' }); // false suppresses active steering; true wakes idle
});

test('strict current-session/project routing and explicit untagged fallback', async () => {
  const f = fixture(); f.setItems([
    f.reminder({ source_session_id: 'other' }), f.reminder({ source_session_id: null }),
    f.reminder({ project_id: 'other' }), f.reminder({ state: 'completed' }),
    f.reminder({ state: 'cancelled' }), f.reminder({ next_fire_at: null }),
  ]);
  await f.bridge.poll(); assert.equal(f.sent.length, 0);
  const fallback = fixture({ fallbackSessionID: 'pi-session' });
  fallback.setItems([fallback.reminder({ source_session_id: null }), fallback.reminder({ id: 'r2', source_session_id: 'other' })]);
  await fallback.bridge.poll(); assert.equal(fallback.sent.length, 1);
});

test('rechecks due times and snoozes rather than delivering early/stale reminders', async () => {
  const f = fixture(); f.setItems([f.reminder({ next_fire_at: '1970-01-01T00:01:45.000Z' })]);
  assert.equal(await f.bridge.poll(), 5000); assert.equal(f.sent.length, 0);
  f.setNow(105000); f.setItems([f.reminder({ state: 'snoozed', snooze_until: '1970-01-01T00:01:49.000Z' })]);
  assert.equal(await f.bridge.poll(), 4000); assert.equal(f.sent.length, 0);
  f.setItems([]); f.setNow(109000); await f.bridge.poll(); assert.equal(f.sent.length, 0);
  f.setItems([f.reminder({ state: 'snoozed', snooze_until: '1970-01-01T00:01:49.000Z' })]);
  await f.bridge.poll(); assert.equal(f.sent.length, 1);
});

test('dedupes polls/reloads from persisted messages, but not next occurrences or forked sessions', async () => {
  const f = fixture(); f.setItems([f.reminder()]); await f.bridge.poll(); await f.bridge.poll();
  assert.equal(f.sent.length, 1);
  const entries = [{ type: 'custom_message', ...f.sent[0].message }];
  await createBridge({ ...f.options, entries }).poll(); assert.equal(f.sent.length, 1);
  f.setItems([f.reminder({ occurrence_no: 2 })]); await f.bridge.poll(); assert.equal(f.sent.length, 2);
  const fork = fixture({ sessionID: 'fork', entries }); fork.setItems([fork.reminder({ source_session_id: 'fork' })]);
  await fork.bridge.poll(); assert.equal(fork.sent.length, 1);
  const differentEndpoint = fixture({ endpoint: 'https://other.example/mcp', entries }); differentEndpoint.setItems([differentEndpoint.reminder()]);
  await differentEndpoint.bridge.poll(); assert.equal(differentEndpoint.sent.length, 1);
});

test('failed delivery retries in the same instance, then dedupes the persisted receipt', async () => {
  let fail = true, attempts = 0;
  const entries = [];
  const f = fixture({ entries, deliver: (message) => { attempts++; if (fail) throw new Error('offline'); entries.push({ type: 'custom_message', ...message }); } });
  f.setItems([f.reminder()]); await f.bridge.poll(); assert.equal(f.errors.length, 1);
  fail = false; await f.bridge.poll(); await f.bridge.poll(); assert.equal(attempts, 2);
});

test('void sendMessage without persistence retries when idle, while pending active messages do not duplicate', async () => {
  let idle = true, persist = false, attempts = 0;
  const entries = [];
  const f = fixture({ entries, isIdle: () => idle, getEntries: () => entries,
    deliver: (message) => { attempts++; if (persist) entries.push({ type: 'custom_message', ...message }); },
  });
  f.setItems([f.reminder()]); await f.bridge.poll(); // native void API hides failed persistence
  persist = true; await f.bridge.poll(); await f.bridge.poll(); assert.equal(attempts, 2);
  idle = false; persist = false; f.setItems([f.reminder({ occurrence_no: 2 })]);
  await f.bridge.poll(); await f.bridge.poll(); assert.equal(attempts, 3);
  idle = true; persist = true; await f.bridge.poll(); await f.bridge.poll(); assert.equal(attempts, 4);
});

test('follows pages, rejects repeated cursors, and serializes concurrent polls', async () => {
  let release, calls = 0;
  const f = fixture({ list: async ({ cursor }) => {
    calls++;
    if (!cursor) { await new Promise((r) => { release = r; }); return { items: [], next_cursor: 'p2' }; }
    return { items: [f.reminder()], next_cursor: null };
  } });
  const a = f.bridge.poll(), b = f.bridge.poll(); release(); await Promise.all([a, b]);
  assert.equal(calls, 2); assert.equal(f.sent.length, 1);
  const looping = fixture({ list: async () => ({ items: [], next_cursor: 'same' }) });
  await assert.rejects(looping.bridge.poll(), /cursor/);
});
