import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import contract from '../upstream-contract.json' with {type:'json'};
import { encodeInstruction, buildInstruction, vaultAuthority, matcherDelegate, parseUnits, TOKEN_PROGRAM_ID } from '../src/instructions.mjs';
import { readPortfolio } from '../src/accounts.mjs';
import { readFileSync } from 'node:fs';

test('client fixtures, product manifest and Cargo use one native source pin',()=>{
  const lock=JSON.parse(readFileSync(new URL('../../product/source-lock.json',import.meta.url),'utf8'));
  const cargo=readFileSync(new URL('../conformance/Cargo.toml',import.meta.url),'utf8');
  assert.equal(contract.engineCommit,lock.origins.nativeEngine.commit);
  assert.equal(contract.wrapperCommit,lock.origins.nativeProgram.commit);
  assert(cargo.includes(`rev = "${contract.engineCommit}"`));
  assert(cargo.includes(`rev = "${contract.wrapperCommit}"`));
});

for(const f of contract.fixtures) test(`${f.name} matches the pinned Rust encoder`,()=>{
  assert.equal(encodeInstruction(f.name,f.args).toString('hex'),f.hex);
});
const sample=name=>structuredClone(contract.fixtures.find(f=>f.name===name).args);
for(const value of [1,1.1,Number.MAX_SAFE_INTEGER,'1e6','+1','01','1.0','-1','18446744073709551616','9'.repeat(10000),undefined]) test(`deposit rejects malformed/overflow amount ${String(value).slice(0,30)}`,()=>{
  assert.throws(()=>encodeInstruction('deposit',{...sample('deposit'),amount:value}));
});
for(const [name,patch] of [['deposit',{portfolioId:'0'}],['deposit',{amount:'0'}],['withdraw',{expectedSequence:'-1'}],['tradeCpi',{limitPrice:'0'}],['tradeCpi',{sizeQ:'0'}],['tradeCpi',{marketId:'0'}],['tradeCpi',{feeBps:'10001'}],['tradeCpi',{backingFeeCapBps:10001}],['tradeCpi',{assetIndex:65536}],['tradeCpi',{makerPositionEpoch:(1n<<49n).toString()}],['tradeCpi',{sizeQ:(1n<<127n).toString()}]]) test(`${name} rejects ${JSON.stringify(patch)}`,()=>{
  assert.throws(()=>encodeInstruction(name,{...sample(name),...patch}));
});
test('a stale CLI deposit cannot be mistaken for the new format',()=>{
  assert.equal(encodeInstruction('deposit',sample('deposit')).length,33);
  const old=Buffer.alloc(17);old[0]=3;old.writeBigUInt64LE(1000000n,1);
  assert.notDeepEqual(encodeInstruction('deposit',sample('deposit')),old);
});
test('crank rejects duplicate observations and excess legs',()=>{
  assert.throws(()=>encodeInstruction('permissionlessCrank',{nowSlot:'1',observations:[{assetIndex:0,oracleAccounts:1},{assetIndex:0,oracleAccounts:1}]}));
  assert.throws(()=>encodeInstruction('permissionlessCrank',{nowSlot:'1',observations:Array.from({length:17},(_,i)=>({assetIndex:i,oracleAccounts:1}))}));
});
test('decimal amounts retain precision above the floating-point safe integer boundary',()=>{
  assert.equal(parseUnits('9007199254.740993'),9007199254740993n);
  assert.equal(parseUnits('0.000001'),1n);
  assert.equal(parseUnits('18446744073709.551615'),(1n<<64n)-1n);
});
for(const value of ['0','-1','1e3','1.0000001','18446744073709.551616',' 1','1,000','.5','1.']) test(`strict decimal input rejects ${value}`,()=>assert.throws(()=>parseUnits(value)));
const pub=n=>new PublicKey(Buffer.alloc(32,n));
const program=pub(9), a={owner:pub(3),market:pub(1),portfolio:pub(2),userToken:pub(4),vault:pub(5),takerOwner:pub(3),makerOwner:pub(6),takerPortfolio:pub(2),makerPortfolio:pub(7),matcherProgram:pub(8),matcherContext:pub(10)};
test('withdraw derives the vault signer and never asks the user to sign for it',()=>{
  const ix=buildInstruction(program,'withdraw',sample('withdraw'),a);
  assert.equal(ix.keys.length,7);assert(ix.keys[5].pubkey.equals(vaultAuthority(program,a.market)));assert.equal(ix.keys[5].isSigner,false);assert(ix.keys[6].pubkey.equals(TOKEN_PROGRAM_ID));
  assert.deepEqual(ix.keys.map(x=>x.isSigner),[true,false,false,false,false,false,false]);
});
test('bilateral trade requires both owners, while CPI derives the LP delegate',()=>{
  const direct=buildInstruction(program,'tradeNoCpi',sample('tradeNoCpi'),a);
  assert.deepEqual(direct.keys.map(x=>x.isSigner),[true,true,false,false,false]);
  const cpi=buildInstruction(program,'tradeCpi',sample('tradeCpi'),a);
  assert.deepEqual(cpi.keys.map(x=>x.isSigner),[true,false,false,false,false,false,false]);assert(cpi.keys[6].pubkey.equals(matcherDelegate(program,a)));
  assert.equal(cpi.keys[5].isWritable,true);
});
test('reject aliased custody and self-counterparty accounts',()=>{
  assert.throws(()=>buildInstruction(program,'deposit',sample('deposit'),{...a,userToken:a.vault}));
  assert.throws(()=>buildInstruction(program,'tradeCpi',sample('tradeCpi'),{...a,makerPortfolio:a.takerPortfolio}));
  assert.throws(()=>buildInstruction(program,'tradeCpi',sample('tradeCpi'),{...a,matcherProgram:program}));
});
const account=()=>({owner:program,executable:false,data:Buffer.from(contract.portfolioFixtureHex,'hex')});
const expected={programId:program,address:pub(2),market:pub(1),owner:pub(3)};
test('read a portfolio initialized by the actual upstream Rust initializer',()=>{
  const p=readPortfolio(account(),expected);assert.equal(p.portfolioId,17n);assert.equal(p.expectedSequence,0n);assert.equal(p.positionEpoch,0n);assert.equal(p.capital,0n);assert.equal(p.owner,pub(3).toBase58());
});
for(const kind of ['owner','length','magic','version','kind','portfolio','market','wallet','zero-id','duplicate-owner']) test(`portfolio rejects ${kind} mismatch`,()=>{
  const acc=account(), exp={...expected}, c=contract.constants;
  if(kind==='owner') acc.owner=pub(11);
  if(kind==='length') acc.data=acc.data.subarray(0,-8);
  if(kind==='magic') acc.data[0]^=1;
  if(kind==='version') acc.data[8]^=1;
  if(kind==='kind') acc.data[10]=c.marketKind;
  if(kind==='portfolio') exp.address=pub(11);
  if(kind==='market') exp.market=pub(11);
  if(kind==='wallet') exp.owner=pub(11);
  if(kind==='zero-id') acc.data.writeBigUInt64LE(0n,c.portfolioIdOffset);
  if(kind==='duplicate-owner') acc.data[c.portfolioProvenanceOwnerOffset]^=1;
  assert.throws(()=>readPortfolio(acc,exp));
});
test('signed PnL decoding handles a negative 128-bit amount',()=>{
  const acc=account(),off=contract.constants.portfolioPnlOffset;
  acc.data.fill(255,off,off+16);assert.equal(readPortfolio(acc,expected).pnl,-1n);
});
