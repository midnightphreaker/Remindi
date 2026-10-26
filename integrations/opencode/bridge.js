import { createHash } from 'node:crypto';

const PERIOD = 10000;
const ACTIVE = ['scheduled', 'due', 'overdue', 'snoozed'];

// One poll at a time. The next poll re-reads Remindi, including cancellations
// and snoozes, rather than delivering a stale copy from a ten-second timer.
export function createBridge({ projectID, directory, fallbackSessionID, list, getSession, deliver, storage, now = Date.now, onError = () => {} }) {
  let running;
  async function poll() {
    let delay = PERIOD;
    let cursor;
    const cursors = new Set();
    do {
      const page = await list({ project_id: projectID, states: ACTIVE, limit: 200, ...(cursor ? { cursor } : {}) });
      for (const item of page.items) {
        const sessionID = item.source_session_id || fallbackSessionID;
        if (item.project_id !== projectID || !ACTIVE.includes(item.state) || !sessionID) continue;
        const fire = item.state === 'snoozed' ? item.snooze_until : item.next_fire_at;
        const at = Date.parse(fire);
        // Lifecycle/condition reminders without a concrete scheduled time are
        // deliberately left to remindi_check; never invent readiness here.
        if (!Number.isFinite(at)) continue;
        const wait = at - now();
        if (wait > 0) { delay = Math.min(delay, wait); continue; }
        try {
          // A single last-occurrence record per reminder/session is bounded,
          // persistent across reloads, and unaffected by unrelated version edits.
          const key = `remindi:${item.id}:${sessionID}`;
          const occurrence = `${item.occurrence_no}:${fire}`;
          if (await storage.get(key) === occurrence) continue;
          const session = await getSession(sessionID);
          if (session.location.directory !== directory || session.time.archived) continue;
          const id = `msg_${createHash('sha256').update(`${key}:${occurrence}`).digest('hex').slice(0, 26)}`;
          try {
            await deliver({
              sessionID, id, delivery: 'steer', resume: false,
              description: 'Remindi reminder',
              text: `[Remindi reminder ${item.id}; occurrence ${item.occurrence_no}]\n${item.message}${item.instructions ? `\n\n${item.instructions}` : ''}\n\nDelivery is not acknowledgement. Reassess before acknowledging through Remindi.`,
              metadata: { remindiID: item.id, occurrence: item.occurrence_no },
            });
          } catch (error) {
            // A lost reply can leave this exact deterministic ID already
            // admitted. Other conflicts still need a retry, not a success mark.
            if (error?._tag !== 'ConflictError' || error.resource !== id) throw error;
          }
          await storage.set(key, occurrence);
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
