import { createBridge } from './bridge.js';
import { connectRemindi } from './client.js';

export function setupExtension(pi, { env = process.env, connect = connectRemindi, schedule = setTimeout, cancel = clearTimeout } = {}) {
  for (const [name, variable, description] of [
    ['url', 'REMINDI_URL', 'Remindi Streamable HTTP MCP endpoint (unset disables delivery)'],
    ['project-id', 'REMINDI_PROJECT_ID', 'Exact Remindi project_id (default: current directory)'],
    ['token-env', 'REMINDI_TOKEN_ENV', 'Bearer token environment-variable name (default: REMINDI_MCP_TOKEN)'],
    ['fallback-session-id', 'REMINDI_FALLBACK_SESSION_ID', 'Explicit destination for reminders without source_session_id'],
  ]) pi.registerFlag(`remindi-${name}`, { type: 'string', description, default: env[variable] ?? '' });

  let stop, status = 'disabled', identity = '';
  pi.registerCommand('remindi', {
    description: 'Show Remindi delivery status and exact project/session identity',
    handler: async (_args, ctx) => { ctx.ui.notify(`Remindi: ${status}\n${identity || `project_id: ${ctx.cwd}\nsession_id: ${ctx.sessionManager.getSessionId()}`}`, 'info'); },
  });
  pi.on('session_shutdown', async () => { await stop?.(); stop = undefined; status = 'stopped'; });
  pi.on('session_start', async (_event, ctx) => {
    await stop?.(); stop = undefined;
    const projectID = pi.getFlag('remindi-project-id') || ctx.cwd;
    const sessionID = ctx.sessionManager.getSessionId();
    identity = `project_id: ${projectID}\nsession_id: ${sessionID}`;
    const url = pi.getFlag('remindi-url');
    if (!url) { status = 'disabled'; return; }
    const tokenEnv = pi.getFlag('remindi-token-env') || 'REMINDI_MCP_TOKEN';
    const token = env[tokenEnv];
    let endpoint;
    try { endpoint = new URL(url); } catch { /* handled below without echoing the URL */ }
    if (!endpoint || !['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password ||
        typeof projectID !== 'string' || !projectID.trim() || !sessionID || !token) {
      status = 'configuration error';
      if (ctx.hasUI) ctx.ui.notify('Remindi: invalid configuration; require HTTP(S) URL without credentials, project ID, session ID and populated token environment variable.', 'error');
      return;
    }
    let stopped = false, timer, connection, cyclePromise, warned = false, failed = false;
    const close = async () => { const owned = connection; connection = undefined; await owned?.close().catch(() => {}); };
    const report = () => {
      failed = true; status = 'unavailable (retrying)';
      if (!stopped && !warned && ctx.hasUI) {
        ctx.ui.notify('Remindi: delivery unavailable; retrying on the next poll.', 'warning'); warned = true;
      }
    };
    const bridge = createBridge({
      projectID, sessionID, endpoint: endpoint.href,
      fallbackSessionID: pi.getFlag('remindi-fallback-session-id') || undefined,
      getEntries: () => ctx.sessionManager.getEntries(), isIdle: () => ctx.isIdle(), onError: report,
      list: async (args) => {
        if (stopped) throw new Error('Bridge stopped');
        if (!connection) {
          connection = await connect({ url: endpoint.href, token });
          if (stopped) { await close(); throw new Error('Bridge stopped'); }
        }
        return connection.list(args);
      },
      deliver: (message, options) => {
        if (stopped || ctx.sessionManager.getSessionId() !== sessionID) throw new Error('Bridge stopped or session changed');
        pi.sendMessage(message, options);
      },
    });
    async function cycle() {
      if (stopped) return;
      let delay = 10000; failed = false;
      try { delay = await bridge.poll(); if (!failed && !stopped) { status = 'polling'; warned = false; } }
      catch { if (!stopped) report(); await close(); }
      finally {
        if (!stopped) { timer = schedule(() => { cyclePromise = cycle(); return cyclePromise; }, delay); timer?.unref?.(); }
      }
    }
    stop = async () => {
      stopped = true; cancel(timer);
      await close(); await cyclePromise;
    };
    cyclePromise = cycle();
    await cyclePromise;
  });
}
