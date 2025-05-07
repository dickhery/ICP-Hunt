// token_transfer_from_backend_canister.js
export const idlFactory = ({ IDL }) => {
  const LogEntry = IDL.Record({
    'action' : IDL.Text,
    'block_index' : IDL.Opt(IDL.Nat64),
    'amount_e8s' : IDL.Nat64,
    'timestamp' : IDL.Nat64,
    'caller' : IDL.Principal,
  });
  const Tokens = IDL.Record({ 'e8s' : IDL.Nat64 });
  const TransferArgs = IDL.Record({
    'to_principal' : IDL.Principal,
    'to_subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'amount' : Tokens,
  });
  const Result = IDL.Variant({ 'Ok' : IDL.Nat64, 'Err' : IDL.Text });
  const TransferResult = IDL.Variant({ 'Ok' : IDL.Nat64, 'Err' : IDL.Text });
  return IDL.Service({
    'addToGoldPot' : IDL.Func([IDL.Nat64], [IDL.Bool], []),
    'addToSilverPot' : IDL.Func([IDL.Nat64], [IDL.Bool], []),
    'getBalanceOf' : IDL.Func([IDL.Principal], [IDL.Nat64], ['query']),
    'getGoldPot' : IDL.Func([], [IDL.Nat64], ['query']),
    'getLogs' : IDL.Func([], [IDL.Vec(LogEntry)], ['query']),
    'getMyBalance' : IDL.Func([], [IDL.Nat64], ['query']),
    'getSilverPot' : IDL.Func([], [IDL.Nat64], ['query']),
    'getTotalPot' : IDL.Func([], [IDL.Nat64], ['query']),
    'recordDeposit' : IDL.Func(
        [IDL.Principal, IDL.Nat64, IDL.Nat64],
        [IDL.Bool],
        [],
      ),
    'resetGoldPot' : IDL.Func([], [IDL.Bool], []),
    'resetSilverPot' : IDL.Func([], [IDL.Bool], []),
    'transfer' : IDL.Func([TransferArgs], [Result], []),
    'withdraw' : IDL.Func([IDL.Nat64], [TransferResult], []),
  });
};
  
  export const init = ({ IDL }) => {
    return [];
  };
  
  export const canisterId = "sphs3-ayaaa-aaaah-arajq-cai"; // or your actual canister ID
  