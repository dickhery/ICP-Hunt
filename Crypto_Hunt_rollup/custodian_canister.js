// custodian_canister.js

// Removed the import line for "custodian_canister_idl.js"
// because we're defining the IDL inline below.

export const idlFactory = ({ IDL }) => {
  const WinLog = IDL.Record({
    'ts' : IDL.Int,
    'pid' : IDL.Principal,
    'nonce' : IDL.Nat,
    'duckType' : IDL.Text,
    'amount' : IDL.Nat,
  });
  return IDL.Service({
    'addHighScore' : IDL.Func([IDL.Text, IDL.Text, IDL.Int], [IDL.Bool], []),
    'addHighScoreSecure' : IDL.Func(
        [IDL.Text, IDL.Text, IDL.Int, IDL.Nat],
        [IDL.Bool],
        [],
      ),
    'awardGoldPotToCaller' : IDL.Func([], [IDL.Bool], []),
    'awardHighScorePot' : IDL.Func([], [IDL.Bool], []),
    'awardSilverPotToCaller' : IDL.Func([], [IDL.Bool], []),
    'getGoldDuckOdds' : IDL.Func([], [IDL.Float64], ['query']),
    'getGoldPot' : IDL.Func([], [IDL.Nat64], []),
    'getHighScores' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Text, IDL.Text, IDL.Int))],
        [],
      ),
    'getRecentWins' : IDL.Func([], [IDL.Vec(WinLog)], ['query']),
    'getSilverDuckOdds' : IDL.Func([], [IDL.Float64], ['query']),
    'getSilverPot' : IDL.Func([], [IDL.Nat64], []),
    'getTimeUntilNextAward' : IDL.Func([], [IDL.Int], ['query']),
    'getTotalPot' : IDL.Func([], [IDL.Nat64], []),
    'getWinStats' : IDL.Func(
        [],
        [
          IDL.Record({
            'lastSilverWinTs' : IDL.Int,
            'lastGoldWinTs' : IDL.Int,
            'roundsSinceGoldWin' : IDL.Nat,
            'roundsSinceSilverWin' : IDL.Nat,
          }),
        ],
        ['query'],
      ),
    'incRoundCounters' : IDL.Func([], [IDL.Nat], []),
    'isPasswordSet' : IDL.Func([], [IDL.Bool], ['query']),
    'oneIn100' : IDL.Func([], [IDL.Bool], []),
    'oneIn50k' : IDL.Func([], [IDL.Bool], []),
    'oneInNSecure' : IDL.Func([IDL.Nat], [IDL.Bool], []),
    'recordDuckWinSecure' : IDL.Func(
        [IDL.Text, IDL.Bool, IDL.Nat],
        [IDL.Bool],
        [],
      ),
    'recordGameEnd' : IDL.Func([], [], []),
    'resetGoldPotFromCustodian' : IDL.Func([], [IDL.Bool], []),
    'resetHighScores' : IDL.Func([], [], []),
    'resetSilverPotFromCustodian' : IDL.Func([], [IDL.Bool], []),
    'updatePassword' : IDL.Func([IDL.Text], [IDL.Bool], []),
    'verify_password' : IDL.Func([IDL.Text], [IDL.Bool], ['query']),
  });
};
  
  // Export the canister ID as before:
  export const canisterId = "z5cfx-3yaaa-aaaam-aee3a-cai";
  