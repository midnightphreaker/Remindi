import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBridge } from './bridge.js';

function fixture(overrides = {}) {
  let now = 100000;
  let items = [];
  const sent = [];
  const saved = new Map();
  const requests = [];
  const options = {
    projectID: 'home', directory: '/home/project',
    now: () => now,
    list: async (args) => { requests.push(args); return { items, next_cursor: null }; },
    getSession: async (id) => ({ id, location: { directory: '/home/project' }, time: {} }),
    deliver: async (input) => { sent.push(input); },
    storage: { get: async (key) => saved.get(key), set: async (key, value) => { saved.set(key, value); } },
    onError: () => {}, ...overrides,
  };
  const bridge = createBridge(options);
  const reminder = (changes = {}) => ({
    id: 'rem-1', project_id: 'home', source_session_id: 'ses_1',
    state: 'scheduled', occurrence_no: 1, next_fire_at: new Date(now).toISOString(),
    message: 'Reassess scope.', instructions: 'Check the original request.', ...changes,
  });
  return { bridge, options, sent, saved, requests, reminder, setItems: (value) => { items = value; }, setNow: (value) => { now = value; } };
}

test('polls only the configured project and delivers a due reminder without waking the model', async () => {
  const f = fixture(); f.setItems([f.reminder()]);
  assert.equal(await f.bridge.poll(), 10000);
  assert.equal(f.requests[0].project_id, 'home');
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].sessionID, 'ses_1');
  assert.equal(f.sent[0].resume, false);
  assert.equal(f.sent[0].delivery, 'steer');
  assert.match(f.sent[0].text, /Reassess scope/);
  assert.match(f.sent[0].text, /Check the original request/);
});

test('ten-second lookahead schedules a due-time recheck rather than delivering early', async () => {
  const f = fixture(); f.setItems([f.reminder({ next_fire_at: new Date(105000).toISOString() })]);
  assert.equal(await f.bridge.poll(), 5000);
  assert.equal(f.sent.length, 0);
  f.setNow(105000); await f.bridge.poll();
  assert.equal(f.sent.length, 1);
});

test('deduplicates repeated polls and restarts, but delivers the next occurrence', async () => {
  const f = fixture(); f.setItems([f.reminder()]);
  await f.bridge.poll(); await f.bridge.poll();
  await createBridge(f.options).poll();
  assert.equal(f.sent.length, 1);
  assert.equal(f.saved.size, 1);
  f.setItems([f.reminder({ occurrence_no: 2, next_fire_at: new Date(99000).toISOString() })]);
  await f.bridge.poll(); assert.equal(f.sent.length, 2);
});

test('an explicit fallback routes an untagged reminder, but never overrides its named session', async () => {
  const f = fixture({ fallbackSessionID: 'ses_fallback' });
  f.setItems([f.reminder({ source_session_id: null })]); await f.bridge.poll();
  assert.equal(f.sent[0]?.sessionID, 'ses_fallback');
  f.setItems([f.reminder({ id: 'other' })]); await f.bridge.poll();
  assert.equal(f.sent[1]?.sessionID, 'ses_1');
});

test('failed delivery is retried using the same message ID and not marked delivered', async () => {
  const attempts = []; let failing = true;
  const f = fixture({ deliver: async (input) => { attempts.push(input); if (failing) throw new Error('offline'); } });
  f.setItems([f.reminder()]); await f.bridge.poll(); assert.equal(f.saved.size, 0);
  failing = false; await f.bridge.poll();
  assert.equal(attempts.length, 2); assert.equal(attempts[0].id, attempts[1].id);
  assert.equal(f.saved.size, 1);
});

test('already-delivered occurrences skip session lookups on subsequent polls', async () => {
  let lookups = 0;
  const f = fixture({ getSession: async () => { lookups++; return { location: { directory: '/home/project' }, time: {} }; } });
  f.setItems([f.reminder()]); await f.bridge.poll(); await f.bridge.poll();
  assert.equal(lookups, 1);
});

test('an ambiguous admission converges when retry reports the same durable message ID', async () => {
  let attempts = 0;
  const f = fixture({ deliver: async (input) => {
    attempts++;
    if (attempts === 1) throw new Error('reply lost after admission');
    throw { _tag: 'ConflictError', resource: input.id, message: 'Synthetic input ID conflicts with an existing durable record' };
  } });
  f.setItems([f.reminder()]);
  await f.bridge.poll(); await f.bridge.poll(); await f.bridge.poll();
  assert.equal(attempts, 2); assert.equal(f.saved.size, 1);
});

test('unrelated conflicts are not treated as successful delivery', async () => {
  const f = fixture({ deliver: async () => { throw { _tag: 'ConflictError', resource: 'some-other-resource' }; } });
  f.setItems([f.reminder()]); await f.bridge.poll(); assert.equal(f.saved.size, 0);
});

test('rejects moved/archived sessions and follows pagination', async () => {
  const moved = fixture({ getSession: async () => ({ location: { directory: '/elsewhere' }, time: {} }) });
  moved.setItems([moved.reminder()]); await moved.bridge.poll(); assert.equal(moved.sent.length, 0);
  const archived = fixture({ getSession: async () => ({ location: { directory: '/home/project' }, time: { archived: 1 } }) });
  archived.setItems([archived.reminder()]); await archived.bridge.poll(); assert.equal(archived.sent.length, 0);
  const f = fixture(); let calls = 0;
  await createBridge({ ...f.options, list: async ({ cursor }) => {
    calls++; return cursor ? { items: [f.reminder()], next_cursor: null } : { items: [], next_cursor: 'page2' };
  } }).poll();
  assert.equal(calls, 2); assert.equal(f.sent.length, 1);
});

test('does not route untargeted, wrong-project, terminal or future reminders', async () => {
  const f = fixture(); f.setItems([
    f.reminder({ source_session_id: null }), f.reminder({ project_id: 'other' }),
    f.reminder({ state: 'cancelled' }), f.reminder({ state: 'completed' }),
    f.reminder({ next_fire_at: new Date(120000).toISOString() }),
  ]);
  assert.equal(await f.bridge.poll(), 10000); assert.equal(f.sent.length, 0);
});

test('a snooze overrides an older fire time and is rechecked before delivery', async () => {
  const f = fixture(); f.setItems([f.reminder({ state: 'snoozed', snooze_until: new Date(104000).toISOString() })]);
  assert.equal(await f.bridge.poll(), 4000); assert.equal(f.sent.length, 0);
  f.setItems([]); f.setNow(104000); await f.bridge.poll();
  assert.equal(f.sent.length, 0);
});
