# Pi Remindi Extension Implementation Plan

> **For agentic workers:** Use executing-plans inline with TDD and one fresh independent review.

**Original request:** Read the repository and OpenCode integration; use Documentation MCP's Pi library to create a Remindi extension for Pi.

**Goal:** A locally installable Pi delivery extension at `integrations/pi/`, without server or OpenCode changes.

**Architecture / short design:** Match the existing bridge's ten-second read-only MCP polling, due-time rechecks, pagination and occurrence deduplication. Use an independent MCP SDK connection. Deliver only reminders targeting the current Pi session, or an explicitly configured fallback matching that session. Restore dedupe from persisted custom messages, scoped by endpoint/project/session. Start resources on session_start; close them on session_shutdown. Environment variables and CLI flags avoid storing credentials in files. `/remindi` reports the exact current project/session and delivery status.

**Approaches:** Port the OpenCode adapter to native Pi (selected: small and independent); import the OpenCode package (rejected: sibling installation dependency); add a server push system (rejected: outside scope). Native JavaScript matches the existing integration and needs no build step.

**API evidence:** Documentation MCP `pi` library, https://pi.dev/docs/latest/extensions and installed Pi 1.5.0 docs/source. `sendMessage` with `deliverAs: steer` and **omitted** triggerTurn steers active runs and does not start idle ones. Explicit false suppresses steering in Pi 1.5.0; do not use it.

**Tech Stack:** Node >=22, JavaScript ESM, MCP SDK 1.32.2, Node test runner; Pi-provided ExtensionAPI.

## Global Constraints
- Never acknowledge/complete/reschedule reminders automatically; lifecycle checks remain the agent's responsibility.
- Exact project/session match; no cross-session wakeup; no reminder content/token/raw errors in diagnostics.
- Preserve OpenCode implementation and server behavior. No automatic activation in the user's global Pi settings.
- Beads blocked: `bd` not installed; `bd prime`/`bd ready` failed. Do not initialize a substitute tracker.
- Persistent scope guard: `01a1a517-6ee2-74a2-9ff9-6b6592ace0ad`, trigger and recurrence 600 seconds, unbounded; verified first fire 2026-11-04T05:55:38.754Z. Pull checks until delivery verified.

## Review Focus
- Reminders for other sessions/projects must never be admitted.
- Session shutdown during pending network operations must prevent stale delivery and timers.
- Reload/fork/tree behavior must not suppress a new session's reminder or duplicate a persisted occurrence.
- Future/snoozed/cancelled reminders must be re-read, not delivered from stale timers.
- Failed/malformed MCP responses must retry with sanitized diagnostics.

## Task 1: Native Pi delivery package
**Files:** Create `integrations/pi/{package.json,package-lock.json,index.js,extension.js,bridge.js,client.js,extension.test.js,bridge.test.js,client.test.js,README.md,.gitignore}`; update root `README.md` integration links.
**Interfaces:** `createBridge({projectID,sessionID,fallbackSessionID,list,deliver,getEntries,isIdle,now,onError}) -> {poll()}`; `setupExtension(pi, dependencies?)` registers lifecycle handlers/flags/status command; `connectRemindi({url,token}) -> {list,close}`.

- [x] Write behavior tests and minimal importable no-op boundaries. Execute tests and observe missing delivery/config behavior (not missing imports).
- [x] Implement polling, strict routing, dedupe from custom-message details, and safe MCP decoding; run tests.
- [x] Test lifecycle/configuration/reconnection/shutdown and implement native extension hooks; run the package suite.
- [x] Run syntax checks, existing OpenCode suite, and real Pi loader/runtime smoke without a paid model call. Test authenticated Remindi listing; distinguish it from live timed delivery.
- [x] Fresh independent review; assess findings; fix valid defects with regression tests.
- [x] Document installation, routing, no-idle-wakeup semantics, limits and evidence; inspect full delta.

Delivery: stage only the above task artifacts, commit conventionally and push `feat/pi-remindi-extension` without merging main. Git/Forgejo and the scope guard closeout record carry the resulting publication evidence; this plan is not a second tracker.

## Progress
- Intake: clean main at c2be050. Repository is a Rust/Axum/SQLite MCP service; optional client bridges do not require server modifications.
- Skills discovery: `npx skills find pi-extension`, then `npx skills use romiluz13/pi-agent-skills@pi-extension-authoring` (temporary activation, no persistent skill installation). Ground implementation in current official docs, not its legacy package names.
- RED: 13 initial tests failed against importable no-op boundaries (`/tmp/remindi-pi-red.log`); GREEN implementation passed. Fresh reviewer found two concrete defects: void sendMessage was mistaken for a receipt; malformed reminder fields were accepted. Both reproduced as assertion failures (`/tmp/remindi-pi-review-red.log`) before correction.
- GREEN: `npm --prefix integrations/pi test` 15/15 passed; `npm --prefix integrations/pi run check` passed. `npm --prefix integrations/opencode test` 15/15 and syntax check passed. OpenCode npm ci reported 34 existing dependency vulnerabilities (32 moderate, 2 high); no dependency changes were made to that integration. New Pi package install reported zero vulnerabilities.
- Real Pi 1.5.0 SDK: `PI_SDK_MODULE=/home/mp/.pi/agent/install/releases/1.5.0/node_modules/@earendil-works/pi-coding-agent/dist/index.js node integrations/pi/scripts/smoke.mjs` passed real file loading, idle custom-message persistence, runtime reload receipt restoration and cleanup; zero model turns. Live extension MCP client authenticated and listed against `https://mcp.phrk.org/remindi` (no credential values recorded).
- Full `cargo test --locked` stopped at `docker::supported_compose_boundary_is_valid_and_hardened`: Docker Compose missing. Rerun with `-- --skip docker::supported_compose_boundary_is_valid_and_hardened`: 177 tests passed, one Docker prerequisite filtered, existing million-item `spec_23_8_reference_performance` benchmark remained ignored. No server code changed.
- Independent targeted re-review `075a887b-3f13-4246-9a9d-c5e18caf51d9`: no issues found, merge verdict OK; source review only, parent supplied execution evidence. Initial review `1a8d618d-618a-4a07-af52-e134b652dc83`: both P1 findings accepted and fixed. Remaining documented limits: non-atomic delivery, multiple-instance competition, active-run delivery not runtime-smoke-verified.
- Scope checkpoint at 2026-11-04T05:55:57Z: outcome unchanged; current action targeted review fixes/verification; drift none; stopped unrelated Docker and dependency remediation; next smallest step final artifact inspection and branch delivery. Guard acknowledged version 4, next fire 2026-11-04T06:05:38.754Z. No separate durable memory fact needed: new knowledge is documented here and in the integration README.
- Remaining environment/publication obligations: Beads unavailable (`bd` absent; recovery: restore existing CLI/workspace, never reinitialize). XWiki search found no canonical Remindi page and no established project space; publication location is unresolved, with this plan and README retained as local documentation. Resolve canonical location before publishing; do not replace unrelated policy pages. No live deployment or global Pi configuration changes were requested/performed.
