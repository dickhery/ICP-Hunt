/*********************************
 * main.js (Construct 3 front end)
 *********************************/

import {
  // AD network calls:
  initActorUnauthenticated,
  initActorWithPlug,
  initActorWithInternetIdentity,
  getCurrentIdentity,
  createAd,
  getNextAd,
  registerProject,
  cashOutProject,
  cashOutAllProjects,
  purchaseViews,
  getAllAds,
  getTotalActiveAds,
  getTotalViewsForProject,
  getTotalViewsForAllProjects,
  getRemainingViewsForAd,
  getRemainingViewsForAllAds,
  verifyPassword,
  getMyAdsLite,
  recordViewWithToken,
  // ICP Ledger
  initLedgerActorUnauthenticated,
  initLedgerActorWithPlug,
  initLedgerActorWithInternetIdentity,
  ledger_balanceOf,
  ledger_transfer,
  // === NEW: custodian calls we just defined ===
  custodian_verifyPassword,
  custodianActor,
  initCustodianActorUnauthenticated,
  initCustodianActorWithPlug,
  initCustodianActorWithInternetIdentity,
  custodian_addHighScore,
  custodian_getHighScores,
  custodian_resetHighScores,
  custodian_transferTokens,
  initHighScoreActorUnauthenticated,
  highScore_getHighScores,
  // ICP Transfer
  initIcpTransferActorUnauthenticated,
  initIcpTransferActorWithPlug,
  initIcpTransferActorWithInternetIdentity,
  icpTransfer_recordDeposit,
  icpTransfer_withdraw,
  icpTransfer_getBalanceOf,
  icpTransfer_getMyBalance,
  // Principals
  AuthClient,
  Principal
} from "./ic_ad_network_bundle.js";

let authMethod = null; // "Plug" | "InternetIdentity" | null
let runtimeGlobal;
let messageQueue = [];
let isDisplayingMessage = false;

// We assume 8 decimals for ICP
const DECIMALS = 8;

// ---- use the *global* Construct‑3 variable -----------------
function paymentInProgress() {
  return runtimeGlobal?.globalVars.isPaymentInProgress === 1;
}
function setPaymentFlag(on) {
  if (runtimeGlobal) runtimeGlobal.globalVars.isPaymentInProgress = on ? 1 : 0;
}

// We'll store the setTimeout ID in this variable
let adViewTimeoutId = null;

function stringifyWithBigInt(obj) {
  return JSON.stringify(obj, (k, v) => (typeof v === "bigint" ? v.toString() : v));
}

function setStatusMessage(msg) {
  messageQueue.push(msg);
  displayNextMessage();
}
window.setStatusMessage = setStatusMessage;

async function displayNextMessage() {
  if (isDisplayingMessage) return;
  if (!messageQueue.length) return;
  isDisplayingMessage = true;
  const msg = messageQueue.shift();
  runtimeGlobal.globalVars.StatusMessage = msg;
  await new Promise((r) => setTimeout(r, 5000));
  runtimeGlobal.globalVars.StatusMessage = "";
  isDisplayingMessage = false;
  displayNextMessage();
}

/** ===== Sprite feedback on Pay Now / No Thanks ===== */
function setPayButtonState(state /* "idle" | "processing" */) {
  if (!runtimeGlobal?.objects.Sprite_PayNow) return;
  const inst = runtimeGlobal.objects.Sprite_PayNow.getFirstInstance();
  if (!inst) return;

  if (state === "processing") {
    inst.opacity = 0.5;
    if (inst.animationName !== "Pressed")
      inst.animationName = "Pressed";
  } else {
    inst.opacity = 1;
    if (inst.animationName !== "Idle")
      inst.animationName = "Idle";
  }
}
window.setPayButtonState = setPayButtonState;

function ns2DateString(ns) {
  if (!ns) return "—";
  const ms = Number(ns / 1_000_000n);
  return new Date(ms).toLocaleString();
}

self.incRoundCounters = async function () {
  if (!window.custodianActor) {
    setStatusMessage("custodianActor not ready – round not counted");
    return;
  }
  try {
    // canister mutates its internal counters
    await window.custodianActor.incRoundCounters();

    // pull the fresh numbers back into C3 globals
    await self.refreshWinStats();
  } catch (err) {
    console.error("incRoundCounters:", err);
    setStatusMessage("Error incrementing round counters: " + err.message);
  }
};
window.incRoundCounters = self.incRoundCounters;

self.recordDuckWin = async function (duckType, amountIn) {
  let e8s;                         // ── normalised Nat64 value (ICP × 1e8)

  try {
    /* ── 1. direct bigint ─────────────────────────────────────────── */
    if (typeof amountIn === "bigint") {
      e8s = amountIn;

      /* ── 2. top-level object {e8s}|{Ok}|{amount} ─────────────────── */
    } else if (amountIn && typeof amountIn === "object") {
      if ("e8s" in amountIn) e8s = BigInt(amountIn.e8s);
      else if ("amount" in amountIn) e8s = BigInt(amountIn.amount);

      /* 2b. nested { Ok : {e8s} } coming from candid variants */
      else if ("Ok" in amountIn) {
        const ok = amountIn.Ok;
        if (typeof ok === "bigint") e8s = ok;
        else if (ok && typeof ok === "object" && "e8s" in ok)
          e8s = BigInt(ok.e8s);
      }
    }

    /* ── 3. fallback: boolean or unknown → read pot from globals ──── */
    if (e8s === undefined && amountIn === true) {
      const potVar = duckType === "Gold" ? "GoldPot" : "SilverPot";
      const potIcp = runtimeGlobal?.globalVars?.[potVar];
      if (typeof potIcp === "number" && potIcp > 0)
        e8s = BigInt(Math.round(potIcp * 1e8));      // ICP → e8s
    }

  } catch (parseErr) {
    console.warn("recordDuckWin() parse error:", parseErr);
  }

  /* ── still nothing? abort with warning ─────────────────────────── */
  if (e8s === undefined) {
    console.warn("recordDuckWin → could not parse amount from", amountIn);
    setStatusMessage("⚠️ Could not determine win amount – not recorded.");
    return;
  }

  /* ── call canister ─────────────────────────────────────────────── */
  try {
    await window.custodianActor.recordDuckWin(duckType, e8s);
    setStatusMessage(`${duckType} win (${Number(e8s) / 1e8} ICP) recorded!`);
  } catch (err) {
    console.error("recordDuckWin:", err);
    setStatusMessage("Could not record win: " + err.message);
  }
};
window.recordDuckWin = self.recordDuckWin;

self.refreshWinStats = async function () {
  if (!runtimeGlobal || !window.custodianActor) return;

  try {
    const stats = await custodianActor.getWinStats();

    /* ▶▶ NEW: reverse order so newest entry is first */
    const winsOriginal = await custodianActor.getRecentWins();   // oldest→newest
    const wins = winsOriginal.slice().reverse();                 // newest→oldest

    /* push numeric stats straight through */
    const g = runtimeGlobal.globalVars;
    g.RoundsSinceGoldWin   = stats.roundsSinceGoldWin;
    g.RoundsSinceSilverWin = stats.roundsSinceSilverWin;
    g.LastGoldWinTs        = ns2DateString(stats.lastGoldWinTs);
    g.LastSilverWinTs      = ns2DateString(stats.lastSilverWinTs);

    /* build printable log (top = newest) */
    g.RecentWinsJson = wins
      .map((w, i) => {
        // normalise amount
        const raw   = typeof w.amount === "object" && "e8s" in w.amount
                    ? Number(w.amount.e8s)
                    : Number(w.amount);
        const icp   = (raw / 1e8).toFixed(2);
        const short = w.pid.toText().slice(0, 5) + "…" + w.pid.toText().slice(-5);
        return `${i + 1}. ${w.duckType.padEnd(6)} ${icp} ICP — ${short} @ ${ns2DateString(w.ts)}`;
      })
      .join("\n");   // Construct 3 Text object understands “\n”
  }
  catch (err) {
    console.error("refreshWinStats:", err);
    setStatusMessage("Stats refresh error: " + err.message);
  }
};


self.copyPrincipal = async function () {
  try {
    const textToCopy = runtimeGlobal.globalVars.currentPrincipal;
    if (!textToCopy) {
      setStatusMessage("No Principal found to copy.");
      return;
    }
    await navigator.clipboard.writeText(textToCopy);
    setStatusMessage("Principal copied to clipboard!");
  } catch (err) {
    console.error("Copy to clipboard error:", err);
    setStatusMessage("Error copying to clipboard: " + err.message);
  }
};

window.copyPrincipalToClipboard = self.copyPrincipal;

/** =========== LOGOUT FUNCTION =========== */
self.logout = async function () {
  try {
    // If using Internet Identity, remove the session
    if (authMethod === "InternetIdentity" && window.authClient) {
      await window.authClient.logout();
    }
    // If using Plug, you can optionally do:
    if (authMethod === "Plug" && window.ic && window.ic.plug && window.ic.plug.requestDisconnect) {
      await window.ic.plug.requestDisconnect();
    }

    // Now reset everything to "Unauthenticated"
    authMethod = null;
    runtimeGlobal.globalVars.AuthState = "Unauthenticated";
    runtimeGlobal.globalVars.Authenticated = 0;
    runtimeGlobal.globalVars.currentPrincipal = "";

    setStatusMessage("Logged out successfully.");
  } catch (err) {
    console.error("Logout error:", err);
    setStatusMessage("Error logging out: " + err.message);
  }
};


/** =========== Initialize ICP Transfer actor =========== */
self.initIcpTransferActor = async function () {
  // If you want an anonymous init at startup:
  try {
    await initIcpTransferActorUnauthenticated();
    setStatusMessage("ICP Transfer Actor initialized anonymously.");
  } catch (err) {
    setStatusMessage("Error initializing ICP Transfer: " + err.message);
  }
};

/** If you want a Plug version: */
self.initIcpTransferWithPlug = async function () {
  try {
    const ok = await initIcpTransferActorWithPlug();
    if (!ok) {
      setStatusMessage("ICP Transfer Actor: Plug not found or user refused.");
      return;
    }
    setStatusMessage("ICP Transfer Actor init with Plug success!");
  } catch (err) {
    setStatusMessage("Error initializing ICP Transfer with Plug: " + err.message);
  }
};

/** =========== Anonymous init at startup =========== */
self.initAdNetworkActor = async function () {
  if (authMethod) {
    setStatusMessage(`Already authenticated with ${authMethod}.`);
    return;
  }
  try {
    await initActorUnauthenticated();
    runtimeGlobal.globalVars.AuthState = "Unauthenticated";
    setStatusMessage("AdNetwork Actor initialized anonymously.");

    await initLedgerActorUnauthenticated();
    await initCustodianActorUnauthenticated();
  } catch (err) {
    console.error(err);
    runtimeGlobal.globalVars.AuthState = "Unauthenticated";
    setStatusMessage("Error initializing AdNetwork: " + err.message);
  }
};

/** =========== Connect with Plug =========== */
self.initAdNetworkWithPlug = async function () {
  if (!runtimeGlobal) return;

  // If user is currently Internet Identity, auto-logout first
  if (authMethod === "InternetIdentity") {
    setStatusMessage("Already authenticated with Internet Identity. Logging out first...");
    await self.logout();
  }

  try {
    // Instead of multiple requestConnect calls, just do one:
    const ok = await window.initAllWithPlug();
    if (!ok) {
      runtimeGlobal.globalVars.AuthState = "Unauthenticated";
      setStatusMessage("Could not connect with Plug (user refused or not installed).");
      return;
    }

    // Now that all actors (adNetworkActor, ledgerActor, custodianActor, etc.)
    // are created, we fetch the user’s principal from Plug:
    const plugPrincipal = await window.ic.plug.agent.getPrincipal();
    runtimeGlobal.globalVars.currentPrincipal = plugPrincipal.toText();
    runtimeGlobal.globalVars.AuthState = "Plug";
    authMethod = "Plug";

    // Mark user as Authenticated
    runtimeGlobal.globalVars.Authenticated = 1;

    setStatusMessage("All canisters initialized via single Plug approval!");
    self.cancelAdViewTimeout();

    // If you have some tracking data to fetch now that the user is authenticated:
    await self.fetchTrackingData();

  } catch (err) {
    console.error(err);
    runtimeGlobal.globalVars.AuthState = "Unauthenticated";
    setStatusMessage("Error initializing with Plug: " + err.message);
  }
};


/** =========== Connect with Internet Identity =========== */
self.initAdNetworkWithII = async function () {
  if (!runtimeGlobal) return;

  // If user is currently Plug, auto-logout first
  if (authMethod === "Plug") {
    setStatusMessage("Already authenticated with Plug. Logging out first...");
    await self.logout();
    // Now proceed with Internet Identity
  }

  try {
    await initActorWithInternetIdentity();
    await initLedgerActorWithInternetIdentity();
    await initCustodianActorWithInternetIdentity();
    await initIcpTransferActorWithInternetIdentity();

    const identity = getCurrentIdentity();
    if (identity && identity.getPrincipal) {
      const p = identity.getPrincipal();
      runtimeGlobal.globalVars.currentPrincipal = p.toText();
      runtimeGlobal.globalVars.AuthState = "InternetIdentity";
      authMethod = "InternetIdentity";

      // Mark user as Authenticated
      runtimeGlobal.globalVars.Authenticated = 1;

      setStatusMessage("AdNetwork + ICP Ledger + Custodian + ICP Transfer init via Internet Identity!");
      self.cancelAdViewTimeout();
      await self.fetchTrackingData();
    } else {
      runtimeGlobal.globalVars.AuthState = "Unauthenticated";
      setStatusMessage("Error retrieving identity after login. Possibly not authenticated?");
    }
  } catch (err) {
    console.error(err);
    runtimeGlobal.globalVars.AuthState = "Unauthenticated";
    setStatusMessage("Error initializing with Internet Identity: " + err.message);
  }
};

/* ───────────────────────────── */
/*  PAYMENT FLOW                 */
/* ───────────────────────────── */
self.depositIcpForUser = async function () {
  if (!runtimeGlobal || paymentInProgress()) return;

  if (!authMethod) {                // new guard
    setStatusMessage("Please connect Plug or Internet Identity first!");
    return;
  }

  setPaymentFlag(true);
  setPayButtonState("processing");

  try {
    /* amount & principals */
    const depositAmountE8s = 5_000_000n;  // 0.05 ICP
    const principalString = runtimeGlobal.globalVars.currentPrincipal;
    const user = Principal.fromText(principalString);

    /* 1. Transfer over Ledger */
    setStatusMessage("Requesting ledger transfer (0.05 ICP) …");
    const transferResult = await ledger_transfer({
      fromSubaccount: null,
      toPrincipal: Principal.fromText("sphs3-ayaaa-aaaah-arajq-cai"),
      toSubaccount: null,
      amount: depositAmountE8s,
    });

    if ("Err" in transferResult) {
      setStatusMessage("Ledger transfer failed: " + JSON.stringify(transferResult.Err));
      throw new Error("Ledger transfer failed");
    }

    const blockIndex = transferResult.Ok;
    setStatusMessage("Ledger transfer ✓ (block #" + blockIndex + "). Waiting for confirmation…");

    /* 2. Retry recordDeposit for up to 5 × 3 s */
    const maxRetries = 10;
    let attempt = 0;
    let success = false;

    while (attempt < maxRetries && !success) {
      success = await icpTransfer_recordDeposit(user, depositAmountE8s, blockIndex);
      if (!success) {
        await new Promise(r => setTimeout(r, 5000));
        attempt++;
      }
    }

    if (success) {
      setStatusMessage("Deposit confirmed – starting game!");
      runtimeGlobal.callFunction("OnPaymentSuccess");
    } else {
      setStatusMessage("Couldn’t confirm deposit – please tap again.");
      setPayButtonState("idle");
    }

  } catch (err) {
    console.error("depositIcpForUser:", err);
    setStatusMessage("Deposit error: " + err.message);
    setPayButtonState("idle");
  }

  setPaymentFlag(false);
};

/** =========== Withdraw from the canister =========== */
self.withdrawIcp = async function () {
  if (!runtimeGlobal) return;
  try {
    // Example: user withdraws 0.5 ICP => 50_000_000 e8s
    const withdrawE8s = 500_000n;
    setStatusMessage(`Withdrawing ${withdrawE8s} e8s from the canister...`);
    const result = await icpTransfer_withdraw(withdrawE8s);
    if ("Ok" in result) {
      const blockIndex = result.Ok;
      setStatusMessage("Withdrawal success! blockIndex = " + blockIndex);
    } else {
      setStatusMessage("Withdrawal error: " + result.Err);
    }
  } catch (err) {
    console.error("withdrawIcp error:", err);
    setStatusMessage("Error calling withdraw: " + err.message);
  }
};

/** =========== Check balances =========== */
self.checkMyIcpTransferBalance = async function () {
  try {
    const bal = await icpTransfer_getMyBalance();
    setStatusMessage(`Your deposit balance is ${bal.toString()} e8s (ICP).`);
  } catch (err) {
    setStatusMessage("Error fetching my ICP Transfer balance: " + err.message);
  }
};

self.checkUserIcpTransferBalance = async function () {
  if (!runtimeGlobal) return;
  try {
    const principalStr = runtimeGlobal.globalVars.SomeOtherPrincipal;
    const userPrincipal = Principal.fromText(principalStr);
    const bal = await icpTransfer_getBalanceOf(userPrincipal);
    setStatusMessage(`Balance of user ${principalStr} is ${bal} e8s.`);
  } catch (err) {
    setStatusMessage("Error fetching user ICP Transfer balance: " + err.message);
  }
};

/** =========== FETCH NEXT AD =========== */
self.fetchNextAd = async function () {
  if (!runtimeGlobal) return;
  try {
    const pid = runtimeGlobal.globalVars.projectId;
    const adType = runtimeGlobal.globalVars.AdTypeInput || "";

    const result = await getNextAd(pid, adType);
    if (!result || result.length === 0) {
      // 1) Show a message
      setStatusMessage("No ads available right now. Skipping ad...");
      // 2) Reset your ad variables
      runtimeGlobal.globalVars.CurrentAdBase64 = "";
      runtimeGlobal.globalVars.CurrentAdClickUrl = "";
      // 3) Return the game to "Play" or do your own logic
      runtimeGlobal.globalVars.Game_Status = "Play";

      // Optionally call a Construct function or an event var
      // to close the black overlay, hide the "Ad" group, etc.
      // E.g.:
      runtime.callFunction("CloseAdLayer");

      return;
    }

    // If we do have an ad:
    const [ad, tokenId] = result;
    runtimeGlobal.globalVars.CurrentAdBase64 = ad.imageBase64;
    runtimeGlobal.globalVars.CurrentAdClickUrl = ad.clickUrl;
    setStatusMessage(`Fetched Ad #${ad.id} (served: ${ad.viewsServed}), token: ${tokenId}`);

    // (The rest of your existing code stays the same)
    if (adViewTimeoutId !== null) {
      clearTimeout(adViewTimeoutId);
      adViewTimeoutId = null;
    }

    adViewTimeoutId = setTimeout(async () => {
      try {
        const success = await recordViewWithToken(tokenId);
        if (success) {
          setStatusMessage(`View for Ad #${ad.id} counted (token ${tokenId}).`);
        } else {
          setStatusMessage(`View for Ad #${ad.id} was NOT counted (too soon or invalid).`);
        }
      } catch (err) {
        console.error("recordViewWithToken error:", err);
        setStatusMessage("Error recording ad view: " + err.message);
      }
      adViewTimeoutId = null;
    }, 5000);

  } catch (err) {
    console.error(err);
    setStatusMessage("fetchNextAd error: " + err.message);

    // If there's an error fetching the ad, skip or close the ad so user isn't stuck
    runtimeGlobal.globalVars.Game_Status = "Play";
    runtime.callFunction("CloseAdLayer");
  }
};


/** =========== Additional calls... =========== */
self.fetchMyAds = async function () { /* ... */ };
self.populateMyAdsList = function () { /* ... */ };
self.topUpAdViews = async function () { /* ... */ };
self.transferTokens = async function () {
  if (!runtimeGlobal) return;
  if (!authMethod) {
    setStatusMessage("Please authenticate first.");
    return;
  }
  try {
    const toPrincipalStr = runtimeGlobal.globalVars.TokenRecipient;
    const toPrincipal = Principal.fromText(toPrincipalStr);
    const decimalAmount = parseFloat(runtimeGlobal.globalVars.TokenAmount) || 0;
    const rawAmount = BigInt(Math.round(decimalAmount * 10 ** DECIMALS));
    const result = await ledger_transfer({
      fromSubaccount: null,
      toPrincipal,
      toSubaccount: null,
      amount: rawAmount,
    });
    if ("Ok" in result) {
      setStatusMessage(`Transfer success! Block index: ${result.Ok}`);
      await self.checkTokenBalance();
    } else {
      setStatusMessage("Transfer error: " + stringifyWithBigInt(result.Err));
    }
  } catch (err) {
    console.error(err);
    setStatusMessage("Error transferring tokens: " + err.message);
  }
};

/** =========== Show user’s ICP balance from the ledger =========== */
self.checkTokenBalance = async function () {
  if (!runtimeGlobal) return;
  if (!authMethod) {
    setStatusMessage("Please authenticate first.");
    return;
  }
  try {
    const principalString = runtimeGlobal.globalVars.currentPrincipal;
    if (!principalString) {
      setStatusMessage("No principal found. Are you authenticated?");
      return;
    }
    const principal = Principal.fromText(principalString);

    // Query the ledger canister for the user's balance:
    const rawBal = await ledger_balanceOf(principal, null);
    const floatBal = Number(rawBal) / 10 ** DECIMALS;
    const displayBalance = floatBal.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: DECIMALS,
    });

    // 1) Store in your Construct global var:
    runtimeGlobal.globalVars.TokenBalance = displayBalance;

    // 2) Update the on-screen Text_Balance object immediately:
    runtimeGlobal.objects.Text_Balance.getFirstInstance().text = "Balance: " + displayBalance + " ICP";

    setStatusMessage(`Balance: ${displayBalance} ICP`);
  } catch (err) {
    console.error("checkTokenBalance error:", err);
    setStatusMessage("Error checking token balance: " + err.message);
  }
};

/****  Win-stat polling (throttled)  ****/
const WIN_STATS_POLL_MS = 30_000;      // 30 s instead of 5 s
let   winStatsIntervalId = null;

function startWinStatsPolling() {
  if (winStatsIntervalId) return;      // already running
  winStatsIntervalId = setInterval(() => {
    if (!runtimeGlobal) return;
    const s = runtimeGlobal.globalVars.Game_Status;
    // only poll while the round is actually running
    if (s === "Play" || s === "Ready") self.refreshWinStats();
  }, WIN_STATS_POLL_MS);
}
function stopWinStatsPolling() {
  if (winStatsIntervalId) {
    clearInterval(winStatsIntervalId);
    winStatsIntervalId = null;
  }
}
window.startWinStatsPolling = startWinStatsPolling;
window.stopWinStatsPolling  = stopWinStatsPolling;


self.cashOutProjectViews = async function (projectId) { /* ... */ };
self.cashOutAllProjectsViews = async function () { /* ... */ };
self.registerProjectInCanister = async function () { /* ... */ };
self.handleImageSelection = async function (fileUrl, orientation = "") { /* ... */ };

// Called automatically by Construct 3 after everything is loaded:
runOnStartup(async (runtime) => {
  // The Construct 3 runtime is passed in here:
  runtimeGlobal = runtime;

  // We do an initial AdNetwork anonymous init so user can remain unauthed if they want:
  await self.initAdNetworkActor();
  await self.initIcpTransferActor();
  await initHighScoreActorUnauthenticated();

  setStatusMessage("Ad Network + ICP Ledger + HighScore main.js loaded successfully.");

  // defer heavy polling – start a throttled loop instead
  startWinStatsPolling();

  /**
   * NOTE:
   *  - You can call `initAdNetworkWithPlug()` or `initAdNetworkWithII()` from your
   *    Construct 3 event sheet at any time to upgrade from anonymous to an authenticated session.
   *  - `runtimeGlobal.globalVars.AuthState` is "Unauthenticated", "Plug", or "InternetIdentity".
   */
});

/** =========== fetchTrackingData =========== */
self.fetchTrackingData = async function () {
  // (unchanged code)
};

/** =========== Single-ad calls... =========== */
self.fetchRemainingViewsForAd = async function (adId) { /* ... */ };
self.fetchTotalViewsForProject = async function (projectId) { /* ... */ };

/** =========== New: calls to the custodian canister =========== */

// A function to submit the user’s high score
self.submitHighScore = async function () {
  if (!runtimeGlobal) return;
  if (!authMethod) {
    setStatusMessage("Please authenticate first, or remain anonymous if allowed!");
    // If your custodian can be called anonymously for addHighScore, that’s fine;
    // but if not, you must authenticate first.
    return;
  }
  try {
    const playerName = runtimeGlobal.globalVars.PlayerNameInput;
    const playerEmail = runtimeGlobal.globalVars.PlayerEmailInput;
    const playerScore = runtimeGlobal.globalVars.Score;
    // or wherever you store the final score

    setStatusMessage(`Submitting high score ${playerScore} for ${playerName}...`);
    const success = await custodian_addHighScore(playerName, playerEmail, playerScore);
    if (success) {
      setStatusMessage("Successfully added high score!");
    } else {
      setStatusMessage("Failed to add high score (the canister returned false).");
    }
  } catch (err) {
    console.error("submitHighScore error:", err);
    setStatusMessage("Error adding high score: " + err.message);
  }
};

// A function to load the high scores
self.loadHighScores = async function () {
  if (!runtimeGlobal) return;
  try {
    console.log("loadHighScores(): about to call highScore_getHighScores() directly...");
    setStatusMessage("Loading high scores (direct) from High Score canister...");
    const allScores = await highScore_getHighScores();
    console.log("loadHighScores(): direct getHighScores returned:", allScores);

    // Store them in globalVars, just like before
    runtimeGlobal.globalVars.HighScoreArray = allScores;
    setStatusMessage("High scores loaded directly!");

  } catch (err) {
    console.error("loadHighScores error:", err);
    setStatusMessage("Error loading high scores: " + err.message);
  }
};

// A function to reset high scores
self.resetHighScores = async function () {
  if (!runtimeGlobal) return;
  try {
    setStatusMessage("Resetting high scores...");
    await custodian_resetHighScores();
    setStatusMessage("High scores reset to empty!");
  } catch (err) {
    console.error("resetHighScores error:", err);
    setStatusMessage("Error resetting high scores: " + err.message);
  }
};

/** Example: a function to do a token transfer via custodian */
self.transferViaCustodian = async function () {
  if (!runtimeGlobal) return;
  if (!authMethod) {
    setStatusMessage("Please authenticate first.");
    return;
  }
  try {
    const toPrincipalStr = runtimeGlobal.globalVars.TokenRecipient;
    const toPrincipal = Principal.fromText(toPrincipalStr);
    const decimalAmount = parseFloat(runtimeGlobal.globalVars.TokenAmount) || 0;
    const rawAmount = BigInt(Math.round(decimalAmount * 10 ** DECIMALS));

    const arg = {
      to_principal: toPrincipal,
      to_subaccount: [],
      amount: { e8s: Number(rawAmount) }
    };
    setStatusMessage(`Calling custodian_transferTokens with ${decimalAmount} ICP...`);

    const result = await custodian_transferTokens(arg);
    // result is an empty record per your canister IDL
    setStatusMessage("Transfer request completed (no error returned).");
  } catch (err) {
    console.error("transferViaCustodian error:", err);
    setStatusMessage("Error calling custodian transfer: " + err.message);
  }
};

/** Cancel ad view if the user changes layouts, etc. */
self.cancelAdViewTimeout = function () {
  if (adViewTimeoutId !== null) {
    clearTimeout(adViewTimeoutId);
    adViewTimeoutId = null;
    setStatusMessage("User left the layout before 5s. No recordView call will happen.");
  }
};


self.checkPassword = async function () {
  if (!runtimeGlobal) return;
  try {
    const input = runtimeGlobal.globalVars.UserInputPassword;
    const ok = await custodian_verifyPassword(input);
    if (ok) {
      runtimeGlobal.globalVars.isBetaTester = true;
      setStatusMessage("Correct password! Entering beta...");
    } else {
      setStatusMessage("Wrong password, please try again.");
    }
  } catch (err) {
    console.error("Error verifying password:", err);
    setStatusMessage("Error verifying password: " + err.message);
  }
};

/////////////////////////////////////////////////
//  POT & LOGS CALLS FOR token_transfer_from_backend_canister
/////////////////////////////////////////////////

self.addToSilverPot = async function (icpAmount) {
  if (!runtimeGlobal) return;
  try {
    // Convert user’s typed amount into e8s
    const rawAmount = BigInt(Math.round(icpAmount * 1e8));
    setStatusMessage(`Adding ${icpAmount} ICP to the SILVER pot...`);
    const result = await window.custodianActor.addToSilverPot(rawAmount);

    if (!result) {
      setStatusMessage("addToSilverPot returned false (not authorized or error).");
    } else {
      setStatusMessage(`Successfully added ${icpAmount} ICP to SILVER pot!`);
    }
  } catch (err) {
    console.error("addToSilverPot error:", err);
    setStatusMessage("Error adding to silver pot: " + err.message);
  }
};

self.addToGoldPot = async function (icpAmount) {
  if (!runtimeGlobal) return;
  try {
    const rawAmount = BigInt(Math.round(icpAmount * 1e8));
    setStatusMessage(`Adding ${icpAmount} ICP to the GOLD pot...`);
    const result = await window.custodianActor.addToGoldPot(rawAmount);

    if (!result) {
      setStatusMessage("addToGoldPot returned false (not authorized or error).");
    } else {
      setStatusMessage(`Successfully added ${icpAmount} ICP to GOLD pot!`);
    }
  } catch (err) {
    console.error("addToGoldPot error:", err);
    setStatusMessage("Error adding to gold pot: " + err.message);
  }
};

self.getSilverPot = async function () {
  if (!runtimeGlobal) return;
  try {
    const e8s = await window.icpTransferActor.getSilverPot();
    const asIcp = Number(e8s) / 1e8;
    runtimeGlobal.globalVars.SilverPot = asIcp;
    setStatusMessage(`Silver Pot: ${asIcp} ICP`);
  } catch (err) {
    console.error("getSilverPot error:", err);
    setStatusMessage("Error fetching Silver Pot: " + err.message);
  }
};

self.getGoldPot = async function () {
  if (!runtimeGlobal) return;
  try {
    const e8s = await window.icpTransferActor.getGoldPot();
    const asIcp = Number(e8s) / 1e8;
    runtimeGlobal.globalVars.GoldPot = asIcp;
    setStatusMessage(`Gold Pot: ${asIcp} ICP`);
  } catch (err) {
    console.error("getGoldPot error:", err);
    setStatusMessage("Error fetching Gold Pot: " + err.message);
  }
};

self.getTotalPot = async function () {
  if (!runtimeGlobal) return;
  try {
    const e8s = await window.icpTransferActor.getTotalPot();
    const asIcp = Number(e8s) / 1e8;
    setStatusMessage(`Total Pot: ${asIcp} ICP`);
  } catch (err) {
    console.error("getTotalPot error:", err);
    setStatusMessage("Error fetching Total Pot: " + err.message);
  }
};

/**
 * Calls `custodianActor.oneIn50k()` to see if we should spawn
 * the golden duck. Returns a boolean: true if it should spawn.
 */
self.checkGoldenDuck = async function () {
  try {
    // custodianActor was stored in window.custodianActor, or simply custodianActor
    if (!window.custodianActor) {
      setStatusMessage("Custodian actor not initialized. No golden duck check.");
      return false;
    }
    const result = await window.custodianActor.oneIn50k();
    console.log("oneIn50k returned =>", result);
    return result;
  } catch (err) {
    console.error("Error calling oneIn50k:", err);
    setStatusMessage("Error checking for golden duck: " + err.message);
    return false;
  }
};

self.checkSilverDuck = async function () {
  try {
    if (!window.custodianActor) {
      setStatusMessage("Custodian actor not initialized. No golden duck check.");
      return false;
    }
    // custodian canister already exposes oneIn100()
    const shouldSpawn = await window.custodianActor.oneIn100();
    console.log("Silver Spawn =>", shouldSpawn);
    return shouldSpawn;
  } catch (err) {
    console.error("checkSilverDuck:", err);
    setStatusMessage("Error checking silver duck: " + err.message);
    return false;
  }
};

self.claimGoldPot = async function () {
  if (!runtimeGlobal) return;
  if (!authMethod) {
    // If you prefer to only allow awarding to authenticated players:
    setStatusMessage("Please authenticate first to claim the gold pot!");
    return;
  }
  try {
    setStatusMessage("Claiming the golden pot...");
    const success = await window.custodianActor.awardGoldPotToCaller();
    if (success) {
      setStatusMessage("Gold pot transferred to your account!");
    } else {
      setStatusMessage("Gold pot awarding failed or pot was zero.");
    }
  } catch (err) {
    console.error("Error awarding gold pot:", err);
    setStatusMessage("Error awarding gold pot: " + err.message);
  }
};

self.resetGoldPotFromCustodian = async function () {
  if (!runtimeGlobal) return;
  if (!authMethod) {
    setStatusMessage("Please authenticate first to call resetGoldPotFromCustodian.");
    return;
  }
  try {
    setStatusMessage("Calling custodianActor.resetGoldPotFromCustodian()...");
    const result = await window.custodianActor.resetGoldPotFromCustodian();
    if (result) {
      setStatusMessage("Successfully reset the gold pot to zero!");
    } else {
      setStatusMessage("Could not reset gold pot. Possibly not authorized or error in canister.");
    }
  } catch (err) {
    console.error("resetGoldPotFromCustodian error:", err);
    setStatusMessage("Error calling resetGoldPotFromCustodian: " + err.message);
  }
};

