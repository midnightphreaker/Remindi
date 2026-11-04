const PERIOD = 10000;
const ACTIVE = ['scheduled', 'due', 'overdue', 'snoozed'];
export const MESSAGE_TYPE = 'remindi-reminder';

// Keep one last occurrence per reminder. Persisted messages, not a separate
// pre-delivery marker, establish what actually reached the session on reload.
export function createBridge({ projectID, sessionID, endpoint, fallbackSessionID, list, deliver, entries = [], getEntries = () => entries, isIdle = () => true, now = Date.now, onError = () => {} }) {
  const admitted = new Map(), pending = new Map();
  let running;
  async function poll() {
    // sendMessage returns void, and asynchronous persistence failures only emit
    // a Pi extension error. Confirm from session entries, never from its return.
    for (const entry of getEntries()) {
      const d = entry.details;
      if (entry.type === 'custom_message' && entry.customType === MESSAGE_TYPE &&
          d?.projectID === projectID && d.sessionID === sessionID && d.endpoint === endpoint) {
        admitted.set(d.remindiID, d.occurrenceKey);
      }
    }
    // Active steering may still be queued. Once idle, an unpersisted submission
    // has no durable receipt and must be eligible for retry after recovery.
    if (isIdle()) pending.clear();
    let delay = PERIOD, cursor;
    const cursors = new Set();
    do {
      const page = await list({ project_id: projectID, states: ACTIVE, limit: 200, ...(cursor ? { cursor } : {}) });
      for (const item of page.items) {
        if (item.project_id !== projectID || !ACTIVE.includes(item.state) ||
            (item.source_session_id || fallbackSessionID) !== sessionID) continue;
        const fire = item.state === 'snoozed' ? item.snooze_until : item.next_fire_at;
        const at = Date.parse(fire);
        if (!Number.isFinite(at)) continue; // lifecycle/condition checks belong to the agent
        const wait = at - now();
        if (wait > 0) { delay = Math.min(delay, wait); continue; }
        const occurrenceKey = `${item.occurrence_no}:${fire}`;
        if (admitted.get(item.id) === occurrenceKey || pending.get(item.id) === occurrenceKey) continue;
        try {
          await deliver({
            customType: MESSAGE_TYPE, display: true,
            content: `[Remindi reminder ${item.id}; occurrence ${item.occurrence_no}]\n${item.message}${item.instructions ? `\n\n${item.instructions}` : ''}\n\nDelivery is not acknowledgement. Reassess before acknowledging through Remindi.`,
            details: { endpoint, projectID, sessionID, remindiID: item.id, occurrenceKey },
          }, { deliverAs: 'steer' });
          // Omit triggerTurn: explicit false suppresses active steering on Pi
          // 1.5; true starts an idle turn. Undefined does neither of those.
          pending.set(item.id, occurrenceKey);
        } catch (error) { onError(error); }
      }
      cursor = page.next_cursor;
      if (cursor && cursors.has(cursor)) throw new Error('Remindi repeated a pagination cursor');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return Math.max(1, Math.min(PERIOD, delay));
  }
  return { poll: () => running ??= poll().finally(() => { running = undefined; }) };
}
