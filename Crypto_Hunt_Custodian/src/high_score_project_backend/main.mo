// custodian canister

import Principal "mo:base/Principal";
import Array "mo:base/Array";
import Time "mo:base/Time";
import Nat "mo:base/Nat";
import Nat8 "mo:base/Nat8";
import Nat64 "mo:base/Nat64";
import Int "mo:base/Int";
import Random "mo:base/Random";
import Iter "mo:base/Iter";
import Blob "mo:base/Blob";
import Hash "mo:base/Hash";
import Nat32 "mo:base/Nat32";
import Debug "mo:base/Debug";
import Float "mo:base/Float";
import Error "mo:base/Error";

import Text "mo:base/Text";

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
    addToHighScorePot : (Nat64) -> async Bool;
    getSilverPot : () -> async Nat64;
    getGoldPot : () -> async Nat64;
    getHighScorePot : () -> async Nat64;
    getTotalPot : () -> async Nat64;
    resetGoldPot : () -> async Bool;
    resetSilverPot : () -> async Bool;
    resetHighScorePot : () -> async Bool;
  };

  //////////////////////////////////////////////////////////////////////////
  // (C) Actor references
  //////////////////////////////////////////////////////////////////////////
  let highScoreCanisterId : Principal = Principal.fromText("sque3-gyaaa-aaaam-qde7a-cai");
  let tokenTransferCanisterId : Principal = Principal.fromText("sphs3-ayaaa-aaaah-arajq-cai");

  let highScoreActor : HighScore = actor (Principal.toText(highScoreCanisterId));
  let tokenTransferActor : TokenTransfer = actor (Principal.toText(tokenTransferCanisterId));

  let SILVER_ADD : Nat64 = 1_167_000; // 0.01167 ICP in e8s
  let GOLD_ADD : Nat64 = 1_556_000; // 0.01556 ICP in e8s
  let HIGH_SCORE_ADD : Nat64 = 778_000; // 0.00778 ICP in e8s

  stable var storedPassword : Text = "";
  stable var sessionTokens : [(Principal, Text)] = [];
  stable var usedTokens : [Nat] = [];

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

  stable var promoCodes : [Text] = [];

  type PlayerRoundState = {
    lastRoundToken : Nat;
    goldWinInRound : ?Nat;
    silverWinInRound : ?Nat;
    currentGameRounds : Nat;
    maxAllowedScore : Int;
  };

  stable var winLogs : [WinLog] = [];

  stable var playerStates : [(Principal, PlayerRoundState)] = [];

  stable var gameRounds : [var Nat] = Array.init<Nat>(100, 0);
  stable var gameRoundsCount : Nat = 0;
  stable var gameRoundsIndex : Nat = 0;

  private func getPlayerState(pid : Principal) : PlayerRoundState {
    switch (Array.find(playerStates, func((p : Principal, _) : (Principal, PlayerRoundState)) : Bool { p == pid })) {
      case (?(_, state)) { state };
      case null {
        let newState : PlayerRoundState = {
          lastRoundToken = 0;
          goldWinInRound = null;
          silverWinInRound = null;
          currentGameRounds = 0;
          maxAllowedScore = 0;
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

  public shared ({ caller }) func generatePromoCode() : async Text {
    if (caller != custodianPrincipal) {
      throw Error.reject("Only admin can generate promo codes");
    };

    let seed = await Random.blob();
    let rng = Random.Finite(seed);
    let chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let charsArray = Text.toArray(chars);
    var code = "";
    for (_ in Iter.range(0, 11)) {
      // 12 characters
      switch (rng.range(5)) {
        case (?n) {
          let index = n % 36;
          code := code # Text.fromChar(charsArray[index]);
        };
        case null {
          throw Error.reject("Random number generation failed");
        };
      };
    };

    // Ensure uniqueness
    while (Array.find(promoCodes, func(c : Text) : Bool { c == code }) != null) {
      switch (rng.range(5)) {
        case (?n) {
          let index = n % 36;
          code := code # Text.fromChar(charsArray[index]);
        };
        case null {
          throw Error.reject("Random number generation failed");
        };
      };
    };

    promoCodes := Array.append(promoCodes, [code]);
    return code;
  };

  public shared func validatePromoCode(code : Text) : async Bool {
    let index = Array.indexOf(code, promoCodes, Text.equal);
    switch (index) {
      case (?i) {
        promoCodes := Array.filter(promoCodes, func(c : Text) : Bool { c != code });
        ignore tokenTransferActor.addToSilverPot(SILVER_ADD);
        ignore tokenTransferActor.addToGoldPot(GOLD_ADD);
        ignore tokenTransferActor.addToHighScorePot(HIGH_SCORE_ADD);
        return true;
      };
      case null {
        return false;
      };
    };
  };

  public query ({ caller }) func getActivePromoCodes() : async [Text] {
  if (caller != custodianPrincipal) {
    throw Error.reject("Only admin can view active promo codes");
  };
  return promoCodes;
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

  // Add rounds to circular buffer
  private func addGameRounds(rounds : Nat) {
    if (gameRoundsCount < 100) {
      gameRounds[gameRoundsIndex] := rounds;
      gameRoundsIndex := (gameRoundsIndex + 1) % 100;
      gameRoundsCount += 1;
    } else {
      gameRounds[gameRoundsIndex] := rounds;
      gameRoundsIndex := (gameRoundsIndex + 1) % 100;
    };
  };

  // Calculate average rounds per game
  private func getAverageRounds() : Float {
    if (gameRoundsCount == 0) return 0.0;
    var sum : Int = 0;
    let count = if (gameRoundsCount < 100) gameRoundsCount else 100;
    for (i in Iter.range(0, count - 1)) {
      // Calculate the index using Int to handle negative values
      let idxInt : Int = (gameRoundsIndex : Int) - 1 - (i : Int);
      // Adjust for circular buffer: modulo 100, then take absolute value
      let idx = Int.abs(idxInt % 100);
      sum += gameRounds[idx];
    };
    Float.fromInt(sum) / Float.fromInt(count);
  };

  // Calculate dynamic n for gold and silver ducks
  private func getNGold() : Nat {
    let avg = getAverageRounds();
    let intVal = Float.toInt(Float.nearest(avg));
    let R = if (avg > 0.0) {
      if (intVal >= 0) { Int.abs(intVal) : Nat } else { 10 };
    } else { 10 };
    if (R < 1) { 1 } else { R * 300 }; //(R * 300) = 1 in 3000 rounds ~300 games
  };

  private func getNSilver() : Nat {
    let avg = getAverageRounds();
    let intVal = Float.toInt(Float.nearest(avg));
    let R = if (avg > 0.0) {
      if (intVal >= 0) { Int.abs(intVal) : Nat } else { 10 };
    } else { 10 };
    if (R < 1) { 1 } else { R * 20 }; //(R * 20) = 1 in 200 rounds ~20 games
  };

  public shared ({ caller }) func incRoundCounters() : async Nat {
    let seed = await Random.blob();
    let rng = Random.Finite(seed);
    let newToken = switch (rng.range(32)) {
      case (?n) { n };
      case null { 0 }; // Fallback
    };
    let playerState = getPlayerState(caller);
    updatePlayerState(caller, {
      lastRoundToken = newToken;
      goldWinInRound = playerState.goldWinInRound;
      silverWinInRound = playerState.silverWinInRound;
      currentGameRounds = playerState.currentGameRounds + 1;
      maxAllowedScore = playerState.maxAllowedScore;
    });
    roundsSinceGoldWin += 1;
    roundsSinceSilverWin += 1;
    currentRoundToken += 1;
    return newToken;
  };

  public query func getCurrentAverageRounds() : async Float {
    getAverageRounds();
  };

  // New function to record game end
  public shared ({ caller }) func recordGameEnd() : async () {
    let playerState = getPlayerState(caller);
    let rounds = playerState.currentGameRounds;
    addGameRounds(rounds);
    let maxScore = rounds * 16_000;
    updatePlayerState(
      caller,
      {
        lastRoundToken = playerState.lastRoundToken;
        goldWinInRound = playerState.goldWinInRound;
        silverWinInRound = playerState.silverWinInRound;
        currentGameRounds = 0;
        maxAllowedScore = maxScore;
      },
    );
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
    sessionToken : Text
  ) : async Bool {
    let playerState = getPlayerState(caller);
    if (roundToken != playerState.lastRoundToken) return false;
    if (Array.indexOf<Nat>(roundToken, usedTokens, func (a, b) { a == b }) != null) return false; // Prevent replay
    if (score < 0 or score > playerState.maxAllowedScore) return false;

    // Validate session token
    let expectedSeed = Principal.toText(caller) # Nat.toText(roundToken) # Int.toText(score) # name # email;
    let expectedHash = Text.hash(expectedSeed); // Simple hash for demo; use a secure hash in production
    if (sessionToken != expectedHash) return false;

    let result = await highScoreActor.addHighScore(caller, name, email, score);
    if (result) {
      usedTokens := Array.append(usedTokens, [roundToken]);
      updatePlayerState(caller, {
        lastRoundToken = playerState.lastRoundToken;
        goldWinInRound = playerState.goldWinInRound;
        silverWinInRound = playerState.silverWinInRound;
        currentGameRounds = playerState.currentGameRounds;
        maxAllowedScore = 0;
      });
    };
    result;
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
  if (isWinInProgress(caller)) return false;
  setWinInProgress(caller, true);
  var result = false;
  try {
    let playerState = getPlayerState(caller);
    if (roundToken == playerState.lastRoundToken) {
      let now = Time.now();
      let lastWinTs = getLastWinTimestamp(caller);
      if (lastWinTs == 0 or now - lastWinTs >= 10_000_000_000) {
        if ((duckType == "Gold" and playerState.goldWinInRound != ?roundToken) or
            (duckType == "Silver" and playerState.silverWinInRound != ?roundToken)) {
          var amountE8s : Nat = 0;
          if (deriveFromPot) {
            amountE8s := if (duckType == "Gold") {
              Nat64.toNat(await tokenTransferActor.getGoldPot());
            } else {
              Nat64.toNat(await tokenTransferActor.getSilverPot());
            };
          };
          let nonce = incrementWinNonce(caller);
          let entry : WinLog = { pid = caller; duckType; amount = amountE8s; ts = now; nonce };
          winLogs := Array.append(winLogs, [entry]);
          let updatedState = {
            currentGameRounds = playerState.currentGameRounds;
            lastRoundToken = playerState.lastRoundToken;
            goldWinInRound = if (duckType == "Gold") ?roundToken else playerState.goldWinInRound;
            silverWinInRound = if (duckType == "Silver") ?roundToken else playerState.silverWinInRound;
            maxAllowedScore = playerState.maxAllowedScore;
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
          result := true;
        };
      };
    };
  } catch (e) {
    result := false;
  } finally {
    setWinInProgress(caller, false);
  };
  result
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

  public func oneIn50k() : async Bool { await oneInNSecure(getNGold()) };
  public func oneIn100() : async Bool { await oneInNSecure(getNSilver()) };

  //Testing setup
  // Function to determine if a gold duck spawns (originally 1 in 50,000 chance)
  //    public shared func oneIn50k() : async Bool {
  // Temporarily set to always return true for testing
  //        return true;
  //    };

  // Function to determine if a silver duck spawns (originally 1 in 100 chance)
  // Temporarily set to always return true for testing
  //    public shared func oneIn100() : async Bool {
  //       return true;
  //    };

  public query func getGoldDuckOdds() : async Float {
    let avg = getAverageRounds();
    if (avg == 0.0) {
      return 0.0;
    };
    let intVal = Float.toInt(Float.nearest(avg));
    let R = if (intVal >= 0) { Int.abs(intVal) : Nat } else { 10 };
    let n = if (R < 1) { 1 } else { R * 300 }; // Matches getNGold()
    1.0 / Float.fromInt(n);
  };

  public query func getSilverDuckOdds() : async Float {
    let avg = getAverageRounds();
    if (avg == 0.0) {
      return 0.0;
    };
    let intVal = Float.toInt(Float.nearest(avg));
    let R = if (intVal >= 0) { Int.abs(intVal) : Nat } else { 10 };
    let n = if (R < 1) { 1 } else { R * 20 }; // Matches getNSilver()
    1.0 / Float.fromInt(n);
  };

  public query func verify_password(inputPassword : Text) : async Bool {
    if (storedPassword == "") {
      return false; // Password not set
    };
    return inputPassword == storedPassword;
  };

  public query func isPasswordSet() : async Bool {
    return storedPassword != "";
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
    if (lastWinTs == 0 or now - lastWinTs > 3_600_000_000_000) {
      // 1 hour in nanoseconds
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
    if (lastWinTs == 0 or now - lastWinTs > 3_600_000_000_000) {
      // 1 hour in nanoseconds
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

  stable var lastHighScoreAwardTs : ?Time.Time = null;
  stable var isAwardingHighScorePot : Bool = false;
  stable var lastWinner : ?(Principal, Text, Text, Int) = null; // Stores (principal, name, email, score)
  stable var lastWinnerAmount : Nat64 = 0; // Stores the awarded amount in e8s

  public query func getLastHighScoreAwardTs() : async ?Time.Time {
    lastHighScoreAwardTs;
  };

  private func canAwardHighScorePot() : Bool {
    let now = Time.now();
    //  let oneMonthInNs = 60 * 60 * 1_000_000_000;  // Test case 1 houur
    let oneMonthInNs = 7 * 24 * 60 * 60 * 1_000_000_000; // ~7 days in nanoseconds = 30 * 24 * 60 * 60 * 1_000_000_000;
    switch (lastHighScoreAwardTs) {
      case (null) { true }; // Never awarded, so allow it
      case (?ts) { (now - ts) >= oneMonthInNs };
    };
  };

  public shared ({ caller }) func awardHighScorePot() : async Bool {
    if (isAwardingHighScorePot or not canAwardHighScorePot()) {
      return false;
    };
    isAwardingHighScorePot := true;
    try {
      let scores = await highScoreActor.getHighScores();
      if (scores.size() == 0) {
        isAwardingHighScorePot := false;
        return false;
      };
      var topScore : (Principal, Text, Text, Int) = scores[0];
      for (score in scores.vals()) {
        if (score.3 > topScore.3) {
          topScore := score;
        };
      };
      let winnerPrincipal = topScore.0;
      let amountE8s = await tokenTransferActor.getHighScorePot();
      if (amountE8s == 0) {
        isAwardingHighScorePot := false;
        return false;
      };
      let result = await tokenTransferActor.transfer({
        to_principal = winnerPrincipal;
        to_subaccount = null;
        amount = { e8s = amountE8s };
      });
      switch (result) {
        case (#Ok _) {
          let _ = await tokenTransferActor.resetHighScorePot();
          lastWinner := ?topScore; // Save the entire topScore tuple
          lastWinnerAmount := amountE8s; // Save the awarded amount
          lastHighScoreAwardTs := ?Time.now(); // Already present
          await highScoreActor.resetHighScores();
          isAwardingHighScorePot := false;
          return true;
        };
        case (#Err _) {
          isAwardingHighScorePot := false;
          return false;
        };
      };
    } catch (e) {
      isAwardingHighScorePot := false;
      return false;
    };
  };

  public query func getLastWinnerDetails() : async {
    winner : ?(Principal, Text, Text, Int);
    amount : Nat64;
    timestamp : ?Time.Time;
  } {
    return {
      winner = lastWinner;
      amount = lastWinnerAmount;
      timestamp = lastHighScoreAwardTs;
    };
  };

  public query func getTimeUntilNextAward() : async Int {

    //  let oneWeekInNs : Int = 60 * 60 * 1_000_000_000;  // test case 1 hour
    let oneWeekInNs : Int = 7 * 24 * 3600 * 1_000_000_000; // 7 days in nanoseconds
    let now = Time.now();
    switch (lastHighScoreAwardTs) {
      case (null) { 0 }; // Can be awarded immediately
      case (?ts) {
        let next_award_time = ts + oneWeekInNs;
        let time_left = next_award_time - now;
        if (time_left < 0) { 0 } else { time_left };
      };
    };
  };

};
