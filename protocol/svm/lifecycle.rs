// Copied temporarily into the exact upstream checkout by run.sh. Its fixture
// initializes the market and funded counterparties through the actual SBF.
#[allow(dead_code)]
#[path = "support/v16_svm.rs"]
mod upstream_fixture;

use serde_json::{json, Value};
use solana_sdk::{
    account::Account,
    compute_budget::ComputeBudgetInstruction,
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    rent::Rent,
    signature::{Keypair, Signer},
    transaction::Transaction,
};
use std::{io::Write, process::{Command, Stdio}, str::FromStr};
use upstream_fixture::{MarketConfig, V16Svm};

fn js(input: Value) -> Value {
    let driver = std::env::var("TRADOOR_NATIVE_DRIVER").expect("SVM driver path");
    let mut child = Command::new("node").arg(driver)
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
        .spawn().expect("start native adapter");
    child.stdin.take().unwrap().write_all(input.to_string().as_bytes()).unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success(), "adapter: {}", String::from_utf8_lossy(&output.stderr));
    serde_json::from_slice(&output.stdout).expect("adapter JSON")
}

fn read(env: &V16Svm, address: Pubkey, owner: Pubkey) -> Value {
    let account = env.svm.get_account(&address).unwrap();
    js(json!({"operation":"readPortfolio",
        "account":{"owner":account.owner.to_string(),"executable":account.executable,"data":account.data},
        "expected":{"programId":env.program_id.to_string(),"address":address.to_string(),
            "market":env.market.to_string(),"owner":owner.to_string()}}))
}

fn build(env: &V16Svm, name: &str, args: Value, accounts: Value) -> Instruction {
    let out = js(json!({"operation":"buildInstruction","program":env.program_id.to_string(),
        "name":name,"args":args,"accounts":accounts}));
    Instruction {
        program_id: Pubkey::from_str(out["programId"].as_str().unwrap()).unwrap(),
        accounts: out["keys"].as_array().unwrap().iter().map(|k| AccountMeta {
            pubkey: Pubkey::from_str(k["pubkey"].as_str().unwrap()).unwrap(),
            is_signer: k["isSigner"].as_bool().unwrap(),
            is_writable: k["isWritable"].as_bool().unwrap(),
        }).collect(),
        data: out["data"].as_array().unwrap().iter().map(|n| u8::try_from(n.as_u64().unwrap()).unwrap()).collect(),
    }
}

fn send(env: &mut V16Svm, ix: Instruction, signers: &[&Keypair]) -> Result<u64, String> {
    let tx = Transaction::new_signed_with_payer(&[
        ComputeBudgetInstruction::set_compute_unit_limit(1_400_000),
        ComputeBudgetInstruction::request_heap_frame(256 * 1024), ix,
    ], Some(&signers[0].pubkey()), signers, env.svm.latest_blockhash());
    env.svm.send_transaction(tx).map(|m| m.compute_units_consumed)
        .map_err(|e| format!("{e:?}"))
}

fn custody(env: &V16Svm, portfolio: Pubkey, owner: Pubkey, token: Pubkey) -> Value {
    json!({"owner":owner.to_string(),"market":env.market.to_string(),
        "portfolio":portfolio.to_string(),"userToken":token.to_string(),"vault":env.vault.to_string()})
}

#[test]
fn javascript_adapter_executes_native_spl_lifecycle_and_rejects_invalid_actions() {
    let mut config = MarketConfig::default();
    config.initial_price = 150_000_000; // Fixed SOL/USD fixture; not a live oracle test.
    let mut env = V16Svm::new_with_asset_count([73; 32], config, 1);
    let owner = Keypair::from_bytes(&env.actors[0].signer.to_bytes()).unwrap();
    let maker = Keypair::from_bytes(&env.actors[1].signer.to_bytes()).unwrap();
    let portfolio = Pubkey::new_unique();
    let len = percolator_prog::constants::PORTFOLIO_ACCOUNT_LEN;
    env.svm.set_account(portfolio, Account {
        lamports: Rent::default().minimum_balance(len), data: vec![0; len],
        owner: env.program_id, executable: false, rent_epoch: 0,
    }).unwrap();

    let init = build(&env, "initPortfolio", json!({}), json!({"owner":owner.pubkey().to_string(),
        "market":env.market.to_string(),"portfolio":portfolio.to_string()}));
    let init_cu = send(&mut env, init, &[&owner]).expect("initialize through JS adapter");
    let source = env.actors[0].source_token;
    let destination = env.actors[0].destination_token;
    let source_before = env.token_amount(source);
    let vault_before = env.token_amount(env.vault);
    let supply_before = env.token_supply_observed();
    let amount = 25_000_000u64;

    let p = read(&env, portfolio, owner.pubkey());
    let deposit = build(&env, "deposit", json!({"portfolioId":p["portfolioId"],
        "expectedSequence":p["expectedSequence"],"amount":amount.to_string()}),
        custody(&env, portfolio, owner.pubkey(), source));
    let deposit_cu = send(&mut env, deposit, &[&owner]).expect("deposit through JS adapter");
    assert_eq!(env.token_amount(source), source_before - amount);
    assert_eq!(env.token_amount(env.vault), vault_before + amount);
    assert_eq!(read(&env, portfolio, owner.pubkey())["capital"], amount.to_string());

    // A rejected withdrawal must not alter portfolio, market or SPL balances.
    let before_portfolio = env.svm.get_account(&portfolio).unwrap().data;
    let before_market = env.svm.get_account(&env.market).unwrap().data;
    let before_tokens = env.all_token_account_data();
    let p = read(&env, portfolio, owner.pubkey());
    let excessive = build(&env, "withdraw", json!({"portfolioId":p["portfolioId"],
        "expectedSequence":p["expectedSequence"],"amount":(amount + 1).to_string()}),
        custody(&env, portfolio, owner.pubkey(), destination));
    assert!(send(&mut env, excessive, &[&owner]).is_err());
    assert_eq!(env.svm.get_account(&portfolio).unwrap().data, before_portfolio);
    assert_eq!(env.svm.get_account(&env.market).unwrap().data, before_market);
    assert_eq!(env.all_token_account_data(), before_tokens);

    // A valid signature from a different owner cannot fund this portfolio.
    let unauthorized = build(&env, "deposit", json!({"portfolioId":p["portfolioId"],
        "expectedSequence":p["expectedSequence"],"amount":"1"}),
        custody(&env, portfolio, maker.pubkey(), env.actors[1].source_token));
    assert!(send(&mut env, unauthorized, &[&maker]).is_err());
    assert_eq!(env.svm.get_account(&portfolio).unwrap().data, before_portfolio);
    assert_eq!(env.svm.get_account(&env.market).unwrap().data, before_market);
    assert_eq!(env.all_token_account_data(), before_tokens);

    let maker_portfolio = env.actors[1].portfolio;
    let size = (percolator::POS_SCALE as i128) / 10;
    let mut trade_cu = Vec::new();
    for signed_size in [size, -size] {
        let a = read(&env, portfolio, owner.pubkey());
        let b = read(&env, maker_portfolio, maker.pubkey());
        let market_id = env.primary_market_state().1.assets[0].market_id;
        let trade = build(&env, "tradeNoCpi", json!({
            "takerPortfolioId":a["portfolioId"],"takerPositionEpoch":a["positionEpoch"],
            "makerPortfolioId":b["portfolioId"],"makerPositionEpoch":b["positionEpoch"],
            "assetIndex":0,"marketId":market_id.to_string(),"sizeQ":signed_size.to_string(),
            "execPrice":"150000000","feeBps":"0","backingFeeCapBps":0}),
            json!({"takerOwner":owner.pubkey().to_string(),"makerOwner":maker.pubkey().to_string(),
                "market":env.market.to_string(),"takerPortfolio":portfolio.to_string(),
                "makerPortfolio":maker_portfolio.to_string()}));
        trade_cu.push(send(&mut env, trade, &[&owner, &maker]).expect("open/close through JS adapter"));
    }

    let p = read(&env, portfolio, owner.pubkey());
    assert_eq!(p["pnl"], "0");
    let withdraw = build(&env, "withdraw", json!({"portfolioId":p["portfolioId"],
        "expectedSequence":p["expectedSequence"],"amount":amount.to_string()}),
        custody(&env, portfolio, owner.pubkey(), destination));
    let withdraw_cu = send(&mut env, withdraw, &[&owner]).expect("withdraw through JS adapter");
    assert_eq!(read(&env, portfolio, owner.pubkey())["capital"], "0");
    assert_eq!(env.token_amount(destination), amount);
    assert_eq!(env.token_amount(source) + env.token_amount(destination), source_before);
    assert_eq!(env.token_amount(env.vault), vault_before);
    assert_eq!(env.token_supply_observed(), supply_before);
    println!("Native SBF lifecycle CU: init={init_cu}, deposit={deposit_cu}, open={}, close={}, withdraw={withdraw_cu}", trade_cu[0], trade_cu[1]);
}
