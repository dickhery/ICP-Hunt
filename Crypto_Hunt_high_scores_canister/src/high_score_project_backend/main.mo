//  High-Score canister – hardened version
//
//  ✅  Sanitises user-supplied strings
//  ✅  Writes at most one array element per update (no large copies)
//  ✅  Keeps only the 10 best scores
//
//  ────────────────────────────────────────────────────────────

import Array     "mo:base/Array";
import Iter      "mo:base/Iter";
import Buffer    "mo:base/Buffer";
import Char      "mo:base/Char";
import Nat32     "mo:base/Nat32";
import Principal "mo:base/Principal";

actor {

  // ————————————————————————————————————
  //  configuration & helpers
  // ————————————————————————————————————
  let CUSTODIAN : Principal = Principal.fromText(
    "z5cfx-3yaaa-aaaam-aee3a-cai"
  );
  let MAX_SCORES : Nat = 10;

  /// allow-list for name characters
  func okNameChar(c : Char) : Bool {
    let n : Nat32 = Char.toNat32(c);
    return
       (n >= 0x30 and n <= 0x39)             // 0-9
    or (n >= 0x41 and n <= 0x5A)             // A-Z
    or (n >= 0x61 and n <= 0x7A)             // a-z
    or c == ' ' or c == '.' or c == '_' or c == '-' or c == '\'';
  };

  /// allow-list for email characters (adds @ + +)
  func okMailChar(c : Char) : Bool {
    okNameChar(c) or c == '@' or c == '+';
  };

  func sanitise(t : Text, test : (Char) -> Bool) : Text {
    var out : Text = "";
    for (ch in t.chars()) if (test ch) { out #= Char.toText(ch) };
    out
  };

  func sanitiseName(n : Text)  : Text = sanitise(n, okNameChar);
  func sanitiseMail(m : Text)  : Text = sanitise(m, okMailChar);

  // ————————————————————————————————————
  //  storage
  // ————————————————————————————————————
  stable var _stableScores : [(Principal, Text, Text, Int)] = [];

  let scores : Buffer.Buffer<(Principal, Text, Text, Int)> =
       Buffer.fromArray(_stableScores);

  system func preupgrade() {
    _stableScores := Buffer.toArray(scores);
  };

  system func postupgrade() {
    scores.clear();
    // Older Buffer API → push manually
    for (s in _stableScores.vals()) { scores.add(s) };
  };

  // ————————————————————————————————————
  //  public interface
  // ————————————————————————————————————
  public query func getHighScores() :
    async [(Principal, Text, Text, Int)] {

    let sorted = Array.sort<(Principal, Text, Text, Int)>(
      Buffer.toArray(scores),
      func (a, b) {
        if      (a.3 < b.3) { #less }
        else if (a.3 > b.3) { #greater }
        else                { #equal }
      }
    );
    sorted
  };

  public shared(msg) func addHighScore(
    userPrincipal : Principal,
    name          : Text,
    email         : Text,
    score         : Int
  ) : async Bool {

    if (msg.caller != CUSTODIAN) { return false };

    let safeName  = sanitiseName(name);
    let safeEmail = sanitiseMail(email);

    if (scores.size() < MAX_SCORES) {
      scores.add((userPrincipal, safeName, safeEmail, score));
      return true;
    };

    var lowestIdx   : Nat = 0;
    var lowestScore : Int = scores.get(0).3;

    for (i in Iter.range(1, scores.size() - 1)) {
      let s = scores.get(i).3;
      if (s < lowestScore) {
        lowestScore := s;
        lowestIdx   := i;
      };
    };

    if (score > lowestScore) {
      scores.put(
        lowestIdx,
        (userPrincipal, safeName, safeEmail, score)
      );
      return true;
    };

    false
  };

  public shared(msg) func resetHighScores() : async Bool {
    if (msg.caller != CUSTODIAN) { return false };
    scores.clear();
    true
  };
};
