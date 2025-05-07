// custodian canister

import Principal "mo:base/Principal";
import Array "mo:base/Array";
import Time "mo:base/Time";
import Nat8 "mo:base/Nat8";
import Nat64 "mo:base/Nat64";
import Int "mo:base/Int";
import Random "mo:base/Random";
import Iter "mo:base/Iter";
import Blob "mo:base/Blob";
import Hash "mo:base/Hash";
import Nat32 "mo:base/Nat32";
import Debug "mo:base/Debug";

actor {

  //////////////////////////////////////////////////////////////////////////
  // (A) High Score interface
  //////////////////////////////////////////////////////////////////////////
  type HighScore = actor {
    addHighScore : (Principal, Text, Text, Int) -> async Bool;
    getHighScores : () -> async [(Principal, Text, Text, Int)];
    resetHighScores : () -> async ()
  };

  //////////////////////////////////////////////////////////////////////////
  // (B) Token Transfer interface
  //////////////////////////////////////////////////////////////////////////
  type Tokens = {e8s : Nat64};
  type TransferArgs = {
    amount : Tokens;
    to_principal : Principal;
    to_subaccount : ?[Nat8]
  };
  // NOTE: if your token_transfer canister actually returns
  // a Result variant like { Ok : Nat64; Err : Text }, adapt accordingly.
  // In your existing code snippet, it's a variant. We'll just show a
  // simpler typed approach. Adjust as needed!
  type TransferResult = {
    #Ok : Nat64;
    #Err : Text
  };

  type TokenTransfer = actor {
    // Standard call for transferring from the canister’s treasury:
    transfer : (TransferArgs) -> async TransferResult;

    // For pot management:
    addToSilverPot : (Nat64) -> async Bool;
    addToGoldPot : (Nat64) -> async Bool;
    getSilverPot : () -> async Nat64;
    getGoldPot : () -> async Nat64;
    getTotalPot : () -> async Nat64;
    resetGoldPot : () -> async Bool;
    resetSilverPot : () -> async Bool
  };

  //////////////////////////////////////////////////////////////////////////
  // (C) Actor references
  //////////////////////////////////////////////////////////////////////////
  let highScoreCanisterId : Principal = Principal.fromText("sque3-gyaaa-aaaam-qde7a-cai");
  let tokenTransferCanisterId : Principal = Principal.fromText("sphs3-ayaaa-aaaah-arajq-cai");

  let highScoreActor : HighScore = actor (Principal.toText(highScoreCanisterId));
  let tokenTransferActor : TokenTransfer = actor (Principal.toText(tokenTransferCanisterId));

  stable var storedPassword : Text = "Paytoplay";

  stable var roundsSinceGoldWin : Nat = 0;
  stable var roundsSinceSilverWin : Nat = 0;

  stable var lastGoldWinTs : Int = 0;
  stable var lastSilverWinTs : Int = 0;

  /* newest round-token (increments monotonically) */
  stable var currentRoundToken : Nat = 1;

  type WinLog = {
    pid : Principal;
    duckType : Text; // "Gold" | "Silver"
    amount : Nat; // in e8s
    ts : Int; // nanoseconds since epoch
  };

  // New type to track per-player round state
  type PlayerRoundState = {
    lastRoundToken : Nat; // Last round token used by this player
    goldWinInRound : ?Nat; // Round token of last gold win, if any
    silverWinInRound : ?Nat; // Round token of last silver win, if any
  };

  stable var winLogs : [WinLog] = [];

  // New stable variable for per-player state
  stable var playerStates : [(Principal, PlayerRoundState)] = [];

  // Helper to get or initialize player state
  private func getPlayerState(pid : Principal) : PlayerRoundState {
    switch (Array.find(playerStates, func((p : Principal, _) : (Principal, PlayerRoundState)) : Bool {p == pid})) {
      case (?(_, state)) {state};
      case null {
        let newState = {
          lastRoundToken = 0;
          goldWinInRound = null;
          silverWinInRound = null
        };
        playerStates := Array.append(playerStates, [(pid, newState)]);
        newState
      }
    }
  };

  // Helper to update player state
  private func updatePlayerState(pid : Principal, state : PlayerRoundState) {
    let updated = Array.map<(Principal, PlayerRoundState), (Principal, PlayerRoundState)>(
  playerStates,
  func((p, s) : (Principal, PlayerRoundState)) : (Principal, PlayerRoundState) {
    if (p == pid) (p, state) else (p, s)
  }
);
    playerStates := updated;
  };

  /// Called once after every *round* (from JS front-end)
  public shared ({caller}) func incRoundCounters() : async Nat {
    let playerState = getPlayerState(caller);
    let newToken = playerState.lastRoundToken + 1;
    updatePlayerState(caller, {
      lastRoundToken = newToken;
      goldWinInRound = playerState.goldWinInRound;
      silverWinInRound = playerState.silverWinInRound;
    });
    // Update global counters for stats (not used for win validation)
    roundsSinceGoldWin += 1;
    roundsSinceSilverWin += 1;
    currentRoundToken += 1; // Keep for compatibility
    return newToken;
  };

  /// Front-end query for stats panel
  public query func getWinStats() : async {
    roundsSinceGoldWin : Nat;
    roundsSinceSilverWin : Nat;
    lastGoldWinTs : Int;
    lastSilverWinTs : Int
  } {
    return {
      roundsSinceGoldWin = roundsSinceGoldWin;
      roundsSinceSilverWin = roundsSinceSilverWin;
      lastGoldWinTs = lastGoldWinTs;
      lastSilverWinTs = lastSilverWinTs
    }
  };

  /// Query for the 20 most-recent wins
  public query func getRecentWins() : async [WinLog] {
    let len = winLogs.size();
    let allWinLogs = Iter.toArray(winLogs.vals());
    if (len <= 20) allWinLogs else Array.tabulate<WinLog>(20, func(i) {allWinLogs[len - 20 + i]})
  };

  //////////////////////////////////////////////////////////////////////////
  // (D) Pot management wrapper methods
  //////////////////////////////////////////////////////////////////////////

  public func getSilverPot() : async Nat64 {
    return await tokenTransferActor.getSilverPot()
  };

  public func getGoldPot() : async Nat64 {
    return await tokenTransferActor.getGoldPot()
  };

  public func getTotalPot() : async Nat64 {
    return await tokenTransferActor.getTotalPot()
  };

  //////////////////////////////////////////////////////////////////////////
  // (E) High Score calls
  //////////////////////////////////////////////////////////////////////////
  let MAX_SCORE_PER_ROUND : Int = 1_000_000; // adjust to your real limit

  public shared (msg) func addHighScoreSecure(
    name : Text,
    email : Text,
    score : Int,
    roundToken : Nat
  ) : async Bool {

    // 1) token must match *current* round and is burned afterwards
    if (roundToken != currentRoundToken) {return false};
    currentRoundToken += 1; // invalidate

    // 2) basic sanity check
    if (score < 0 or score > MAX_SCORE_PER_ROUND) {return false};

    // 3) forward to the High-Score canister
    await highScoreActor.addHighScore(msg.caller, name, email, score)
  };

  /////////////////////////////////////////////////////////////
  //  keep the old insecure addHighScore for legacy callers
  /////////////////////////////////////////////////////////////
  public shared (msg) func addHighScore(
    name : Text,
    email : Text,
    score : Int
  ) : async Bool {
    return false // always reject – forces callers to use the secure path
  };

  public func getHighScores() : async [(Principal, Text, Text, Int)] {
    return await highScoreActor.getHighScores()
  };

  public shared (msg) func resetHighScores() : async () {
    await highScoreActor.resetHighScores()
  };

  public shared ({caller}) func recordDuckWinSecure(
    duckType : Text,
    deriveFromPot : Bool,
    roundToken : Nat
) : async Bool {
    // Validate duck type
    if (duckType != "Gold" and duckType != "Silver") return false;

    // Get player state
    let playerState = getPlayerState(caller);

    // Validate round token
    if (roundToken != playerState.lastRoundToken) return false;

    // Check for previous win in this round
    if (duckType == "Gold" and playerState.goldWinInRound == ?roundToken) return false;
    if (duckType == "Silver" and playerState.silverWinInRound == ?roundToken) return false;

    // Proceed with win recording
    var amountE8s : Nat = 0;
    if (deriveFromPot) {
        amountE8s := if (duckType == "Gold") {
            Nat64.toNat(await tokenTransferActor.getGoldPot())
        } else {
            Nat64.toNat(await tokenTransferActor.getSilverPot())
        };
    };
    let now = Time.now();
    let entry : WinLog = { pid = caller; duckType; amount = amountE8s; ts = now };
    winLogs := Array.append(winLogs, [entry]);

    // Update player state
    let updatedState = {
        lastRoundToken = playerState.lastRoundToken;
        goldWinInRound = if (duckType == "Gold") ?roundToken else playerState.goldWinInRound;
        silverWinInRound = if (duckType == "Silver") ?roundToken else playerState.silverWinInRound;
    };
    updatePlayerState(caller, updatedState);

    // Update global state for stats and awards
    if (duckType == "Gold") {
        roundsSinceGoldWin := 0;
        lastGoldWinTs := now;
        lastGoldWinner := ?caller;
    } else {
        roundsSinceSilverWin := 0;
        lastSilverWinTs := now;
        lastSilverWinner := ?caller;
    };
    return true;
};

  //////////////////////////////////////////////////////////////////////////
  // (F) Standard ICP transfer
  //////////////////////////////////////////////////////////////////////////
  public shared (msg) func transferTokens(args : TransferArgs) : async TransferResult {
    return await tokenTransferActor.transfer(args)
  };

  //////////////////////////////////////////////////////////////////////////
  // (G) Rare spawn method (1 in 50k)
  //////////////////////////////////////////////////////////////////////////
  /// returns *true* with probability 1 ∕ n

  /// draw uniform Nat in [0,n-1] — unbiased (rejection sampling)
  func uniformBelow(rng : Random.Finite, n : Nat) : ?Nat {
    assert n > 0;
    let max32 : Nat = 4_294_967_296; // 2³²
    let lim : Nat = max32 - (max32 % n); // highest unbiased value

    func go() : ?Nat {
      switch (rng.range 32) {
        case (?x) {if (x < lim) ?(x % n) else go()};
        case null {null}
      }
    };
    go()
  };

  /// returns *true* with probability 1 ⁄ n (any n ≤ 2³²-1, zero bias)
  func oneInNSecure(n : Nat) : async Bool {
    let seed = await Random.blob();
    let rng = Random.Finite seed;
    switch (uniformBelow(rng, n)) {
      case (?k) {k == 0};
      case null {false}
    }
  };

  /// 1 in 50 000 – Construct 3 calls this
  public func oneIn50k() : async Bool {await oneInNSecure 1}; // 15_000 format

  /// 1 in 100 – Construct 3 calls this
  public func oneIn100() : async Bool {await oneInNSecure 1};
  //////////////////////////////////////////////////////////////////////////
  // (H) Password check & update
  //////////////////////////////////////////////////////////////////////////
  public query func verify_password(inputPassword : Text) : async Bool {
    return inputPassword == storedPassword
  };

  public shared (msg) func updatePassword(newPassword : Text) : async Bool {
    if (msg.caller != Principal.fromText("twcuh-qghsb-lpe5w-5ljam-jdhu6-5veuo-ggyrz-7y75v-5g3tv-prkx2-aae")) {
      return false
    };
    storedPassword := newPassword;
    return true
  };

  stable var lastGoldWinner : ?Principal = null;
  stable var lastSilverWinner : ?Principal = null;

  //////////////////////////////////////////////////////////////////////////
  // (J) The new method: awardGoldPotToCaller()
  //////////////////////////////////////////////////////////////////////////
  /*──────────────── award GOLD pot ─────────────*/
  public shared (msg) func awardGoldPotToCaller() : async Bool {
    // A) caller must match last winner
    switch (lastGoldWinner) {
      case null {return false};
      case (?winner) if (winner != msg.caller) {return false};
      case _ {}; // ok
    };

    // B) read pot
    let pot : Nat64 = await tokenTransferActor.getGoldPot();
    if (pot == 0) return false;

    // C) transfer
    let result = await tokenTransferActor.transfer({
      to_principal = msg.caller;
      to_subaccount = null;
      amount = {e8s = pot}
    });

    switch (result) {
      case (#Ok _) {
        // D) reset pot & winner pointer atomically
        let _ = await tokenTransferActor.resetGoldPot();
        lastGoldWinner := null;
        true
      };
      case (#Err _) {false}
    }
  };

  //////////////////////////////////////////////////////////////////////////
  // (J) The new method: awardGoldPotToCaller()
  //////////////////////////////////////////////////////////////////////////
  /*──────────────── award SILVER pot ───────────*/
  public shared (msg) func awardSilverPotToCaller() : async Bool {
    switch (lastSilverWinner) {
      case null {return false};
      case (?winner) if (winner != msg.caller) {return false};
      case _ {}
    };

    let pot : Nat64 = await tokenTransferActor.getSilverPot();
    if (pot == 0) return false;

    let result = await tokenTransferActor.transfer({
      to_principal = msg.caller;
      to_subaccount = null;
      amount = {e8s = pot}
    });

    switch (result) {
      case (#Ok _) {
        let _ = await tokenTransferActor.resetSilverPot();
        lastSilverWinner := null;
        true
      };
      case (#Err _) {false}
    }
  };

  //////////////////////////////////////////////////////////////////////////
  // (K) Expose a method to reset the gold pot from the custodian
  //////////////////////////////////////////////////////////////////////////
  // Define the custodian principal
  let custodianPrincipal = Principal.fromText("fa5ig-bkalm-nw7nw-k6i37-uowjc-7mcwv-3pcvm-5dm7z-5va6r-v7scb-hqe");

  // Assuming tokenTransferActor is properly defined elsewhere in your code
  public shared (msg) func resetGoldPotFromCustodian() : async Bool {
    if (msg.caller != custodianPrincipal) return false;
    let result = await tokenTransferActor.resetGoldPot();
    return result
  };

  public shared (msg) func resetSilverPotFromCustodian() : async Bool {
    if (msg.caller != custodianPrincipal) return false;
    let result = await tokenTransferActor.resetSilverPot();
    return result
  };

}
