#!/usr/bin/env bash
set -euo pipefail
: "${RELEASE_IMAGE:?RELEASE_IMAGE must identify the just-built image}"
# Fixture containers have no external network and never use deployed credentials.
name="release-smoke-remindi-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-$$"
evidence="${RELEASE_DIR:-.release-dist}/smoke-${name}"
mkdir -p "$(dirname "$evidence")"
container=''
finish() {
  status=$?
  trap - EXIT
  if [[ -n "$container" ]]; then
    # Keep the exact test container stopped for inspection; never prune shared state.
    podman inspect --format '{{json .State}}' "$container" > "${evidence}.json" || true
    podman stop --time 10 "$container" >/dev/null || true
    printf 'Smoke container retained: %s (%s), evidence: %s.json
' "$name" "$container" "$evidence"
  fi
  exit "$status"
}
trap finish EXIT
container=$(podman run --detach --network none --name "$name" -e REMINDI_OWNER_ID=release-smoke-fixture -e REMINDI_MCP_TOKEN=release-smoke-fixture-not-a-secret -e REMINDI_WEBUI_USERNAME=release-smoke-fixture -e REMINDI_WEBUI_PASSWORD=release-smoke-fixture-not-a-secret "$RELEASE_IMAGE")
for attempt in $(seq 1 30); do
  if [[ "$(podman inspect --format '{{.State.Running}}' "$container")" != true ]]; then
    echo 'Application exited before its health endpoint was ready' >&2
    exit 1
  fi
  # Debian runtime images contain bash/coreutils. Probe real HTTP rather than
  # trusting a HEALTHCHECK command that may only print a fixed success string.
  if podman exec "$container" timeout 5 bash -c '
      exec 3<>/dev/tcp/127.0.0.1/$1
      printf "GET %s HTTP/1.0\r\nHost: localhost\r\n\r\n" "$2" >&3
      IFS= read -r response <&3
      [[ "$response" == *" 200 "* ]]
    ' bash 8000 /health/live 2>/dev/null; then
    printf 'HTTP health verified: remindi /health/live (%s)
' "$container"
    exit 0
  fi
  sleep 2
done
echo 'Application health endpoint did not succeed within the bounded startup checks' >&2
exit 1
