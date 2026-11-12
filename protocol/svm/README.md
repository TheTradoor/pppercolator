# Native SBF lifecycle verification

This fixture executes the JavaScript adapter's actual account metas and instruction bytes in LiteSVM against a source-pinned Percolator SBF build and real SPL Token program code. The Rust test invokes `driver.mjs` for instruction construction and portfolio reads; it does not substitute Rust encoders for the client under test.

The upstream fixture creates a local market, mints test collateral and funds counterparties. Our test initializes a new portfolio through the JavaScript builder, deposits 25 local test USDC, opens and closes a bilateral 0.1 SOL position at a fixed $150 fixture price, then withdraws all 25 USDC. It verifies vault/user balances and token conservation. An excessive withdrawal and a different owner's signed deposit must fail with unchanged market, portfolio and SPL account bytes. Transaction fees in SOL are excluded from rollback assertions.

## Run

Use Node.js 22+, host Rust 1.95.0 (`rustup toolchain install 1.95.0 --profile minimal`), and `cargo-build-sbf` 4.6.0. Install the protocol dependencies with `npm ci --prefix protocol --ignore-scripts --no-audit --no-fund`. The separate host conformance exporter uses Rust 1.100.0; the upstream Solana 1.18 test dependency fails to compile with that compiler's newer type inference, so the SVM runner selects 1.95.0 explicitly.

Clone `https://github.com/aeyakovenko/percolator-prog`, check out exactly `b42fe017c2bc953778f90d0cb85cd1d426b6e783`, then run from this repository:

```sh
bash protocol/svm/run.sh /absolute/path/to/percolator-prog
```

The runner checks the source revision and tracked-file cleanliness, builds the wrapper and the upstream authenticated-matcher fixture, temporarily adds our integration test to the checkout, runs it with the upstream locked dependencies, and removes only that temporary test file on exit. It refuses an existing test file or alternate artifact-path overrides. It needs no wallet, RPC credentials, public deployment or real assets.

## Scope

- The compiler target is explicitly **SBPF v0 with platform-tools v1.52**, matching the legacy LiteSVM 0.1 fixture in the pinned wrapper. `cargo-build-sbf` 4.6.0 defaults to v3, which is incompatible with platform-tools v1.52; do not omit `--arch v0` for this fixture.
- This is not a production binary approval. Current-cluster SBPF compatibility and the final deployment toolchain remain separate release work.
- The fixture uses a fixed price, zero funding and a zero-fee bilateral round trip. It does not validate live oracle delivery, adverse price moves, liquidation, nonzero fees/funding, matcher execution, keeper availability or a signing-wallet UI.
- Fresh portfolio rent/storage and local token balances are provided by the fixture. Production account creation, funded liquidity, operational services and independent review are not supplied by this test.
- The `native-protocol` workflow verifies host conformance and JavaScript regressions. The separate `native-svm` workflow builds the SBF fixtures and runs this test; a green host workflow alone must not be described as SBF coverage.

## Recorded local result

Passed on 2026-11-12 with the toolchain above. Compute units were 27,874 for initialization, 38,098 for deposit, 126,785 for open, 123,193 for close, and 38,986 for withdrawal. These are measurements of this small fixture, not worst-case production limits.

The wrapper SBF SHA-256 was `d2a05d0e9f578384e740db289f8539688cd0b36ab3ae848558fa24ab258257a4`; the authenticated-matcher fixture SHA-256 was `50e532267926e180f013200c1799e26127dd23dc150866cffd491424629ddf93`. These identify the locally tested bytes; they do not assert reproducibility across different build paths/environments or identify a public deployment.
