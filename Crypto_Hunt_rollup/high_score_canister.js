// high_score_canister.js

export const idlFactory = ({ IDL }) => {
  return IDL.Service({
    'addHighScore' : IDL.Func(
        [IDL.Principal, IDL.Text, IDL.Text, IDL.Int],
        [IDL.Bool],
        [],
      ),
    'getHighScores' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Text, IDL.Text, IDL.Int))],
        ['query'],
      ),
    'resetHighScores' : IDL.Func([], [IDL.Bool], []),
  });
};
  
  export const canisterId = "sque3-gyaaa-aaaam-qde7a-cai";
  