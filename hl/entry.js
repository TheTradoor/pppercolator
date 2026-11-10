// Real trading on Hyperliquid, from the user's own wallet. This site never holds funds or keys:
// the user's wallet approves a trading-only agent key that lives in this browser's storage and
// cannot withdraw. Orders go straight from the browser to Hyperliquid's API.
import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { formatPrice, formatSize, SymbolConverter } from "@nktkas/hyperliquid/utils";
import { createWalletClient, custom } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";

const transport = new HttpTransport();
const info = new InfoClient({ transport });
const KEY = "ppp.hl.agent.";
let user = null, master = null, agent = null, converter = null;

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
};

function provider() {
  const p = window.phantom?.ethereum || window.ethereum;
  if (!p) throw new Error("No Ethereum wallet found. Install Phantom, Rabby or MetaMask.");
  return p;
}

async function connect() {
  const p = provider();
  const [account] = await p.request({ method: "eth_requestAccounts" });
  user = account.toLowerCase();
  master = new ExchangeClient({ transport, wallet: createWalletClient({ account, chain: arbitrum, transport: custom(p) }) });
  const saved = store.get(KEY + user);
  agent = null;
  if (saved) {
    try { agent = new ExchangeClient({ transport, wallet: privateKeyToAccount(saved) }); } catch { store.del(KEY + user); }
  }
  if (!converter) converter = await SymbolConverter.create({ transport });
  return { user, hasAgent: !!agent };
}

// One wallet popup. Creates a trading-only key for this browser.
async function enableTrading() {
  if (!master) throw new Error("Connect a wallet first.");
  const pk = generatePrivateKey();
  const signer = privateKeyToAccount(pk);
  await master.approveAgent({ agentAddress: signer.address, agentName: "pppercolator" });
  store.set(KEY + user, pk);
  agent = new ExchangeClient({ transport, wallet: signer });
  return true;
}

function disableTrading() { if (user) store.del(KEY + user); agent = null; }

async function maxBuilderFee(builder) {
  if (!user || !builder) return 0;
  return await info.maxBuilderFee({ user, builder: builder.toLowerCase() });
}

// One wallet popup. `rate` like "0.03%".
async function approveBuilder(builder, rate) {
  if (!master) throw new Error("Connect a wallet first.");
  await master.approveBuilderFee({ builder: builder.toLowerCase(), maxFeeRate: rate });
  return true;
}

async function account() {
  if (!user) throw new Error("Connect a wallet first.");
  const s = await info.clearinghouseState({ user });
  return {
    accountValue: s.marginSummary.accountValue,
    withdrawable: s.withdrawable,
    marginUsed: s.marginSummary.totalMarginUsed,
    positions: s.assetPositions.map((x) => x.position).map((p) => ({
      coin: p.coin, szi: p.szi, entryPx: p.entryPx, unrealizedPnl: p.unrealizedPnl,
      liquidationPx: p.liquidationPx, leverage: p.leverage?.value, positionValue: p.positionValue,
    })),
  };
}

// Market-style order: immediate-or-cancel limit with a price buffer. `builder` is optional:
// { b: "0x...", f: tenthsOfBasisPoint }.
async function marketOrder({ coin, isBuy, size, leverage, reduceOnly = false, slippage = 0.01, builder = null }) {
  if (!agent) throw new Error("Enable trading first.");
  const a = converter.getAssetId(coin);
  const dec = converter.getSzDecimals(coin);
  if (a === undefined || dec === undefined) throw new Error("Unknown market " + coin);
  const mids = await info.allMids();
  const mid = parseFloat(mids[coin]);
  if (!(mid > 0)) throw new Error("No price for " + coin);
  if (leverage && !reduceOnly) await agent.updateLeverage({ asset: a, isCross: true, leverage: Math.round(leverage) });
  const order = {
    a, b: isBuy,
    p: formatPrice(mid * (1 + (isBuy ? slippage : -slippage)), dec),
    s: formatSize(size, dec),
    r: reduceOnly,
    t: { limit: { tif: "Ioc" } },
  };
  const req = { orders: [order], grouping: "na" };
  if (builder && builder.b && builder.f > 0) req.builder = { b: builder.b.toLowerCase(), f: builder.f };
  const res = await agent.order(req);
  const st = res?.response?.data?.statuses?.[0];
  if (st?.error) throw new Error(st.error);
  return st?.filled ? { filled: true, avgPx: st.filled.avgPx, totalSz: st.filled.totalSz } : { filled: false, status: st };
}

async function closePosition(coin, builder = null) {
  const acc = await account();
  const p = acc.positions.find((x) => x.coin === coin);
  if (!p || !parseFloat(p.szi)) throw new Error("No open " + coin + " position.");
  const szi = parseFloat(p.szi);
  return marketOrder({ coin, isBuy: szi < 0, size: Math.abs(szi), reduceOnly: true, builder });
}

window.PPPHL = { connect, enableTrading, disableTrading, maxBuilderFee, approveBuilder, account, marketOrder, closePosition, user: () => user, hasAgent: () => !!agent };
