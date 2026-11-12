# Tradoor Perps

A native Solana perpetuals product in development, continuing the Pppercolator fork with Anatoly Yakovenko's Percolator risk engine. **Working name; no native market is deployed and this branch is not a production release.**

The intended first market is SOL with USDC collateral. Risk parameters, liquidity, oracle/keeper operations, independent review and deployment remain release work. The [product specification and delivery milestones](product/README.md) distinguish implemented code from those outstanding requirements.

## Native integration

[protocol/](protocol/README.md) contains source-pinned instruction builders, an account-identity reader, a read-only RPC inspector and Rust-to-JavaScript conformance tests. It compiles the unmodified upstream Solana wrapper and engine to generate the actual wire contract; it does not replace their risk calculations.

```sh
npm ci --prefix protocol --ignore-scripts --no-audit --no-fund
cargo run --locked --manifest-path protocol/conformance/Cargo.toml --bin export-contract > /tmp/tradoor-contract.json
cmp /tmp/tradoor-contract.json protocol/upstream-contract.json
npm test --prefix protocol
```

Exact revisions and deployment status are recorded in [product/source-lock.json](product/source-lock.json). The compiled host contract is not an SBF deployment artifact or a proof of mainnet safety.

## Inherited code

The original terminal, Hyperliquid adapter, paper simulator and launchpad are retained with the wallet/quote/submission and native-thread fixes. Their original description is preserved in [product/UPSTREAM.md](product/UPSTREAM.md). The inherited Hyperliquid real mode and browser paper balances are not the native product's execution path.

The inherited simulator engine remains at its original revision. The new native wrapper uses its own explicitly pinned compatible engine revision. No upstream engine source was edited.

## Attribution

Independent continuation of [bubblesonchain/pppercolator](https://github.com/bubblesonchain/pppercolator), using [aeyakovenko/percolator](https://github.com/aeyakovenko/percolator) and [aeyakovenko/percolator-prog](https://github.com/aeyakovenko/percolator-prog). Not affiliated with or endorsed by those authors. Preserve [LICENSE](LICENSE) and [NOTICE](NOTICE). Upstream describes the engine and program as experimental, unaudited and not production ready.
