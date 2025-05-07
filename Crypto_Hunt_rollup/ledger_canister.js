// ledger_canister.js
export const idlFactory = ({ IDL }) => {
    // Use the provided ledger IDL from your question
    // (Pasting the entire given IDL)
    
    const Account = IDL.Record({
      'owner' : IDL.Principal,
      'subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    });
    const Tokens = IDL.Record({ 'e8s' : IDL.Nat64 });
    const TransferArg = IDL.Record({
      'to' : Account,
      'fee' : IDL.Opt(IDL.Nat),
      'memo' : IDL.Opt(IDL.Vec(IDL.Nat8)),
      'from_subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)),
      'created_at_time' : IDL.Opt(IDL.Nat64),
      'amount' : IDL.Nat,
    });
    const TransferError = IDL.Variant({
      'GenericError' : IDL.Record({
        'message' : IDL.Text,
        'error_code' : IDL.Nat,
      }),
      'TemporarilyUnavailable' : IDL.Null,
      'BadBurn' : IDL.Record({ 'min_burn_amount' : IDL.Nat }),
      'Duplicate' : IDL.Record({ 'duplicate_of' : IDL.Nat }),
      'BadFee' : IDL.Record({ 'expected_fee' : IDL.Nat }),
      'CreatedInFuture' : IDL.Record({ 'ledger_time' : IDL.Nat64 }),
      'TooOld' : IDL.Null,
      'InsufficientFunds' : IDL.Record({ 'balance' : IDL.Nat }),
    });
    const Result = IDL.Variant({ 'Ok' : IDL.Nat, 'Err' : TransferError });
    
    return IDL.Service({
      'icrc1_transfer': IDL.Func([TransferArg], [Result], []),
      'icrc1_balance_of': IDL.Func([Account], [IDL.Nat], ['query']),
      'icrc1_decimals': IDL.Func([], [IDL.Nat8], ['query']),
      'icrc1_symbol': IDL.Func([], [IDL.Text], ['query']),
      // ... Add other ledger methods as needed.
    });
  };
  
  export const init = ({ IDL }) => {
    return [];
  };
  
  // Export your ledger canister Id
  export const canisterId = "ryjl3-tyaaa-aaaaa-aaaba-cai";
  