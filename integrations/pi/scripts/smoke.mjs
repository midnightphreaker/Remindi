// Optional installed-host check; no prompts, model calls or global settings writes.
// PI_SDK_MODULE may name the installed Pi dist/index.js when not on Node's path.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupExtension } from '../extension.js';

const sdk = await import(process.env.PI_SDK_MODULE || '@earendil-works/pi-coding-agent');
const { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } = sdk;
const dir = await mkdtemp(join(tmpdir(), 'remindi-pi-smoke-'));
const cwd = dir, manager = SessionManager.inMemory(cwd);
const settings = SettingsManager.inMemory({});
let closed = 0, turns = 0;
const item = { id: 'smoke-reminder', project_id: cwd, source_session_id: manager.getSessionId(), occurrence_no: 1, state: 'due', next_fire_at: '2000-01-01T00:00:00Z', message: 'Smoke reminder', instructions: 'No acknowledgement is automatic.' };
let session;
async function create(inline) {
  const loader = new DefaultResourceLoader({
    cwd, agentDir: dir, settingsManager: settings,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    additionalExtensionPaths: inline ? [] : [resolve(fileURLToPath(new URL('../index.js', import.meta.url)))],
    extensionFactories: inline ? [(pi) => setupExtension(pi, {
      env: { REMINDI_URL: 'https://example.com/mcp', REMINDI_MCP_TOKEN: 'fixture-only' },
      connect: async () => ({ list: async () => ({ items: [item], next_cursor: null }), close: async () => { closed++; } }),
    })] : [],
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const result = await createAgentSession({ cwd, agentDir: dir, settingsManager: settings, resourceLoader: loader, sessionManager: manager, tools: [] });
  session = result.session;
  session.subscribe((event) => { if (event.type === 'agent_start') turns++; });
  await session.bindExtensions({ onError: (e) => { throw new Error(JSON.stringify(e)); } });
}
async function stop() {
  if (!session) return;
  await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'reload' });
  session.dispose(); session = undefined;
}
try {
  // Real file loader/factory/flag/command registration; normally unconfigured.
  const previous = process.env.REMINDI_URL;
  delete process.env.REMINDI_URL;
  try { await create(false); await stop(); }
  finally { if (previous !== undefined) process.env.REMINDI_URL = previous; }
  await create(true);
  const messages = () => manager.getEntries().filter((e) => e.type === 'custom_message' && e.customType === 'remindi-reminder');
  assert.equal(messages().length, 1);
  assert.match(messages()[0].content, /Smoke reminder/);
  assert.equal(session.isStreaming, false);
  assert.equal(turns, 0, 'idle delivery must not request a model turn');
  await stop(); await create(true);
  assert.equal(messages().length, 1, 'persisted message must suppress reload duplicates');
  await stop(); assert.equal(closed, 2);
  console.log('PASS: real Pi loader, native idle delivery, persisted-message reload dedupe, shutdown; zero model turns');
} finally { await stop(); await rm(dir, { recursive: true, force: true }); }
