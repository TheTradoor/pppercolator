import { PublicKey } from '@solana/web3.js';
import contract from '../upstream-contract.json' with {type:'json'};
import { ENGINE_COMMIT, WRAPPER_COMMIT } from './instructions.mjs';

if(contract.engineCommit!==ENGINE_COMMIT || contract.wrapperCommit!==WRAPPER_COMMIT) throw new Error('Generated contract does not match pinned source');
const c = contract.constants;
const pk = v => new PublicKey(v).toBase58();
const keyAt = (b,off) => new PublicKey(b.subarray(off,off+32)).toBase58();
function u128(b,off) { return b.readBigUInt64LE(off) | (b.readBigUInt64LE(off+8)<<64n); }

// This is a strict reader for this release's account shape, not a migration
// parser or a substitute for the engine's account/invariant validation.
export function readPortfolio(account,{programId,address,market,owner}) {
  if(!account || account.executable || pk(account.owner)!==pk(programId)) throw new Error('Portfolio is not owned by the expected program');
  const b=Buffer.from(account.data);
  if(b.length!==c.portfolioLength) throw new Error('Unsupported portfolio layout; refresh the source pin and regenerate the contract');
  if(b.readBigUInt64LE(0)!==BigInt('0x'+c.magic) || b.readUInt16LE(8)!==c.version || b[10]!==c.portfolioKind) throw new Error('Invalid portfolio header');
  const actualMarket=keyAt(b,c.portfolioMarketOffset), actualAddress=keyAt(b,c.portfolioAddressOffset), actualOwner=keyAt(b,c.portfolioOwnerOffset);
  if(actualMarket!==pk(market) || actualAddress!==pk(address) || actualOwner!==keyAt(b,c.portfolioProvenanceOwnerOffset) || (owner && actualOwner!==pk(owner))) throw new Error('Portfolio identity does not match the requested account');
  const portfolioId=b.readBigUInt64LE(c.portfolioIdOffset);
  if(portfolioId===0n) throw new Error('Uninitialized portfolio identity');
  const control=b.readBigUInt64LE(c.portfolioControlOffset), matcherFeeCap=control>>50n;
  if(matcherFeeCap>10000n) throw new Error('Invalid matcher fee cap');
  const pnl=u128(b,c.portfolioPnlOffset);
  return Object.freeze({address:actualAddress,market:actualMarket,owner:actualOwner,portfolioId,expectedSequence:b.readBigUInt64LE(c.portfolioSequenceOffset),positionEpoch:(control>>1n)&BigInt(c.positionEpochMax),capital:u128(b,c.portfolioCapitalOffset),pnl:pnl>=(1n<<127n)?pnl-(1n<<128n):pnl,matcherEnabled:(control&1n)===1n,matcherFeeCapBps:Number(matcherFeeCap)});
}
