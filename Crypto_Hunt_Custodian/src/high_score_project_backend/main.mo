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
    resetHighScores : () -> async ();
  };

  //////////////////////////////////////////////////////////////////////////
  // (B) Token Transfer interface
  //////////////////////////////////////////////////////////////////////////
  type Tokens = { e8s : Nat64 };
  type TransferArgs = {
    amount : Tokens;
    to_principal : Principal;
    to_subaccount : ?[Nat8];
  };
  type TransferResult = {
    #Ok : Nat64;
    #Err : Text;
  };

  type TokenTransfer = actor {
    transfer : (TransferArgs) -> async TransferResult;
    addToSilverPot : (Nat64) -> async Bool;
    addToGoldPot : (Nat64) -> async Bool;
    getSilverPot : () -> async Nat64;
    getGoldPot : () -> async Nat64;
    getTotalPot : () -> async Nat64;
    resetGoldPot : () -> async Bool;
    resetSilverPot : () -> async Bool;
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

  stable var currentRoundToken : Nat = 1;
  // New stable variable for reentrancy guard
  stable var ongoingWins : [(Principal, Bool)] = [];
  // New stable variable for nonces
  stable var winNonces : [(Principal, Nat)] = [];
  // New stable variable for last win timestamps
  stable var lastWinTimestamps : [(Principal, Int)] = [];

  type WinLog = {
    pid : Principal;
    duckType : Text; // "Gold" | "Silver"
    amount : Nat; // in e8s
    ts : Int; // nanoseconds since epoch
    nonce : Nat; // Unique nonce for the win
  };

  type PlayerRoundState = {
    lastRoundToken : Nat;
    goldWinInRound : ?Nat;
    silverWinInRound : ?Nat;
  };

  stable var winLogs : [WinLog] = [];

  stable var playerStates : [(Principal, PlayerRoundState)] = [];

  private func getPlayerState(pid : Principal) : PlayerRoundState {
    switch (Array.find(playerStates, func((p : Principal, _) : (Principal, PlayerRoundState)) : Bool { p == pid })) {
      case (?(_, state)) { state };
      case null {
        let newState = {
          lastRoundToken = 0;
          goldWinInRound = null;
          silverWinInRound = null;
        };
        playerStates := Array.append(playerStates, [(pid, newState)]);
        newState;
      };
    };
  };

  private func updatePlayerState(pid : Principal, state : PlayerRoundState) {
    let updated = Array.map<(Principal, PlayerRoundState), (Principal, PlayerRoundState)>(
      playerStates,
      func((p, s) : (Principal, PlayerRoundState)) : (Principal, PlayerRoundState) {
        if (p == pid) (p, state) else (p, s);
      },
    );
    playerStates := updated;
  };

  // Helper to check/set reentrancy guard
  private func isWinInProgress(pid : Principal) : Bool {
    switch (Array.find(ongoingWins, func((p, _) : (Principal, Bool)) : Bool { p == pid })) {
      case (?(_, true)) { true };
      case _ { false };
    };
  };

  private func setWinInProgress(pid : Principal, state : Bool) {
    ongoingWins := Array.map<(Principal, Bool), (Principal, Bool)>(
      ongoingWins,
      func((p, s)) : (Principal, Bool) {
        if (p == pid) (p, state) else (p, s);
      },
    );
    if (Array.find(ongoingWins, func((p, _) : (Principal, Bool)) : Bool { p == pid }) == null) {
      ongoingWins := Array.append(ongoingWins, [(pid, state)]);
    };
  };

  // Helper to get/set nonce
  private func getWinNonce(pid : Principal) : Nat {
    switch (Array.find(winNonces, func((p, n) : (Principal, Nat)) : Bool { p == pid })) {
      case (?(_, nonce)) { nonce };
      case null { 0 };
    };
  };

  private func incrementWinNonce(pid : Principal) : Nat {
    let current = getWinNonce(pid);
    let newNonce = current + 1;
    winNonces := Array.map<(Principal, Nat), (Principal, Nat)>(
      winNonces,
      func((p, n)) : (Principal, Nat) {
        if (p == pid) (p, newNonce) else (p, n);
      },
    );
    if (Array.find(winNonces, func((p, _) : (Principal, Nat)) : Bool { p == pid }) == null) {
      winNonces := Array.append(winNonces, [(pid, newNonce)]);
    };
    newNonce;
  };

  // Helper to get/set last win timestamp
  private func getLastWinTimestamp(pid : Principal) : Int {
    switch (Array.find(lastWinTimestamps, func((p, t) : (Principal, Int)) : Bool { p == pid })) {
      case (?(_, ts)) { ts };
      case null { 0 };
    };
  };

  private func setLastWinTimestamp(pid : Principal, ts : Int) {
    lastWinTimestamps := Array.map<(Principal, Int), (Principal, Int)>(
      lastWinTimestamps,
      func((p, t)) : (Principal, Int) {
        if (p == pid) (p, ts) else (p, t);
      },
    );
    if (Array.find(lastWinTimestamps, func((p, _) : (Principal, Int)) : Bool { p == pid }) == null) {
      lastWinTimestamps := Array.append(lastWinTimestamps, [(pid, ts)]);
    };
  };

  public shared ({ caller }) func incRoundCounters() : async Nat {
    let playerState = getPlayerState(caller);
    let newToken = playerState.lastRoundToken + 1;
    updatePlayerState(
      caller,
      {
        lastRoundToken = newToken;
        goldWinInRound = playerState.goldWinInRound;
        silverWinInRound = playerState.silverWinInRound;
      },
    );
    roundsSinceGoldWin += 1;
    roundsSinceSilverWin += 1;
    currentRoundToken += 1; // Keep for compatibility
    return newToken;
  };

  public query func getWinStats() : async {
    roundsSinceGoldWin : Nat;
    roundsSinceSilverWin : Nat;
    lastGoldWinTs : Int;
    lastSilverWinTs : Int;
  } {
    return {
      roundsSinceGoldWin = roundsSinceGoldWin;
      roundsSinceSilverWin = roundsSinceSilverWin;
      lastGoldWinTs = lastGoldWinTs;
      lastSilverWinTs = lastSilverWinTs;
    };
  };

  public query func getRecentWins() : async [WinLog] {
    let len = winLogs.size();
    let allWinLogs = Iter.toArray(winLogs.vals());
    if (len <= 20) allWinLogs else Array.tabulate<WinLog>(20, func(i) { allWinLogs[len - 20 + i] });
  };

  public func getSilverPot() : async Nat64 {
    return await tokenTransferActor.getSilverPot();
  };

  public func getGoldPot() : async Nat64 {
    return await tokenTransferActor.getGoldPot();
  };

  public func getTotalPot() : async Nat64 {
    return await tokenTransferActor.getTotalPot();
  };

  let MAX_SCORE_PER_ROUND : Int = 1_000_000;

  public shared ({ caller }) func addHighScoreSecure(
    name : Text,
    email : Text,
    score : Int,
    roundToken : Nat,
  ) : async Bool {
    let playerState = getPlayerState(caller);
    if (roundToken != playerState.lastRoundToken) { return false };

    if (score < 0 or score > MAX_SCORE_PER_ROUND) { return false };

    await highScoreActor.addHighScore(caller, name, email, score);
  };

  public shared (msg) func addHighScore(
    name : Text,
    email : Text,
    score : Int,
  ) : async Bool {
    return false // always reject – forces callers to use the secure path
  };

  public func getHighScores() : async [(Principal, Text, Text, Int)] {
    return await highScoreActor.getHighScores();
  };

  public shared (msg) func resetHighScores() : async () {
    await highScoreActor.resetHighScores();
  };

  public shared ({ caller }) func recordDuckWinSecure(
    duckType : Text,
    deriveFromPot : Bool,
    roundToken : Nat,
  ) : async Bool {
    if (duckType != "Gold" and duckType != "Silver") return false;

    // Reentrancy guard
    if (isWinInProgress(caller)) return false;
    setWinInProgress(caller, true);

    let playerState = getPlayerState(caller);

    if (roundToken != playerState.lastRoundToken) {
      setWinInProgress(caller, false);
      return false;
    };

    // Validate last win timestamp (cooldown of 10 seconds)
    let now = Time.now();
    let lastWinTs = getLastWinTimestamp(caller);
    if (lastWinTs != 0 and now - lastWinTs < 10_000_000_000) { // 10 seconds in nanoseconds
      setWinInProgress(caller, false);
      return false;
    };

    if (duckType == "Gold" and playerState.goldWinInRound == ?roundToken) {
      setWinInProgress(caller, false);
      return false;
    };
    if (duckType == "Silver" and playerState.silverWinInRound == ?roundToken) {
      setWinInProgress(caller, false);
      return false;
    };

    var amountE8s : Nat = 0;
    if (deriveFromPot) {
      amountE8s := if (duckType == "Gold") {
        Nat64.toNat(await tokenTransferActor.getGoldPot());
      } else {
        Nat64.toNat(await tokenTransferActor.getSilverPot());
      };
    };

    let nonce = incrementWinNonce(caller);
    let entry : WinLog = {
      pid = caller;
      duckType;
      amount = amountE8s;
      ts = now;
      nonce;
    };
    winLogs := Array.append(winLogs, [entry]);

    let updatedState = {
      lastRoundToken = playerState.lastRoundToken;
      goldWinInRound = if (duckType == "Gold") ?roundToken else playerState.goldWinInRound;
      silverWinInRound = if (duckType == "Silver") ?roundToken else playerState.silverWinInRound;
    };
    updatePlayerState(caller, updatedState);

    if (duckType == "Gold") {
      roundsSinceGoldWin := 0;
      lastGoldWinTs := now;
      lastGoldWinner := ?caller;
    } else {
      roundsSinceSilverWin := 0;
      lastSilverWinTs := now;
      lastSilverWinner := ?caller;
    };

    setLastWinTimestamp(caller, now);
    setWinInProgress(caller, false);
    return true;
  };

  public func oneInNSecure(n : Nat) : async Bool {
    let seed = await Random.blob();
    let rng = Random.Finite(seed);
    switch (uniformBelow(rng, n)) {
      case (?k) { k == 0 };
      case null { false };
    };
  };

  func uniformBelow(rng : Random.Finite, n : Nat) : ?Nat {
    assert n > 0;
    let max32 : Nat = 4_294_967_296; // 2³²
    let lim : Nat = max32 - (max32 % n);

    func go() : ?Nat {
      switch (rng.range 32) {
        case (?x) { if (x < lim) ?(x % n) else go() };
        case null { null };
      };
    };
    go();
  };

  public func oneIn50k() : async Bool { await oneInNSecure(1500) }; // 1 in 1,500 for gold duck
  public func oneIn100() : async Bool { await oneInNSecure(150) }; // 1 in 150 for silver duck

  public query func verify_password(inputPassword : Text) : async Bool {
    return inputPassword == storedPassword;
  };

  public shared (msg) func updatePassword(newPassword : Text) : async Bool {
    if (msg.caller != Principal.fromText("twcuh-qghsb-lpe5w-5ljam-jdhu6-5veuo-ggyrz-7y75v-5g3tv-prkx2-aae")) {
      return false;
    };
    storedPassword := newPassword;
    return true;
  };

  stable var lastGoldWinner : ?Principal = null;
  stable var lastSilverWinner : ?Principal = null;

  public shared (msg) func awardGoldPotToCaller() : async Bool {
    // Reentrancy guard
    if (isWinInProgress(msg.caller)) return false;
    setWinInProgress(msg.caller, true);

    // Validate last win timestamp (must be within 1 hour)
    let now = Time.now();
    let lastWinTs = getLastWinTimestamp(msg.caller);
    if (lastWinTs == 0 or now - lastWinTs > 3_600_000_000_000) { // 1 hour in nanoseconds
      setWinInProgress(msg.caller, false);
      return false;
    };

    switch (lastGoldWinner) {
      case null {
        setWinInProgress(msg.caller, false);
        return false;
      };
      case (?winner) if (winner != msg.caller) {
        setWinInProgress(msg.caller, false);
        return false;
      };
      case _ {};
    };

    let pot : Nat64 = await tokenTransferActor.getGoldPot();
    if (pot == 0) {
      setWinInProgress(msg.caller, false);
      return false;
    };

    let result = await tokenTransferActor.transfer({
      to_principal = msg.caller;
      to_subaccount = null;
      amount = { e8s = pot };
    });

    switch (result) {
      case (#Ok _) {
        let _ = await tokenTransferActor.resetGoldPot();
        lastGoldWinner := null;
        setLastWinTimestamp(msg.caller, 0); // Reset timestamp to prevent re-claiming
        setWinInProgress(msg.caller, false);
        true;
      };
      case (#Err _) {
        setWinInProgress(msg.caller, false);
        false;
      };
    };
  };

  public shared (msg) func awardSilverPotToCaller() : async Bool {
    // Reentrancy guard
    if (isWinInProgress(msg.caller)) return false;
    setWinInProgress(msg.caller, true);

    // Validate last win timestamp (must be within 1 hour)
    let now = Time.now();
    let lastWinTs = getLastWinTimestamp(msg.caller);
    if (lastWinTs == 0 or now - lastWinTs > 3_600_000_000_000) { // 1 hour in nanoseconds
      setWinInProgress(msg.caller, false);
      return false;
    };

    switch (lastSilverWinner) {
      case null {
        setWinInProgress(msg.caller, false);
        return false;
      };
      case (?winner) if (winner != msg.caller) {
        setWinInProgress(msg.caller, false);
        return false;
      };
      case _ {};
    };

    let pot : Nat64 = await tokenTransferActor.getSilverPot();
    if (pot == 0) {
      setWinInProgress(msg.caller, false);
      return false;
    };

    let result = await tokenTransferActor.transfer({
      to_principal = msg.caller;
      to_subaccount = null;
      amount = { e8s = pot };
    });

    switch (result) {
      case (#Ok _) {
        let _ = await tokenTransferActor.resetSilverPot();
        lastSilverWinner := null;
        setLastWinTimestamp(msg.caller, 0); // Reset timestamp to prevent re-claiming
        setWinInProgress(msg.caller, false);
        true;
      };
      case (#Err _) {
        setWinInProgress(msg.caller, false);
        false;
      };
    };
  };

  let custodianPrincipal = Principal.fromText("fa5ig-bkalm-nw7nw-k6i37-uowjc-7mcwv-3pcvm-5dm7z-5va6r-v7scb-hqe");

  public shared (msg) func resetGoldPotFromCustodian() : async Bool {
    if (msg.caller != custodianPrincipal) return false;
    let result = await tokenTransferActor.resetGoldPot();
    return result;
  };

  public shared (msg) func resetSilverPotFromCustodian() : async Bool {
    if (msg.caller != custodianPrincipal) return false;
    let result = await tokenTransferActor.resetSilverPot();
    return result;
  };
};
