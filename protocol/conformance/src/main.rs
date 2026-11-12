//! Export wire fixtures from the pinned upstream encoder, not a second serializer.
use percolator_prog::{constants as c, ix::{Instruction, CrankObservationHint}, state};
use percolator::{PortfolioAccountV16Account, ProvenanceHeaderV16Account, MarketGroupV16HeaderAccount};
use core::mem::offset_of;
use serde_json::{json, Value};

fn fixture(name: &str, args: Value, ix: Instruction) -> Value {
    let data = ix.encode();
    assert_eq!(Instruction::decode(&data).unwrap(), ix);
    let mut extra = data.clone(); extra.push(0);
    assert!(Instruction::decode(&extra).is_err(), "trailing bytes must reject");
    json!({"name": name, "args": args, "hex": data.iter().map(|b| format!("{b:02x}")).collect::<String>()})
}

fn main() {
    let mut portfolio = vec![0u8; c::PORTFOLIO_ACCOUNT_LEN];
    state::init_portfolio_account_zero_copy(&mut portfolio, [1;32], [2;32], [3;32], 123, 1, 17).unwrap();
    let portfolio_owner = c::HEADER_LEN + offset_of!(PortfolioAccountV16Account, owner);
    let provenance = c::HEADER_LEN + offset_of!(PortfolioAccountV16Account, provenance_header);
    let fixtures = vec![
        fixture("initPortfolio", json!({}), Instruction::InitPortfolio),
        fixture("deposit", json!({"portfolioId":"17","expectedSequence":"3","amount":"1000000"}),
            Instruction::Deposit { portfolio_id:17, expected_sequence:3, amount:1_000_000 }),
        fixture("withdraw", json!({"portfolioId":"18446744073709551614","expectedSequence":"9007199254740993","amount":"18446744073709551615"}),
            Instruction::Withdraw { portfolio_id:u64::MAX-1, expected_sequence:9_007_199_254_740_993, amount:u64::MAX as u128 }),
        fixture("tradeNoCpi", json!({"takerPortfolioId":"17","takerPositionEpoch":"2","makerPortfolioId":"33","makerPositionEpoch":"4","assetIndex":0,"marketId":"5","sizeQ":"1000000","execPrice":"150000000","feeBps":"5","backingFeeCapBps":20}),
            Instruction::TradeNoCpi { account_a_portfolio_id:17, account_a_position_epoch:2, account_b_portfolio_id:33, account_b_position_epoch:4, asset_index:0, market_id:5, size_q:1_000_000, exec_price:150_000_000, fee_bps:5, backing_fee_cap_bps:20 }),
        fixture("tradeCpi", json!({"takerPortfolioId":"17","takerPositionEpoch":"2","makerPortfolioId":"33","makerPositionEpoch":"4","makerMatcherSequence":"7","assetIndex":258,"marketId":"9007199254740993","sizeQ":"-1000000","limitPrice":"149000000","feeBps":"5","backingFeeCapBps":20}),
            Instruction::TradeCpi { account_a_portfolio_id:17, account_a_position_epoch:2, account_b_portfolio_id:33, account_b_position_epoch:4, account_b_matcher_sequence:7, asset_index:258, market_id:9_007_199_254_740_993, size_q:-1_000_000, limit_price:149_000_000, fee_bps:5, backing_fee_cap_bps:20 }),
        fixture("permissionlessCrank", json!({"nowSlot":"9007199254740993","observations":[{"assetIndex":0,"oracleAccounts":1},{"assetIndex":258,"oracleAccounts":3}]}),
            Instruction::PermissionlessCrank { now_slot:9_007_199_254_740_993, observations:vec![CrankObservationHint { asset_index:0, oracle_accounts:1 },CrankObservationHint { asset_index:258, oracle_accounts:3 }] }),
    ];
    // The official CLI still emits 17-byte deposits. They must not be accepted by
    // this release, which binds the portfolio incarnation and owner sequence.
    let mut legacy_deposit = vec![3]; legacy_deposit.extend(1_000_000u128.to_le_bytes());
    assert!(Instruction::decode(&legacy_deposit).is_err());
    println!("{}", serde_json::to_string_pretty(&json!({
        "wrapperCommit":"b42fe017c2bc953778f90d0cb85cd1d426b6e783",
        "engineCommit":"b22bef7d6122fd7d82680ce9859e8b77fd8ef656",
        "constants": {"magic":format!("{:016x}",c::MAGIC),"version":c::VERSION,"headerLength":c::HEADER_LEN,"marketKind":c::KIND_MARKET,"portfolioKind":c::KIND_PORTFOLIO,"marketGroupOffset":c::MARKET_GROUP_OFF,"marketHeaderLength":c::MARKET_GROUP_LEN,"marketAssetSlotLength":c::MARKET_ASSET_SLOT_LEN,"portfolioLength":c::PORTFOLIO_ACCOUNT_LEN,"portfolioIdOffset":c::PORTFOLIO_ID_OFF,"portfolioSequenceOffset":c::PORTFOLIO_MATCHER_SEQUENCE_OFF,"portfolioControlOffset":c::PORTFOLIO_MATCHER_CONTROL_OFF,"positionEpochMax":state::PortfolioMatcherConfigV16::position_epoch_max().to_string(),"portfolioOwnerOffset":portfolio_owner,"portfolioCapitalOffset":c::HEADER_LEN+offset_of!(PortfolioAccountV16Account,capital),"portfolioPnlOffset":c::HEADER_LEN+offset_of!(PortfolioAccountV16Account,pnl),"portfolioMarketOffset":provenance+offset_of!(ProvenanceHeaderV16Account,market_group_id),"portfolioAddressOffset":provenance+offset_of!(ProvenanceHeaderV16Account,portfolio_account_id),"portfolioProvenanceOwnerOffset":provenance+offset_of!(ProvenanceHeaderV16Account,owner),"marketCapacityOffset":c::MARKET_GROUP_OFF+offset_of!(MarketGroupV16HeaderAccount,asset_slot_capacity),"marketModeOffset":c::MARKET_GROUP_OFF+offset_of!(MarketGroupV16HeaderAccount,mode),"marketSlotOffset":c::MARKET_GROUP_OFF+offset_of!(MarketGroupV16HeaderAccount,current_slot)},
        "portfolioFixtureHex":portfolio.iter().map(|b|format!("{b:02x}")).collect::<String>(),
        "fixtures":fixtures
    })).unwrap());
}
