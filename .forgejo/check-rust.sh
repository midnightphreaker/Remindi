#!/usr/bin/env bash
set -euo pipefail
export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}"
cargo +1.97.1 fmt --all -- --check
cargo +1.97.1 clippy --locked --all-targets --all-features -- -D warnings
cargo +1.97.1 test --locked --all-targets --all-features -- --test-threads=1
