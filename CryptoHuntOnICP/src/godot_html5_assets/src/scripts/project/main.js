/*********************************
 * main.js (Construct 3 front end)
 *********************************/

import {
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
  initLedgerActorUnauthenticated,
  initLedgerActorWithPlug,
  initLedgerActorWithInternetIdentity,
  ledger_balanceOf,
  ledger_transfer,
  custodian_verifyPassword,
  custodianActor,
  initCustodianActorUnauthenticated,
  initCustodianActorWithPlug,
  initCustodianActorWithInternetIdentity,
  custodian_addHighScoreSecure,
  custodian_getHighScores,
  custodian_resetHighScores,
  custodian_transferTokens,
  initHighScoreActorUnauthenticated,
  highScore_getHighScores,
  initIcpTransferActorUnauthenticated,
  initIcpTransferActorWithPlug,
  initIcpTransferActorWithInternetIdentity,
  icpTransfer_recordDeposit,
  icpTransfer_withdraw,
  icpTransfer_getBalanceOf,
  icpTransfer_getMyBalance,
  AuthClient,
  Principal
} from "./ic_ad_network_bundle.js";

let authMethod = null; // "Plug" | "InternetIdentity" | null
let runtimeGlobal;
let messageQueue = [];
let isDisplayingMessage = false;

const DECIMALS = 8;

function paymentInProgress() {
  return runtimeGlobal?.globalVars.isPaymentInProgress === 1;
}
function setPaymentFlag(on) {
  if (runtimeGlobal) runtimeGlobal.globalVars.isPaymentInProgress = on ? 1 : 0;
}

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
    const tok = await window.custodianActor.incRoundCounters();
    window.currentRoundToken = tok;
    await self.refreshWinStats();
  } catch (err) {
    console.error("incRoundCounters:", err);
    setStatusMessage("Error incrementing round counters: " + err.message);
  }
};
window.incRoundCounters = self.incRoundCounters;

self.recordDuckWin = async function (duckType) {
  try {
    if (!window.custodianActor) {
      setStatusMessage("Custodian actor not initialized.");
      return false;
    }
    const result = await window.custodianActor.recordDuckWinSecure(
      duckType,
      true,
      window.currentRoundToken
    );
    if (!result) {
      setStatusMessage(`Failed to record ${duckType} duck win: Operation in progress or invalid token.`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`recordDuckWin (${duckType}):`, err);
    setStatusMessage(`Error recording ${duckType} duck win: ${err.message}`);
    return false;
  }
};
window.recordDuckWin = self.recordDuckWin;

self.refreshWinStats = async function () {
  if (!runtimeGlobal || !window.custodianActor) return;

  try {
    const stats = await custodianActor.getWinStats();
    const winsOriginal = await custodianActor.getRecentWins();
    const wins = winsOriginal.slice().reverse();

    const g = runtimeGlobal.globalVars;
    g.RoundsSinceGoldWin   = stats.roundsSinceGoldWin;
    g.RoundsSinceSilverWin = stats.roundsSinceSilverWin;
    g.LastGoldWinTs        = ns2DateString(stats.lastGoldWinTs);
    g.LastSilverWinTs      = ns2DateString(stats.lastSilverWinTs);

    g.RecentWinsJson = wins
      .map((w, i) => {
        const raw   = typeof w.amount === "object" && "e8s" in w.amount
                    ? Number(w.amount.e8s)
                    : Number(w.amount);
        const icp   = (raw / 1e8).toFixed(2);
        const short = w.pid.toText().slice(0, 5) + "…" + w.pid.toText().slice(-5);
        return `${i + 1}. ${w.duckType.padEnd(6)} ${icp} ICP — ${short} @ ${ns2DateString(w.ts)}`;
      })
      .join("\n");
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

self.logout = async function () {
  try {
    if (authMethod === "InternetIdentity" && window.authClient) {
      await window.authClient.logout();
    }
    if (authMethod === "Plug" && window.ic && window.ic.plug && window.ic.plug.requestDisconnect) {
      await window.ic.plug.requestDisconnect();
    }

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

self.initIcpTransferActor = async function () {
  try {
    await initIcpTransferActorUnauthenticated();
    setStatusMessage("ICP Transfer Actor initialized anonymously.");
  } catch (err) {
    setStatusMessage("Error initializing ICP Transfer: " + err.message);
  }
};

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

self.initAdNetworkWithPlug = async function () {
  if (!runtimeGlobal) return;

  if (authMethod === "InternetIdentity") {
    setStatusMessage("Already authenticated with Internet Identity. Logging out first...");
    await self.logout();
  }

  try {
    const ok = await window.initAllWithPlug();
    if (!ok) {
      runtimeGlobal.globalVars.AuthState = "Unauthenticated";
      setStatusMessage("Could not connect with Plug (user refused or not installed).");
      return;
    }

    const plugPrincipal = await window.ic.plug.agent.getPrincipal();
    runtimeGlobal.globalVars.currentPrincipal = plugPrincipal.toText();
    runtimeGlobal.globalVars.AuthState = "Plug";
    authMethod = "Plug";

    runtimeGlobal.globalVars.Authenticated = 1;

    setStatusMessage("All canisters initialized via single Plug approval!");
    self.cancelAdViewTimeout();

    await self.fetchTrackingData();

  } catch (err) {
    console.error(err);
    runtimeGlobal.globalVars.AuthState = "Unauthenticated";
    setStatusMessage("Error initializing with Plug: " + err.message);
  }
};

self.initAdNetworkWithII = async function () {
  if (!runtimeGlobal) return;

  if (authMethod === "Plug") {
    setStatusMessage("Already authenticated with Plug. Logging out first...");
    await self.logout();
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

self.depositIcpForUser = async function () {
  if (!runtimeGlobal || paymentInProgress()) return;

  if (!authMethod) {
    setStatusMessage("Please connect Plug or Internet Identity first!");
    return;
  }

  setPaymentFlag(true);
  setPayButtonState("processing");

  try {
    const depositAmountE8s = 5_000_000n; // 0.05 ICP
    const principalString = runtimeGlobal.globalVars.currentPrincipal;
    const user = Principal.fromText(principalString);

    setStatusMessage("Requesting ledger transfer (0.05 ICP) …");
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
    setStatusMessage(`Ledger transfer ✓ (block #${blockIndex}). Confirming deposit…`);

    const maxRetries = 10;
    let attempt = 0;
    let success = false;

    while (attempt < maxRetries && !success) {
      success = await icpTransfer_recordDeposit(user, depositAmountE8s, blockIndex);
      if (!success) {
        attempt++;
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000); // Exponential backoff, max 10s
        setStatusMessage(`Attempt ${attempt}/${maxRetries} failed. Retrying in ${delay/1000}s…`);
        await new Promise(r => setTimeout(r, delay));
      }
    }

    if (success) {
      setStatusMessage("Deposit confirmed – starting game!");
      runtimeGlobal.callFunction("OnPaymentSuccess");
    } else {
      setStatusMessage(`Deposit failed after ${maxRetries} attempts. Please try again or contact support.`);
      setPayButtonState("idle");
    }

  } catch (err) {
    console.error("depositIcpForUser:", err);
    setStatusMessage("Deposit error: " + err.message);
    setPayButtonState("idle");
  }

  setPaymentFlag(false);
};

self.withdrawIcp = async function () {
  if (!runtimeGlobal) return;
  try {
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

self.fetchNextAd = async function () {
  if (!runtimeGlobal) return;
  try {
    const pid = runtimeGlobal.globalVars.projectId;
    const adType = runtimeGlobal.globalVars.AdTypeInput || "";

    const result = await getNextAd(pid, adType);
    if (!result || result.length === 0) {
      setStatusMessage("No ads available right now. Skipping ad...");
      runtimeGlobal.globalVars.CurrentAdBase64 = "";
      runtimeGlobal.globalVars.CurrentAdClickUrl = "";
      runtimeGlobal.globalVars.Game_Status = "Play";
      runtime.callFunction("CloseAdLayer");
      return;
    }

    const [ad, tokenId] = result;
    runtimeGlobal.globalVars.CurrentAdBase64 = ad.imageBase64;
    runtimeGlobal.globalVars.CurrentAdClickUrl = ad.clickUrl;
    setStatusMessage(`Fetched Ad #${ad.id} (served: ${ad.viewsServed}), token: ${tokenId}`);

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
    runtimeGlobal.globalVars.Game_Status = "Play";
    runtime.callFunction("CloseAdLayer");
  }
};

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

    const rawBal = await ledger_balanceOf(principal, null);
    const floatBal = Number(rawBal) / 10 ** DECIMALS;
    const displayBalance = floatBal.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: DECIMALS,
    });

    runtimeGlobal.globalVars.TokenBalance = displayBalance;
    runtimeGlobal.objects.Text_Balance.getFirstInstance().text = "Balance: " + displayBalance + " ICP";

    setStatusMessage(`Balance: ${displayBalance} ICP`);
  } catch (err) {
    console.error("checkTokenBalance error:", err);
    setStatusMessage("Error checking token balance: " + err.message);
  }
};

const WIN_STATS_POLL_MS = 30_000;
let winStatsIntervalId = null;

function startWinStatsPolling() {
  if (winStatsIntervalId) return;
  winStatsIntervalId = setInterval(() => {
    if (!runtimeGlobal) return;
    const s = runtimeGlobal.globalVars.Game_Status;
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

runOnStartup(async (runtime) => {
  runtimeGlobal = runtime;

  await self.initAdNetworkActor();
  await self.initIcpTransferActor();
  await initHighScoreActorUnauthenticated();

  setStatusMessage("Ad Network + ICP Ledger + HighScore main.js loaded successfully.");

  startWinStatsPolling();
});

self.fetchTrackingData = async function () {
  // (unchanged code)
};

self.fetchRemainingViewsForAd = async function (adId) { /* ... */ };
self.fetchTotalViewsForProject = async function (projectId) { /* ... */ };

self.submitHighScore = async function () {
  if (!runtimeGlobal) return;
  if (!authMethod) {
    setStatusMessage("Please authenticate first!");
    return;
  }

  try {
    const name   = runtimeGlobal.globalVars.PlayerNameInput;
    const email  = runtimeGlobal.globalVars.PlayerEmailInput;
    const score  = runtimeGlobal.globalVars.Score;
    const token  = window.currentRoundToken;

    setStatusMessage(`Submitting secure high score ${score}…`);

    const ok = await custodian_addHighScoreSecure(name, email, score, token);
    if (ok) setStatusMessage("High score accepted!");
    else    setStatusMessage("High score rejected (token or score invalid).");

  } catch (err) {
    console.error("submitHighScore:", err);
    setStatusMessage("Error submitting high score: " + err.message);
  }
};

self.loadHighScores = async function () {
  if (!runtimeGlobal) return;
  try {
    console.log("loadHighScores(): about to call highScore_getHighScores() directly...");
    setStatusMessage("Loading high scores (direct) from High Score canister...");
    const allScores = await highScore_getHighScores();
    console.log("loadHighScores(): direct getHighScores returned:", allScores);

    runtimeGlobal.globalVars.HighScoreArray = allScores;
    setStatusMessage("High scores loaded directly!");

  } catch (err) {
    console.error("loadHighScores error:", err);
    setStatusMessage("Error loading high scores: " + err.message);
  }
};

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

self.checkGoldenDuck = async function () {
  try {
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
      setStatusMessage("Custodian actor not initialized. No silver duck check.");
      return false;
    }
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