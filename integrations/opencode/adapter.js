import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createBridge } from './bridge.js';

export function decodeList(result) {
  const value = result.structuredContent ?? JSON.parse(result.content?.find((part) => part.type === 'text')?.text ?? 'null');
  if (result.isError || value?.ok !== true || !Array.isArray(value.data?.items) ||
      (value.data.next_cursor != null && typeof value.data.next_cursor !== 'string')) {
    throw new Error('Remindi list failed or returned an invalid response');
  }
  return value.data;
}

async function connectRemindi({ url, token }) {
  const client = new Client({ name: 'opencode-remindi', version: '0.1.0' });
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } });
  try { await client.connect(transport, { timeout: 5000 }); }
  catch (error) { await client.close().catch(() => {}); throw error; }
  return {
    list: async (args) => decodeList(await client.callTool({ name: 'remindi_list', arguments: args }, undefined, { timeout: 5000 })),
    close: () => client.close(),
  };
}

export async function setupBridge(ctx, { connect = connectRemindi, schedule = setTimeout, cancel = clearTimeout, warn = console.warn } = {}) {
  const { projectID, url, tokenEnv, fallbackSessionID } = ctx.options;
  if (typeof projectID !== 'string' || !projectID.trim()) throw new Error('Remindi plugin requires projectID');
  let endpoint;
  try { endpoint = new URL(url); } catch { throw new Error('Remindi plugin requires a valid MCP URL'); }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error('Remindi requires an HTTP(S) URL without embedded credentials');
  if (tokenEnv != null && (typeof tokenEnv !== 'string' || !tokenEnv || !process.env[tokenEnv])) throw new Error('Remindi tokenEnv must name a populated environment variable');
  const token = tokenEnv ? process.env[tokenEnv] : undefined;
  if (fallbackSessionID != null && (typeof fallbackSessionID !== 'string' || !fallbackSessionID.startsWith('ses_'))) throw new Error('Remindi fallbackSessionID must be a session ID');
  let stopped = false, timer, connection, cyclePromise, warned = false, failed = false;
  const report = () => {
    failed = true;
    // Never log reminder content, tokens, raw server errors or credential URLs.
    if (!warned) { warn('Remindi bridge: delivery unavailable; retrying on the next poll.'); warned = true; }
  };
  const bridge = createBridge({
    projectID, directory: ctx.location.directory, fallbackSessionID, storage: ctx.storage, onError: report,
    list: async (args) => {
      if (!connection) {
        connection = await connect({ url, token });
        if (stopped) { await connection.close(); connection = undefined; throw new Error('Bridge stopped'); }
      }
      return connection.list(args);
    },
    getSession: (sessionID) => ctx.session.get({ sessionID }),
    deliver: (input) => stopped ? Promise.reject(new Error('Bridge stopped')) : ctx.session.synthetic(input),
  });
  async function cycle() {
    if (stopped) return;
    let delay = 10000;
    failed = false;
    try { delay = await bridge.poll(); if (!failed) warned = false; }
    catch {
      if (!stopped) report();
      await connection?.close().catch(() => {}); connection = undefined;
    } finally {
      if (!stopped) { timer = schedule(() => { cyclePromise = cycle(); return cyclePromise; }, delay); timer?.unref?.(); }
    }
  }
  cyclePromise = cycle();
  return async () => {
    stopped = true; cancel(timer);
    await connection?.close().catch(() => {});
    await cyclePromise;
  };
}
