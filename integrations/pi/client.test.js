import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeList } from './client.js';

test('decodes structured and text MCP list envelopes', () => {
  for (const result of [{ structuredContent: { ok: true, data: { items: [], next_cursor: null } } }, { content: [{ type: 'text', text: '{"ok":true,"data":{"items":[],"next_cursor":"page2"}}' }] }]) {
    assert.deepEqual(decodeList(result).items, []);
  }
});
test('rejects malformed reminder fields while allowing nullable lifecycle schedules', () => {
  const valid = { id: 'r1', project_id: 'home', source_session_id: null, state: 'scheduled', occurrence_no: 1, message: 'scope', instructions: null, next_fire_at: null, snooze_until: null };
  const wrap = (item) => ({ structuredContent: { ok: true, data: { items: [item], next_cursor: null } } });
  assert.equal(decodeList(wrap(valid)).items.length, 1);
  for (const patch of [{ id: undefined }, { message: undefined }, { occurrence_no: undefined }, { occurrence_no: '1' }, { occurrence_no: 0 }, { source_session_id: {} }, { instructions: [] }, { next_fire_at: 'nonsense' }, { snooze_until: 17 }, { state: 'other' }]) {
    assert.throws(() => decodeList(wrap({ ...valid, ...patch })));
  }
  assert.throws(() => decodeList(wrap(null)));
});
test('rejects malformed/error envelopes instead of treating them as an empty list', () => {
  for (const result of [{}, { isError: true, structuredContent: { ok: true, data: { items: [] } } }, { structuredContent: { ok: false } }, { structuredContent: { ok: true, data: { items: [], next_cursor: 5 } } }, { content: [{ type: 'text', text: 'bad JSON' }] }]) {
    assert.throws(() => decodeList(result));
  }
});
