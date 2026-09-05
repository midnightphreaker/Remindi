#!/usr/bin/env bash
set -euo pipefail
export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}"
cargo +1.97.1 build --release --locked --all-features --bin remindi
python3 .forgejo/package.py binary linux amd64 target/release/remindi
