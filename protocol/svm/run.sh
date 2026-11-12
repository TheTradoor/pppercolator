#!/usr/bin/env bash
set -euo pipefail
native_root="$(cd "$(dirname "$0")/../.." && pwd)"
upstream_checkout="${1:?Pass the exact percolator-prog checkout directory}"
upstream_checkout="$(cd "$upstream_checkout" && pwd)"
expected_commit=b42fe017c2bc953778f90d0cb85cd1d426b6e783
test_path="$upstream_checkout/tests/tradoor_native_lifecycle.rs"
test "$(git -C "$upstream_checkout" rev-parse HEAD)" = "$expected_commit"
git -C "$upstream_checkout" diff --quiet HEAD
test ! -e "$test_path"
test -z "${CARGO_TARGET_DIR:-}"
test -z "${PERCOLATOR_FUZZ_SBF:-}"
test -z "${SBF_OUT_PATH:-}"
case "$(cargo build-sbf --version)" in
  "cargo-build-sbf 4.6.0"*) ;;
  *) echo 'Use cargo-build-sbf 4.6.0 for this local fixture' >&2; exit 1 ;;
esac
case "$(rustc +1.95.0 --version)" in
  "rustc 1.95.0 "*) ;;
  *) echo 'Install Rust 1.95.0 for the legacy SVM host fixture' >&2; exit 1 ;;
esac
# LiteSVM 0.1 in this upstream revision uses the legacy v0 fixture target.
# These builds are local execution evidence, not a current-cluster release gate.
(cd "$upstream_checkout" && cargo build-sbf --tools-version v1.52 --arch v0 -- --locked)
(cd "$upstream_checkout/tests/fixtures/auth_matcher" && cargo build-sbf --tools-version v1.52 --arch v0 -- --locked)
test -f "$upstream_checkout/target/deploy/percolator_prog.so"
test -f "$upstream_checkout/tests/fixtures/auth_matcher/target/deploy/auth_matcher.so"
cp "$native_root/protocol/svm/lifecycle.rs" "$test_path"
trap 'rm -f "$test_path"' EXIT
export TRADOOR_NATIVE_DRIVER="$native_root/protocol/svm/driver.mjs"
cargo +1.95.0 test --locked --manifest-path "$upstream_checkout/Cargo.toml" --test tradoor_native_lifecycle -- --nocapture
