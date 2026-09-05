#!/usr/bin/env bash
set -euo pipefail
# The Docker acceptance test runs real `docker compose config`; no daemon is needed.
# Official sources: download.docker.com/linux/static/stable/ and
# https://docs.docker.com/compose/install/linux/ (manual CLI-plugin installation).
case "$(uname -m)" in
  x86_64|aarch64) architecture=$(uname -m) ;;
  *) echo 'Unsupported Docker CLI verification architecture' >&2; exit 1 ;;
esac
stage=$(mktemp -d /tmp/forgejo-compose.XXXXXX)
if ! command -v docker >/dev/null 2>&1; then
  curl --fail --silent --show-error --location \
    "https://download.docker.com/linux/static/stable/${architecture}/docker-29.8.0.tgz" \
    -o "$stage/docker.tgz"
  tar -xzf "$stage/docker.tgz" -C "$stage" docker/docker
  install -m 0755 "$stage/docker/docker" /usr/local/bin/docker
fi
if ! docker compose version >/dev/null 2>&1; then
  plugin=/usr/local/lib/docker/cli-plugins/docker-compose
  if [[ -e "$plugin" ]]; then
    echo 'Existing Compose plugin cannot execute; preserve it for diagnosis' >&2
    exit 1
  fi
  asset="docker-compose-linux-${architecture}"
  url="https://github.com/docker/compose/releases/download/v5.5.0"
  curl --fail --silent --show-error --location "$url/$asset" -o "$stage/$asset"
  curl --fail --silent --show-error --location "$url/$asset.sha256" -o "$stage/$asset.sha256"
  (cd "$stage" && sha256sum -c "$asset.sha256")
  install -d /usr/local/lib/docker/cli-plugins
  install -m 0755 "$stage/$asset" "$plugin"
fi
docker --version
docker compose version
printf 'Compose installation downloads retained at %s\n' "$stage"
