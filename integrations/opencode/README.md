# OpenCode V2 Remindi bridge

Local plugin for scheduled Remindi reminders. No Remindi server changes are
required. Polling uses an MCP client, not an LLM.
The local directory entry is `index.js`, as required by OpenCode's local loader.

## Setup

From this directory run `npm ci --ignore-scripts`. Add this entry to the
**project's** OpenCode V2 configuration, preserving existing plugins:

```jsonc
{
  "plugins": [{
    "package": "/Workspace/Remindi/integrations/opencode",
    "options": {
      "url": "http://YOUR-REMINDI-HOST:PORT/mcp",
      "projectID": "/Workspace/AGENTS",
      "tokenEnv": "REMINDI_API_TOKEN"
    }
  }]
}
```

Use the exact Remindi project ID and the existing MCP endpoint. Supply the token
through the named environment variable, not the config file. Omit `tokenEnv`
only when the server permits unauthenticated access. This client does not reuse
OpenCode's MCP OAuth login or embedded MCP connection.

Reminders target their `source_session_id`. An optional `fallbackSessionID`
option explicitly routes reminders without that field to one chosen session;
there is no guessed/current-session fallback. Both routes require that the
destination session belongs to the plugin's directory and is not archived.
Use one plugin instance per project to avoid competing deliveries.

## Behaviour and limits

- Polls immediately, then every ten seconds. When a scheduled time falls within
  the next ten seconds, rechecks at that time instead of sending early. Network
  latency and a busy event loop can delay delivery; this is not a real-time guarantee.
- Re-reads cancellations and snoozes before delivery. Supports concrete
  `next_fire_at` / `snooze_until` times; condition, next-session and continuation
  triggers without a scheduled time still require `remindi_check`.
- Calls `ctx.session.synthetic` with `delivery: "steer", resume: false`.
  This admits a reminder to the session inbox without starting an idle model
  run. An idle session may not process it until the next user/model run.
- Includes the reminder message and instructions. Never acknowledges,
  completes or reschedules the reminder. Receiving it is not proof the agent
  performed the requested reassessment.
- Stores the last delivered occurrence per reminder/session in plugin storage;
  retries use a stable message ID. Normal polls/reloads are deduplicated. An
  ambiguous delivery/storage failure or multiple running instances is **not**
  an exactly-once delivery guarantee.
- Retries failed connections/deliveries on later polls, logs no reminder text
  or credentials, and closes its owned timer/connection on unload.

## Checks

`npm test` runs focused automated tests; `npm run check` checks JavaScript syntax.
SDK dependencies are pinned in `package-lock.json`. The entry uses
`Plugin.define` from `@opencode/plugin` 2.0.3 and the MCP SDK 1.32.2.
Unit tests do not enable the plugin. On 2026-10-26, the local integration was
enabled for `/Workspace/AGENTS` on OpenCode 2.1.2 and a real test reminder plus
the recurring scope guard reached the intended session. The service reported
`phrk-remindi` active. On this installation, inspect the running service with
`opencode api --server http://127.0.0.1:8080`; the CLI's default connection
selected a different server during verification.

API references: [V2 plugins](https://opencode.ai/v2/docs/build/plugins),
[V2 session API](https://opencode.ai/v2/docs/api), and
the installed SDK's `config/plugin`, `SessionSyntheticInput` and
`StreamableHTTPClientTransport` declarations.
