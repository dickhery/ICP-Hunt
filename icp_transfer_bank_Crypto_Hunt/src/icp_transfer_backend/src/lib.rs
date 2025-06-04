use candid::{CandidType, Principal};
use ic_cdk::api;
use ic_cdk_macros::{init, pre_upgrade, post_upgrade, query, update};
use ic_ledger_types::{
    query_blocks, transfer as ledger_transfer, AccountIdentifier, Block, BlockIndex,
    GetBlocksArgs, Memo, Operation, Subaccount, Tokens,
    TransferArgs as LedgerTransferArgs, DEFAULT_SUBACCOUNT, MAINNET_LEDGER_CANISTER_ID,
};
use serde::{Deserialize, Serialize};
use std::{
    cell::RefCell,
    collections::{HashMap, HashSet},
};

/* ───────────── constants ───────────── */
const ALLOWED_CALLER: [&str; 2] = [
    "z5cfx-3yaaa-aaaam-aee3a-cai",
    "fa5ig-bkalm-nw7nw-k6i37-uowjc-7mcwv-3pcvm-5dm7z-5va6r-v7scb-hqe",
];
const STATE_VERSION:  u8   = 1;             // bump on breaking State changes

/* ───────────── data types ──────────── */
#[derive(CandidType, Serialize, Deserialize, Clone, Debug)]
pub struct TransferArgs {
    to_principal : Principal,
    to_subaccount: Option<Subaccount>,
    amount       : Tokens,
}

#[derive(CandidType, Serialize, Deserialize, Clone, Debug)]
pub enum TransferResult { Ok(u64), Err(String) }

#[derive(CandidType, Serialize, Deserialize, Clone, Debug)]
struct LogEntry {
    timestamp   : u64,
    caller      : Principal,
    action      : String,
    amount_e8s  : u64,
    block_index : Option<u64>,
}

/* ─────────── State (v1, current) ────────── */
#[derive(Default, CandidType, Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
struct State {
    balances        : HashMap<Principal, u64>,
    credited_blocks : HashSet<u64>,
    logs            : Vec<LogEntry>,
    silver_pot_e8s  : u64,
    gold_pot_e8s    : u64,
    high_score_pot_e8s : u64,
}

/* ─── legacy State (v0: *no* pot fields) ── */
#[derive(Default, CandidType, Serialize, Deserialize, Clone, Debug)]
struct StateV0 {
    balances        : HashMap<Principal, u64>,
    credited_blocks : HashSet<u64>,
    logs            : Vec<LogEntry>,
}
impl From<StateV0> for State {
    fn from(v0: StateV0) -> Self {
        State {
            silver_pot_e8s: 0,
            gold_pot_e8s: 0,
            high_score_pot_e8s: 0,
            balances: v0.balances,
            credited_blocks: v0.credited_blocks,
            logs: v0.logs,
        }
    }
}

/* ─────────── thread-local box ─────────── */
thread_local! { static STATE: RefCell<State> = RefCell::new(State::default()); }

/* helpers */
fn with_state<R>(f: impl FnOnce(&State) -> R) -> R { STATE.with(|s| f(&s.borrow())) }
fn with_state_mut<R>(f: impl FnOnce(&mut State) -> R) -> R { STATE.with(|s| f(&mut s.borrow_mut())) }
fn add_log(caller:Principal, action:&str, amt:u64, idx:Option<u64>){
    with_state_mut(|st| st.logs.push(LogEntry{
        timestamp: api::time(),
        caller, action: action.into(),
        amount_e8s: amt, block_index: idx,
    }));
}

/* ─────────── lifecycle hooks ─────────── */
#[init]
fn init() { api::print("[init] jackpot canister online"); }

#[pre_upgrade]
fn pre_upgrade() {
    let snap = STATE.with(|s| s.borrow().clone());
    ic_cdk::storage::stable_save((STATE_VERSION, snap))
        .expect("stable_save failed");
}

#[post_upgrade]
fn post_upgrade() {
    /* 1️⃣ try new (tagged) format */
    if let Ok((ver, state)) = ic_cdk::storage::stable_restore::<(u8, State)>() {
        STATE.with(|s| *s.borrow_mut() = state);
        api::print(format!("[post_upgrade] restored v{}", ver));
        return;
    }
    /* 2️⃣ try legacy v0 */
    if let Ok((legacy,)) = ic_cdk::storage::stable_restore::<(StateV0,)>() {
        STATE.with(|s| *s.borrow_mut() = State::from(legacy));
        api::print("[post_upgrade] restored v0 (pots default = 0)");
        return;
    }
    /* 3️⃣ nothing found */
    api::print("[post_upgrade] no snapshot – fresh start");
}

/* ─────── ledger-side verification ─────── */
async fn verify_block(user:Principal, amount_e8s:u64,
                      block_index:u64) -> Result<(),String> {
    if with_state(|st| st.credited_blocks.contains(&block_index)){
        return Err("block_index already credited".into());
    }

    let resp = query_blocks(
        MAINNET_LEDGER_CANISTER_ID,
        GetBlocksArgs { start: block_index, length: 1 },
    )
    .await
    .map_err(|e| format!("ledger query failed: {:?}", e))?;

    let blk: &Block = resp.blocks.get(0).ok_or("block not found")?;

    match blk.transaction.operation.as_ref().ok_or("operation missing")? {
        Operation::Transfer { from, to, amount, .. } => {
            let expected_to   = AccountIdentifier::new(&ic_cdk::id(), &DEFAULT_SUBACCOUNT);
            let expected_from = AccountIdentifier::new(&user,         &DEFAULT_SUBACCOUNT);
            if to != &expected_to   { return Err("destination is not this canister".into()); }
            if from != &expected_from{ return Err("source does not match user".into()); }
            if amount.e8s() != amount_e8s { return Err("amount mismatch".into()); }
        }
        _ => return Err("block is not a transfer".into()),
    }
    Ok(())
}

// ───────────────── public methods ──────────────────────

/// Secure **async** recordDeposit
#[update]
async fn recordDeposit(user: Principal, amount_e8s: u64, block_index: u64) -> bool {
    let caller = api::caller();
    match verify_block(user, amount_e8s, block_index).await {
        Ok(()) => {
            let silver_add = 1_500_000; // 0.015 ICP in e8s
            let gold_add = 2_000_000;   // 0.02 ICP in e8s
            let high_score_add = 1_000_000; // 0.01 ICP in e8s
            with_state_mut(|st| {
                *st.balances.entry(user).or_default() += amount_e8s;
                st.credited_blocks.insert(block_index);
                st.silver_pot_e8s += silver_add;
                st.gold_pot_e8s += gold_add;
                st.high_score_pot_e8s += high_score_add;
            });
            add_log(caller, "recordDeposit", amount_e8s, Some(block_index));
            add_log(caller, "autoAddSilver", silver_add, None);
            add_log(caller, "autoAddGold", gold_add, None);
            add_log(caller, "autoAddHighScore", high_score_add, None);
            api::print(format!(
                "[recordDeposit] {} +{} e8s (block {}) – ok",
                user, amount_e8s, block_index
            ));
            true
        }
        Err(e) => {
            api::print(format!("[recordDeposit] rejected: {}", e));
            false
        }
    }
}

/// Withdraw ICP back to caller
#[update]
async fn withdraw(amount_e8s: u64) -> TransferResult {
    let caller = api::caller();
    let bal = with_state(|st| st.balances.get(&caller).copied().unwrap_or(0));

    if amount_e8s > bal {
        return TransferResult::Err("Insufficient balance".into());
    }

    let args = LedgerTransferArgs {
        memo: Memo(0),
        amount: Tokens::from_e8s(amount_e8s),
        fee: Tokens::from_e8s(10_000),
        from_subaccount: None,
        to: AccountIdentifier::new(&caller, &DEFAULT_SUBACCOUNT),
        created_at_time: None,
    };

    match ledger_transfer(MAINNET_LEDGER_CANISTER_ID, args).await {
        Ok(Ok(idx)) => {
            with_state_mut(|st| st.balances.insert(caller, bal - amount_e8s));
            add_log(caller, "withdraw", amount_e8s, Some(idx));
            TransferResult::Ok(idx)
        }
        Ok(Err(e)) => TransferResult::Err(format!("ledger error: {:?}", e)),
        Err(e) => TransferResult::Err(format!("call failed: {:?}", e)),
    }
}

/// Balance helpers
#[query]
fn getBalanceOf(user: Principal) -> u64 {
    with_state(|st| st.balances.get(&user).copied().unwrap_or(0))
}
#[query]
fn getMyBalance() -> u64 {
    let caller = api::caller();
    with_state(|st| st.balances.get(&caller).copied().unwrap_or(0))
}

fn is_allowed_caller(caller: &Principal) -> bool {
    ALLOWED_CALLER.contains(&caller.to_text().as_str())
}


/// Custodian-only ICP transfer
#[update]
async fn transfer(args: TransferArgs) -> Result<BlockIndex, String> {
    let caller = api::caller();
    if !is_allowed_caller(&caller) {
        return Err("not authorised".into());
    }

    let to_sub = args.to_subaccount.unwrap_or(DEFAULT_SUBACCOUNT);
    let ledger_args = LedgerTransferArgs {
        memo: Memo(0),
        amount: args.amount,
        fee: Tokens::from_e8s(10_000),
        from_subaccount: None,
        to: AccountIdentifier::new(&args.to_principal, &to_sub),
        created_at_time: None,
    };
    match ledger_transfer(MAINNET_LEDGER_CANISTER_ID, ledger_args).await {
        Ok(Ok(idx)) => {
            add_log(caller, "transfer", args.amount.e8s(), Some(idx));
            Ok(idx)
        }
        Ok(Err(e)) => Err(format!("ledger error: {:?}", e)),
        Err(e) => Err(format!("call failed: {:?}", e)),
    }
}

// ───────── audit + jackpot helpers (unchanged) ─────────
#[query]
fn getLogs() -> Vec<LogEntry>                 { with_state(|st| st.logs.clone()) }
#[query]
fn getSilverPot() -> u64                      { with_state(|st| st.silver_pot_e8s) }
#[query]
fn getGoldPot() -> u64                        { with_state(|st| st.gold_pot_e8s) }
#[query]
fn getTotalPot() -> u64                       { with_state(|st| st.silver_pot_e8s + st.gold_pot_e8s) }

#[update]
fn addToSilverPot(amount_e8s: u64) -> bool    { pot_add(amount_e8s, true) }
#[update]
fn addToGoldPot(amount_e8s: u64)   -> bool    { pot_add(amount_e8s, false) }

#[update]
async fn resetSilverPot() -> bool             { pot_reset(25_000_000, true) }
#[update]
async fn resetGoldPot() -> bool               { pot_reset(250_000_000, false) }

// internal helpers for pots
fn pot_add(amount: u64, silver: bool) -> bool {
    let caller = api::caller();
    if !is_allowed_caller(&caller) { return false; }
    with_state_mut(|st| {
        if silver { st.silver_pot_e8s += amount; } else { st.gold_pot_e8s += amount; }
    });
    add_log(caller, if silver { "addSilver" } else { "addGold" }, amount, None);
    true
}
fn pot_reset(amount: u64, silver: bool) -> bool {
    let caller = api::caller();
    if !is_allowed_caller(&caller) { return false; }
    with_state_mut(|st| {
        if silver { st.silver_pot_e8s = amount; } else { st.gold_pot_e8s = amount; }
    });
    add_log(caller, if silver { "resetSilver" } else { "resetGold" }, amount, None);
    true
}

#[query]
fn getHighScorePot() -> u64 { with_state(|st| st.high_score_pot_e8s) }

#[update]
fn addToHighScorePot(amount_e8s: u64) -> bool {
    let caller = api::caller();
    if !is_allowed_caller(&caller) { return false; }
    with_state_mut(|st| st.high_score_pot_e8s += amount_e8s);
    add_log(caller, "addHighScorePot", amount_e8s, None);
    true
}

#[update]
fn resetHighScorePot() -> bool {
    let caller = api::caller();
    if !is_allowed_caller(&caller) { return false; }
    with_state_mut(|st| st.high_score_pot_e8s = 0);
    add_log(caller, "resetHighScorePot", 0, None);
    true
}

#[query]
fn getUserLogs(user: Principal) -> Vec<LogEntry> {
    with_state(|st| {
        st.logs.iter().filter(|log| log.caller == user).cloned().collect()
    })
}

// ───────── export candid ─────────
ic_cdk::export_candid!();