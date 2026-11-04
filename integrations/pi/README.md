# Remindi extension for Pi

Native Pi extension for scheduled Remindi delivery. It polls MCP without an
LLM call, delivers reminder messages and instructions into the **current Pi
session**, and leaves acknowledgement/completion to the agent. No Remindi
server changes or OpenCode packages are needed.

## Install and configure

Requires Node.js 22+ and Pi's extension API (verified on Pi 1.5.0).
From the repository root:

```sh
npm --prefix integrations/pi ci --ignore-scripts
```

Add the package directory to the target project's `.pi/settings.json`,
preserving existing settings:

```json
{
  "packages": ["/absolute/path/to/Remindi/integrations/pi"]
}
```

or

```bash
cd /path/to/Remindi/integrations/pi && pi install $PWD
```

Alternatively, try it without changing settings:

```sh
pi -e /absolute/path/to/Remindi/integrations/pi/index.js
```

Configure the process environment **before launching Pi**:

```sh
export REMINDI_URL='https://mcp.example.com/remindi'
export REMINDI_PROJECT_ID='/absolute/path/to/your-project'
export REMINDI_TOKEN_ENV='REMINDI_MCP_TOKEN'
# Set REMINDI_MCP_TOKEN privately in the launcher/shell; never commit its value.
pi
```

Use the actual Streamable HTTP endpoint: `/mcp` for a default local Remindi
instance, or your hosted endpoint. The URL must not contain credentials.
For PHrK's existing environment, set `REMINDI_TOKEN_ENV=PHRK_MCP_AUTH_TOKEN`
and use `https://mcp.phrk.org/remindi`; no token needs copying.
Reload with `/reload` after installation, or restart Pi. Project-local package
loading is subject to Pi's project trust controls. Nothing in this repository
automatically enables the extension in your current or global Pi setup.

| Environment | CLI flag | Default |
|---|---|---|
| `REMINDI_URL` | `--remindi-url` | Unset: disabled, no connection/timer |
| `REMINDI_PROJECT_ID` | `--remindi-project-id` | Pi's current working directory |
| `REMINDI_TOKEN_ENV` | `--remindi-token-env` | `REMINDI_MCP_TOKEN` |
| `REMINDI_FALLBACK_SESSION_ID` | `--remindi-fallback-session-id` | No fallback |

Flags override environment values. Tokens are read from the named environment
variable, not from a CLI argument. An enabled connection requires a populated
token variable. The extension owns its own MCP SDK connection; it neither
registers Remindi tools nor replaces your existing MCP configuration.

## Routing and status

Run `/remindi` to see connection status and the exact `project_id` and
`session_id`. Pass that **Pi session ID** as `session_id` when creating a reminder
with `remindi_add`; Remindi stores it as `source_session_id`. Do not pass the
MCP transport session ID or an OpenCode `ses_...` ID.

The configured project ID must exactly match the reminder's `project_id`.
Only the current Pi session can receive delivery. A reminder addressed to a
different session is left untouched until that session is opened with this
extension. There is no guessed current-session routing for untagged items.
`REMINDI_FALLBACK_SESSION_ID` explicitly assigns untagged reminders to one
session; it has an effect only while that exact session is open. It never
overrides an existing source session ID. Forking/new sessions have new IDs.

`polling` means the last poll succeeded, not that an obligation was performed.
`unavailable (retrying)` means a network/list/delivery failure occurred; retries
continue. Diagnostics do not include tokens, raw server errors or reminder text.

## Delivery behavior and limits

- Polls on session start, then at most ten seconds after the preceding poll
  finishes. A near-future timestamp shortens the next delay. That next poll
  re-reads server state; it does not deliver an old cached reminder early.
- Supports `next_fire_at` and `snooze_until`, pagination, due/overdue items,
  and recurring occurrences. Cancellations/snoozes observed on the next read
  suppress delivery. Changes after a read can still race delivery.
- Uses native `pi.sendMessage` custom messages with `deliverAs: "steer"` and
  **omits** `triggerTurn`. In Pi 1.5.0 this steers an active run at its next
  steering boundary, but appends to an idle session without starting a model
  turn. Explicit `triggerTurn: false` would suppress active steering; `true`
  would start an idle turn. No disconnected process/session can be woken.
- Dedupe is scoped by endpoint, project, session, reminder and occurrence/time.
  Persisted Pi custom messages restore it on reload/resume. Pending messages
  also have in-memory dedupe while the agent is active. Each poll reconciles
  persisted receipts; once idle, unpersisted submissions become retryable.
  A queued message lost before persistence can also be retried after reload;
  delivery and persistence are not an atomic/exactly-once transaction. Pi's
  `sendMessage` API does not provide an admission receipt.
- Reads all session entries for dedupe, so navigating `/tree` within one session
  does not redeliver the same persisted occurrence. Forked sessions do not
  inherit their parent's delivery identity. In-memory/nonpersistent sessions
  cannot retain receipts after process exit. Multiple instances of the same
  session can compete; use one delivery instance per session.
- Stops its timer/connection on `session_shutdown` (including reload and session
  replacement on Pi 1.5.0). Late network results cannot deliver after shutdown.
- **Never** acknowledges, completes, cancels or reschedules a reminder.
  Delivery does not prove reassessment or execution. Continue `remindi_check`
  at lifecycle boundaries and for context/condition triggers without a concrete
  fire time. Configure your normal MCP tools separately for those operations.

## How it relates to the OpenCode integration

The Rust service owns durable SQLite reminders, evaluation, recurrence and
audit history. Both extensions are optional client delivery adapters. The
OpenCode integration's `bridge.js` implements scheduling/routing/dedupe;
`adapter.js` connects MCP, plugin storage and OpenCode sessions; `index.js`
registers `Plugin.define`. It sends `session.synthetic` with deterministic
message IDs, explicit session lookup and plugin-storage receipts.

The Pi package instead uses a native extension factory (`index.js`), lifecycle
and configuration (`extension.js`), a standalone MCP client (`client.js`), and
current-session polling plus custom-message receipts (`bridge.js`). Pi has no
OpenCode `session.synthetic` or plugin-storage API; those are not emulated.
The existing OpenCode integration is unchanged.

## Verification

```sh
npm --prefix integrations/pi test
npm --prefix integrations/pi run check
# Optional: installed Pi SDK host smoke, without a prompt or model call:
PI_SDK_MODULE=/path/to/pi-coding-agent/dist/index.js \
  node integrations/pi/scripts/smoke.mjs
```

`PI_SDK_MODULE` is unnecessary if the host SDK resolves normally from Node.
The smoke uses a temporary isolated agent directory, the real Pi file loader,
real native message persistence and session reload reconstruction; its MCP list
boundary is a fixture. It does not change global Pi settings.

Verified during development on 2026-11-04: initial RED tests failed against
no-op boundaries, then focused tests and syntax checks passed; the real Pi
1.5.0 SDK smoke admitted an idle reminder, restored dedupe on runtime reload,
and closed owned resources with **zero model turns**. All 15 focused Pi tests
and 15 existing OpenCode tests passed. Independent source review found two
delivery/validation defects; both received RED/GREEN regression tests and the
targeted re-review found no remaining issues. The extension's MCP
client also successfully authenticated and listed against the deployed PHrK
Remindi service. These are separate checks, not proof of a deployed timed
end-to-end bridge or active-run delivery. The extension is not automatically
installed in your running session.

API evidence: Documentation MCP's **pi** library,
[extensions](https://pi.dev/docs/latest/extensions),
[packages](https://pi.dev/docs/latest/packages), and
[SDK](https://pi.dev/docs/latest/sdk); checked against the installed Pi 1.5.0
`docs/extensions.md`, `examples/sdk/06-extensions.ts` and
`dist/core/agent-session.js` (`sendCustomMessage`).
