# Tradoor Perps: native Percolator product

Working name, not a launch announcement. The goal is a usable Solana perpetuals venue whose risk and settlement use Anatoly Yakovenko's Percolator engine. This branch is the beginning of that integration; it is not accepting deposits and no native market has been deployed.

## What carries over from Pppercolator

The fork preserves source history, Apache-2.0 notices, terminal work, and both contributed fix sets. The inherited browser simulator and Hyperliquid client remain useful references. They do not constitute the new native execution path: Pppercolator's real orders execute on Hyperliquid, while its embedded Percolator engine manages paper balances.

The original paper engine stays byte-for-byte at `37cb14e`. The new native path uses the exact engine revision required by the pinned Solana wrapper, `b22bef7`, through Cargo dependencies. Mixing a current wrapper with the older paper engine or an old account parser is not supported.

## Initial product scope

Start with a single SOL perpetual market, USD pricing and USDC collateral. A user should connect a Solana wallet, inspect the market and fees, create a portfolio, deposit collateral, obtain a bounded executable quote, open/reduce/close a position, and withdraw available collateral. Transaction history must link to actual signatures and distinguish pending, landed, failed and unknown outcomes. Liquidations and funding must run on the engine's accounting rules.

There is no funded house account or synthetic fill in this route. A real, funded counterparty must accept each fill. A passive matcher is only a candidate until its risk, quote expiry, inventory limits and adverse-flow behavior are evaluated. Spread is not a substitute for liquidity capital or solvency testing. Leverage, margin, OI and position limits are deliberately not selected before that analysis.

The execution path is:

1. The terminal reads authenticated market/portfolio data and presents a fresh quote with fee and price limits.
2. The wallet signs a locally constructed instruction tied to portfolio incarnation, position epoch, market generation and relevant sequence values.
3. The Solana wrapper authenticates accounts/signers, moves SPL collateral and calls the pinned risk engine; SVM rollback makes failed instructions atomic.
4. A funded LP supplies bilateral fills or authorizes a reviewed matcher. Keeper services provide authenticated oracle observations and advance engine accounting/recovery.
5. An indexer reconciles confirmed/finalized chain state into positions and history. RPC or indexer failure must not manufacture a successful trade.

## Implemented in this branch

- Pinned engine, wrapper and source provenance in `source-lock.json`.
- Rust exporter compiled against the unmodified upstream program. Fixtures come from `Instruction::encode`, with decoder round-trip and trailing-byte checks. Layout offsets come from Rust types, and the sample portfolio is initialized by the upstream initializer.
- JavaScript encoders for portfolio initialization, deposits, withdrawals, bilateral trades, matcher trades and permissionless crank observations. Values use exact integers, not floating-point money.
- Solana instruction construction for portfolio initialization, deposits, withdrawals and the two trade routes, including derived vault and matcher addresses. A positive CPI price limit is mandatory in this client.
- Strict portfolio reader with program ownership, header, length, market, address, owner and incarnation checks.
- A read-only RPC inspector that requires an expected cluster genesis hash and reads program/market/portfolio in one contextual RPC snapshot. It explicitly does not claim to verify deployed program bytes.
- Regression tests against the Rust-generated contract, invalid amounts, overflow, stale layouts and mismatched identities.
- A [native SBF lifecycle fixture](../protocol/svm/README.md) that feeds this JavaScript adapter's actual account metas and instruction bytes to LiteSVM: new portfolio, deposit, bilateral open/close, full withdrawal, token conservation, excessive-withdrawal rollback and wrong-owner rejection. The fixed-price, zero-fee fixture and its SBPF v0 target are local verification, not a current-cluster deployment approval.

These pieces prepare and inspect protocol data. They do not yet provide a wallet UI, signed transaction submission, an on-chain deployment, funded liquidity, a keeper, or an indexer. A source pin and passing encoder tests do not establish mainnet safety.

## Why a new adapter is necessary

At CLI commit `7f9004768e5f6cbc4fb8c08fc1e5a8751669d990`, the upstream TypeScript CLI encodes `Deposit` as tag + amount (17 bytes). The pinned program requires tag + portfolio ID + owner sequence + amount (33 bytes). Trade instructions have similarly acquired identity/epoch/fee-cap fields. The Rust exporter checks that a legacy deposit is rejected. Do not use that older CLI to send transactions to this program revision.

## Route to a real release

| Milestone | Deliverable | Exit evidence | Current status |
| --- | --- | --- | --- |
| Native contract integration | Exact engine/program pins, instruction encoding and account identity reads | Rust-to-JavaScript conformance; malformed/legacy inputs reject | Implemented; host-tested |
| Local on-chain execution | Pinned SBF program and matcher-fixture builds; SPL vault/portfolio operations in LiteSVM | Initialize → deposit → bilateral open/close → withdraw; token balances reconcile; two rejection/rollback cases | Verified locally for the documented fixed-price scope; broader economic and matcher cases pending |
| Operational devnet product | Wallet terminal, market creation, bounded quotes, Pyth integration, keeper, indexer and transaction reconciliation | End-to-end wallet flows, restart/outage tests and public transaction traces with test assets | Not deployed |
| Liquidity and economics | Funded LP arrangement, risk limits, funding behavior and liquidation/recovery policies | Inventory/adverse-flow stress, oracle staleness/depeg cases and loss/exit accounting reviewed | Requires capital and operator decisions |
| Release review | Independent engine/wrapper/matcher/integration review; reproducible source-to-binary record; authority and incident policy | Findings resolved and retested; actual admin/upgrade powers documented; monitoring and exit drills | Not completed |
| Limited mainnet release | Verified program/market deployment with explicit caps and funded operations | Small-cap launch, successful withdrawals and monitored operations before increasing limits | Not enabled |

Devnet is a verification step on the way to the product, not the product's final business model. A public mainnet launch needs actual liquidity, operational ownership, independent review and a supported access/jurisdiction policy. Those cannot be supplied by copying a repository or by this branch's tests.

## Immediate next implementation

Extend the native fixture to nonzero fees/funding, adverse prices, liquidations and authorized matcher execution. Verify the current-cluster SBPF target separately from the legacy local VM target. Implement the complete market reader, bounded quote/transaction planner, oracle/keeper services and wallet terminal against the same pinned layout. The inherited Hyperliquid real-mode button must not be relabeled as native Percolator trading.

## Ownership and provenance

This is an independent continuation, not an endorsement by Anatoly Yakovenko or bubblesonchain. Preserve `LICENSE` and `NOTICE` and track intentional wrapper changes separately from engine changes. No deployment address or audit status is implied by the working name. The upstream engine, Solana wrapper and matcher each describe themselves as experimental and unaudited.
