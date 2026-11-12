# Native protocol integration

The client modules build instructions and read portfolio identities for the exact upstream revisions in `product/source-lock.json`. They have no signer, private-key store, broadcasting function or deployed market configuration. The separate [SBF lifecycle fixture](svm/README.md) signs with local test keys inside LiteSVM only.

## Check the contract

```sh
npm ci --prefix protocol --ignore-scripts --no-audit --no-fund
cargo run --locked --manifest-path protocol/conformance/Cargo.toml --bin export-contract > /tmp/tradoor-contract.json
cmp /tmp/tradoor-contract.json protocol/upstream-contract.json
npm test --prefix protocol
```

The Rust exporter uses the upstream encoder/decoder and initializer. Regenerate the fixture deliberately when changing a source pin, and review every instruction/layout difference. Never update the JSON alone to make a failing test pass.

## Build an instruction

```js
import { buildInstruction, parseUnits } from './src/instructions.mjs';

const ix = buildInstruction(programId, 'deposit', {
  portfolioId: verifiedPortfolio.portfolioId,
  expectedSequence: verifiedPortfolio.expectedSequence,
  amount: parseUnits('10.25', 6),
}, { owner, market, portfolio, userToken, vault });
```

Addresses and bindings must come from verified chain state. Portfolio initialization expects an already allocated, rent-exempt program-owned account; this package does not allocate it. Deposit/withdraw token accounts must already exist with the correct mint and authority. The on-chain program checks these constraints, but a full transaction planner must validate and present them before requesting a wallet signature.

`tradeNoCpi` requires both counterparties to sign. `tradeCpi` requires a funded maker portfolio with matching on-chain matcher authorization. Neither builder creates liquidity or quotes. The first integration accepts no arbitrary matcher tail accounts and exposes only crank encoding, not a keeper/account planner. The raw encoder is not a complete safe-to-sign transaction API: fresh state, wallet-session binding, transaction review, simulation, dispatch and confirmation/reconciliation are still required.

## Inspect a portfolio without sending anything

```sh
node protocol/inspect.mjs <https-rpc-url> <expected-genesis-hash> <program-id> <market-address> <portfolio-address>
```

The reader deliberately rejects legacy/differently sized accounts. A decoded portfolio is not a solvency certificate. Capital and PnL remain raw engine units and cannot be presented as freely withdrawable funds. Executable-program and ownership checks do not prove deployed bytecode matches the source pin; binary verification belongs in the deployment/release process.
