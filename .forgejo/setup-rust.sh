#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends build-essential pkg-config libssl-dev clang cmake git curl ca-certificates python3 mingw-w64
export CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"
export RUSTUP_HOME="${RUSTUP_HOME:-$HOME/.rustup}"
export PATH="$CARGO_HOME/bin:$PATH"
if ! command -v rustup >/dev/null 2>&1; then
  curl --fail --silent --show-error --location https://sh.rustup.rs -o /tmp/forgejo-rustup-init.sh
  sh /tmp/forgejo-rustup-init.sh -y --profile minimal --default-toolchain 1.97.1
fi
rustup toolchain install 1.97.1 --profile minimal --component rustfmt --component clippy
bash .forgejo/setup-compose.sh
