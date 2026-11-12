#!/usr/bin/env node
import { Connection, PublicKey } from '@solana/web3.js';
import { readPortfolio } from './src/accounts.mjs';
import { ENGINE_COMMIT, WRAPPER_COMMIT } from './src/instructions.mjs';

const args=process.argv.slice(2);
if(args.length!==5) {
  console.error('Usage: node protocol/inspect.mjs <https-rpc-url> <expected-genesis-hash> <program-id> <market-address> <portfolio-address>');
  process.exitCode=1;
} else {
  try {
    const [rpc,expectedGenesis,program,market,portfolio]=args;
    const url=new URL(rpc);
    if(url.protocol!=='https:' && !(url.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw new Error('Use HTTPS, or a loopback validator');
    const connection=new Connection(rpc,'confirmed');
    if(await connection.getGenesisHash()!==expectedGenesis) throw new Error('RPC cluster does not match the expected genesis hash');
    const ids=[program,market,portfolio].map(x=>new PublicKey(x));
    const snapshot=await connection.getMultipleAccountsInfoAndContext(ids,{commitment:'confirmed'});
    const [programAccount,marketAccount,portfolioAccount]=snapshot.value;
    if(!programAccount?.executable) throw new Error('Configured program is not executable');
    if(!marketAccount || marketAccount.executable || !marketAccount.owner.equals(ids[0])) throw new Error('Market is not owned by the configured program');
    const state=readPortfolio(portfolioAccount,{programId:ids[0],address:ids[2],market:ids[1]});
    console.log(JSON.stringify({slot:snapshot.context.slot,program,engineCommit:ENGINE_COMMIT,wrapperCommit:WRAPPER_COMMIT,sourcePinOnly:true,note:'Account ownership and wire layout checked. Deployed program bytes have NOT been matched to this source pin. Capital/PnL are raw engine units, not a withdrawable-balance quote.',portfolio:state},(_,v)=>typeof v==='bigint'?v.toString():v,2));
  } catch(error) { console.error(error.message); process.exitCode=1; }
}
