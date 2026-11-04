import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export function decodeList(result) {
  const value = result.structuredContent ?? JSON.parse(result.content?.find((part) => part.type === 'text')?.text ?? 'null');
  if (result.isError || value?.ok !== true || !Array.isArray(value.data?.items) ||
      (value.data.next_cursor != null && typeof value.data.next_cursor !== 'string')) {
    throw new Error('Remindi list failed or returned an invalid response');
  }
  for (const item of value.data.items) {
    const text = (value) => typeof value === 'string' && value.trim().length > 0;
    const timestamp = (value) => value == null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
    if (!item || !text(item.id) || !text(item.project_id) || !text(item.message) ||
        !Number.isSafeInteger(item.occurrence_no) || item.occurrence_no < 1 ||
        !['scheduled', 'due', 'overdue', 'snoozed', 'completed', 'cancelled'].includes(item.state) ||
        (item.source_session_id != null && !text(item.source_session_id)) ||
        (item.instructions != null && typeof item.instructions !== 'string') ||
        !timestamp(item.next_fire_at) || !timestamp(item.snooze_until)) {
      throw new Error('Remindi list returned an invalid reminder');
    }
  }
  return value.data;
}

export async function connectRemindi({ url, token }) {
  const client = new Client({ name: 'pi-remindi', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  try { await client.connect(transport, { timeout: 5000 }); }
  catch (error) { await client.close().catch(() => {}); throw error; }
  return {
    list: async (args) => decodeList(await client.callTool({ name: 'remindi_list', arguments: args }, undefined, { timeout: 5000 })),
    close: () => client.close(),
  };
}
