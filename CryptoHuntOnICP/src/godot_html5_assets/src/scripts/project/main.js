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
  sha256,
  initAllWithPlug,
  AuthClient,
  Principal,
  IcpWallet
} from "./ic_ad_network_bundle.js";

let authMethod = null; // "Plug" | "InternetIdentity" | "OisyWallet" | null
let runtimeGlobal;
let messageQueue = [];
let isDisplayingMessage = false;
let activePromoCodes = [];
let oisyWallet;

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

window.addEventListener('unhandledrejection', function (event) {
  console.error('Unhandled promise rejection:', event.reason);
  setStatusMessage('An error occurred: ' + (event.reason.message || event.reason));
});

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

self.initOisyWallet = async function () {
  if (!runtimeGlobal) return;

  if (authMethod && authMethod !== "OisyWallet") {
    setStatusMessage(`Already authenticated with ${authMethod}. Logging out first...`);
    await self.logout();
  }

  try {
    setStatusMessage("Connecting to Oisy Wallet...");
    oisyWallet = await IcpWallet.connect({
      url: 'https://oisy.com/sign', // Production Oisy Wallet signer URL
    });

    setStatusMessage("Connected to Oisy Wallet. Requesting permissions...");
    const { allPermissionsGranted } = await oisyWallet.requestPermissionsNotGranted();
    if (!allPermissionsGranted) {
      setStatusMessage("Permissions not granted by Oisy Wallet.");
      runtimeGlobal.globalVars.AuthState = "Unauthenticated";
      return;
    }

    const accounts = await oisyWallet.accounts();
    if (!accounts || accounts.length === 0) {
      setStatusMessage("No accounts found in Oisy Wallet.");
      runtimeGlobal.globalVars.AuthState = "Unauthenticated";
      return;
    }

    const account = accounts[0];

    // Handle account.owner based on its type
    if (typeof account.owner === "string") {
      runtimeGlobal.globalVars.currentPrincipal = account.owner;
    } else if (account.owner && typeof account.owner.toText === "function") {
      runtimeGlobal.globalVars.currentPrincipal = account.owner.toText();
    } else {
      console.error("Unexpected type for account.owner:", account.owner);
      setStatusMessage("Error: Unexpected account owner type.");
      runtimeGlobal.globalVars.AuthState = "Unauthenticated";
      return;
    }

    runtimeGlobal.globalVars.AuthState = "OisyWallet";
    authMethod = "OisyWallet";
    runtimeGlobal.globalVars.Authenticated = 1;

    setStatusMessage("Authenticated with Oisy Wallet!");
    await self.fetchTrackingData();
  } catch (err) {
    console.error("initOisyWallet error:", err);
    setStatusMessage("Error connecting to Oisy Wallet: " + err.message);
    runtimeGlobal.globalVars.AuthState = "Unauthenticated";
  }
};
window.initOisyWallet = self.initOisyWallet;

function setPayButtonState(state /* "idle" | "processing" */) {
  if (!runtimeGlobal?.objects.Sprite_PayNow) return;
  const inst = runtimeGlobal.objects.Sprite_PayNow.getFirstInstance();
  if (!inst) return;

  if (state === "processing") {
    inst.opacity = 0.5;
    if (inst.animation.name !== "Pressed")
      inst.setAnimation("Pressed");
  } else {
    inst.opacity = 1;
    if (inst.animation.name !== "Idle")
      inst.setAnimation("Idle");
  }
}
window.setPayButtonState = setPayButtonState;

function ns2DateString(input) {
  let ns;

  if (typeof input === "bigint") {
    ns = input;
  }
  else if (Array.isArray(input)) {
    if (input.length === 0) {
      return "—";
    } else if (input.length === 1 && typeof input[0] === "bigint") {
      ns = input[0];
    } else {
      console.error("ns2DateString: Invalid array input:", input);
      return "Invalid timestamp";
    }
  }
  else {
    console.error("ns2DateString: Expected BigInt or array, got:", input);
    return "Invalid timestamp";
  }

  if (ns === 0n) {
    return "—";
  }

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
    if (authMethod === "OisyWallet" && oisyWallet) {
      const result = await oisyWallet.icrc49CallCanister({
        canisterId: "z5cfx-3yaaa-aaaam-aee3a-cai", // Custodian canister ID
        method: "recordDuckWinSecure",
        args: [duckType, true, window.currentRoundToken],
      });
      if ("Ok" in result) {
        setStatusMessage(`${duckType} duck win recorded with Oisy Wallet!`);
        return true;
      } else {
        setStatusMessage(`Failed to record ${duckType} duck win: ${JSON.stringify(result.Err)}`);
        return false;
      }
    } else {
      const result = await window.custodianActor.recordDuckWinSecure(
        duckType,
        true,
        window.currentRoundToken
      );
      if (!result) {
        setStatusMessage(`Failed to record ${duckType} duck win: Operation in progress or invalid token`);
        return false;
      }
      return true;
    }
  } catch (err) {
    console.error(`recordDuckWin (${duckType}):`, err);
    setStatusMessage(`Error recording ${duckType} duck win: ${err.message}`);
    return false;
  }
};
window.recordDuckWin = self.recordDuckWin;

self.getGoldDuckOdds = async function () {
  if (!window.custodianActor) {
    setStatusMessage("Custodian actor not initialized.");
    return 0;
  }
  try {
    const odds = await window.custodianActor.getGoldDuckOdds();
    return parseFloat(odds);
  } catch (err) {
    console.error("getGoldDuckOdds error:", err);
    setStatusMessage("Error fetching gold duck odds: " + err.message);
    return 0;
  }
};

self.getSilverDuckOdds = async function () {
  if (!window.custodianActor) {
    setStatusMessage("Custodian actor not initialized.");
    return 0;
  }
  try {
    const odds = await window.custodianActor.getSilverDuckOdds();
    return parseFloat(odds);
  } catch (err) {
    console.error("getSilverDuckOdds error:", err);
    setStatusMessage("Error fetching silver duck odds: " + err.message);
    return 0;
  }
};

self.getCurrentAverageRounds = async function () {
  if (!runtimeGlobal || !window.custodianActor) return 0;
  try {
    const avg = await window.custodianActor.getCurrentAverageRounds();
    runtimeGlobal.globalVars.AverageRounds = parseFloat(avg);
    return parseFloat(avg);
  } catch (err) {
    console.error("getCurrentAverageRounds error:", err);
    setStatusMessage("Error fetching average rounds: " + err.message);
    return 0;
  }
};

self.updateDuckOdds = async function () {
  const goldOdds = await self.getGoldDuckOdds();
  const silverOdds = await self.getSilverDuckOdds();
  const avgRounds = await self.getCurrentAverageRounds();
  console.log("Updated odds - Gold:", goldOdds, "Silver:", silverOdds, "Avg Rounds:", avgRounds);
  runtimeGlobal.globalVars.GoldDuckOdds = goldOdds;
  runtimeGlobal.globalVars.SilverDuckOdds = silverOdds;
  runtimeGlobal.globalVars.AverageRounds = avgRounds;
};

self.recordGameEnd = async function () {
  if (!runtimeGlobal || !window.custodianActor) return;
  try {
    await window.custodianActor.recordGameEnd();
    console.log("Game end recorded successfully.");
    await self.updateDuckOdds();
  } catch (err) {
    console.error("recordGameEnd error:", err);
    setStatusMessage("Error recording game end: " + err.message);
  }
};
window.recordGameEnd = self.recordGameEnd;

self.refreshWinStats = async function () {
  if (!runtimeGlobal || !window.custodianActor) return;

  try {
    const stats = await custodianActor.getWinStats();
    const winsOriginal = await custodianActor.getRecentWins();
    const wins = winsOriginal.slice().reverse().filter(win => win.duckType === "Gold" || win.duckType === "Silver");

    const g = runtimeGlobal.globalVars;
    g.RoundsSinceGoldWin = stats.roundsSinceGoldWin;
    g.RoundsSinceSilverWin = stats.roundsSinceSilverWin;
    g.LastGoldWinTs = ns2DateString(stats.lastGoldWinTs);
    g.LastSilverWinTs = ns2DateString(stats.lastSilverWinTs);

    g.RecentWinsJson = wins
      .map((w, i) => {
        const raw = typeof w.amount === "object" && "e8s" in w.amount
          ? Number(w.amount.e8s)
          : Number(w.amount);
        const icp = (raw / 1e8).toFixed(2);
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
    if (authMethod === "OisyWallet" && oisyWallet) {
      oisyWallet.disconnect();
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
    console.log("icpTransferActor initialized:", window.icpTransferActor);
    setStatusMessage("ICP Transfer Actor initialized anonymously.");
  } catch (err) {
    console.error("initIcpTransferActor error:", err);
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

  if (authMethod === "InternetIdentity" || authMethod === "OisyWallet") {
    setStatusMessage(`Already authenticated with ${authMethod}. Logging out first...`);
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
    console.log("authMethod set to:", authMethod);

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

  if (authMethod === "Plug" || authMethod === "OisyWallet") {
    setStatusMessage(`Already authenticated with ${authMethod}. Logging out first...`);
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
    runtimeGlobal.callFunction("ShowPaymentError", "Please connect your wallet first.");
    setPayButtonState("idle");
    setPaymentFlag(false);
    return;
  }

  setPaymentFlag(true);
  setPayButtonState("processing");

  try {
    const depositAmountE8s = 5_000_000n; // 0.05 ICP
    const principalString = runtimeGlobal.globalVars.currentPrincipal;
    const user = Principal.fromText(principalString);

    if (authMethod === "OisyWallet") {
      if (!oisyWallet) throw new Error("Oisy Wallet not initialized");

      setStatusMessage("Processing payment with Oisy Wallet...");
      const accounts = await oisyWallet.accounts();
      if (!accounts || accounts.length === 0) throw new Error("No accounts found in Oisy Wallet");
      const account = accounts[0];
      const toPrincipal = Principal.fromText("sphs3-ayaaa-aaaah-arajq-cai"); // Token transfer canister
      const request = {
        to: {
          owner: toPrincipal,
          subaccount: [], // Use empty array instead of null
        },
        amount: depositAmountE8s,
      };
      let blockIndex;
      try {
        blockIndex = await oisyWallet.icrc1Transfer({
          owner: account.owner,
          request
        });
        setStatusMessage(`Payment successful! Block index: ${blockIndex}`);
        runtimeGlobal.callFunction("OnPaymentSuccess");
        confirmDepositAsync(user, depositAmountE8s, blockIndex);
      } catch (err) {
        throw new Error(`Payment failed: ${err.message}`);
      }
    } else {
      setStatusMessage("Requesting ledger transfer (0.05 ICP) …");
      const transferResult = await ledger_transfer({
        fromSubaccount: null,
        toPrincipal: Principal.fromText("sphs3-ayaaa-aaaah-arajq-cai"),
        toSubaccount: null,
        amount: depositAmountE8s,
      });

      if ("Err" in transferResult) {
        let errorMessage = "Payment failed: " + JSON.stringify(transferResult.Err);
        runtimeGlobal.callFunction("ShowPaymentError", errorMessage);
        setPayButtonState("idle");
        throw new Error("Ledger transfer failed");
      }

      const blockIndex = transferResult.Ok;
      setStatusMessage(`Ledger transfer ✓ (block #${blockIndex}). Starting game…`);
      runtimeGlobal.callFunction("OnPaymentSuccess");
      confirmDepositAsync(user, depositAmountE8s, blockIndex);
    }
  } catch (err) {
    console.error("depositIcpForUser:", err);
    runtimeGlobal.callFunction("ShowPaymentError", "Deposit error: " + err.message);
    setPayButtonState("idle");
  } finally {
    setPaymentFlag(false);
  }
};

async function confirmDepositAsync(user, amount, blockIndex) {
  const maxRetries = 10;
  let attempt = 0;
  let success = false;

  while (attempt < maxRetries && !success) {
    try {
      const depositPromise = icpTransfer_recordDeposit(user, amount, blockIndex);
      const depositTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Deposit confirmation timed out after 10s")), 10000)
      );
      success = await Promise.race([depositPromise, depositTimeout]);
      if (success) {
        setStatusMessage("Deposit confirmed successfully!");
        console.log(`Deposit confirmed at attempt ${attempt + 1}`);
      }
    } catch (retryErr) {
      console.error(`Deposit attempt ${attempt + 1} failed:`, retryErr);
      attempt++;
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        setStatusMessage(`Deposit attempt ${attempt}/${maxRetries} failed. Retrying in ${delay / 1000}s…`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  if (!success) {
    console.error("All deposit confirmation attempts failed.");
    setStatusMessage("Deposit confirmation failed after retries. Contact support if issues persist.");
  }
}

self.validatePromoCode = async function () {
  if (!runtimeGlobal || paymentInProgress()) return;
  if (!authMethod) {
    setStatusMessage("Please authenticate first!");
    return;
  }

  setPaymentFlag(true);
  setPayButtonState("processing");

  const promoInput = runtimeGlobal.objects.PromoCodeInput.getFirstInstance();
  if (!promoInput) {
    console.error("PromoCodeInput instance not found");
    setStatusMessage("Promo code input object not found!");
    setPaymentFlag(false);
    setPayButtonState("idle");
    return;
  }

  const code = promoInput.text.trim();
  if (!code) {
    console.log("No promo code entered");
    setStatusMessage("Please enter a promo code.");
    setPaymentFlag(false);
    setPayButtonState("idle");
    runtimeGlobal.callFunction("OnPromoCodeInvalid");
    return;
  }

  if (!window.custodianActor) {
    console.error("custodianActor not initialized");
    setStatusMessage("Custodian actor not initialized.");
    setPaymentFlag(false);
    setPayButtonState("idle");
    runtimeGlobal.callFunction("OnPromoCodeInvalid");
    return;
  }

  try {
    setStatusMessage("Validating promo code...");
    console.log("Calling validatePromoCode with code:", code);

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Promo code validation timed out")), 10000);
    });

    const isValid = await Promise.race([
      window.custodianActor.validatePromoCode(code),
      timeoutPromise,
    ]);

    console.log("validatePromoCode result:", isValid);

    if (isValid) {
      setStatusMessage("Promo code accepted! Starting game...");
      runtimeGlobal.callFunction("OnPaymentSuccess");
    } else {
      console.log("Promo code invalid or already used");
      setStatusMessage("Invalid or used promo code. Please try again or pay to play.");
      setPayButtonState("idle");
      runtimeGlobal.callFunction("OnPromoCodeInvalid");
    }
  } catch (err) {
    console.error("validatePromoCode error:", err);
    setStatusMessage("Error validating promo code: " + err.message);
    setPayButtonState("idle");
    runtimeGlobal.callFunction("OnPromoCodeInvalid");
  } finally {
    setPaymentFlag(false);
    console.log("Payment flag reset to false");
  }
};

self.getActivePromoCodes = async function () {
  if (!window.custodianActor) {
    setStatusMessage("Custodian actor not initialized.");
    return [];
  }
  try {
    const codes = await window.custodianActor.getActivePromoCodes();
    return codes;
  } catch (err) {
    console.error("getActivePromoCodes error:", err);
    setStatusMessage("Error fetching active promo codes: " + err.message);
    return [];
  }
};

self.fetchActivePromoCodes = async function () {
  if (!runtimeGlobal || !window.custodianActor) return;
  try {
    activePromoCodes = await window.custodianActor.getActivePromoCodes();
    runtimeGlobal.globalVars.ActivePromoCodesCount = activePromoCodes.length;
    window.updatePromoCodeList();
    setStatusMessage(`Fetched ${activePromoCodes.length} active promo code(s).`);
  } catch (err) {
    console.error("fetchActivePromoCodes error:", err);
    setStatusMessage("Error fetching active promo codes: " + err.message);
  }
};

window.updatePromoCodeList = function () {
  if (!runtimeGlobal) return;
  const listInstance = runtimeGlobal.objects.PromoCodeList.getFirstInstance();
  if (!listInstance) return;

  const nowMs = Date.now();
  listInstance.clear();
  activePromoCodes.forEach(({ code, expiration }) => {
    const expirationNs = BigInt(expiration);
    const expirationMs = Number(expirationNs / 1_000_000n);
    const remainingMs = expirationMs - nowMs;
    if (remainingMs > 0) {
      const remainingSeconds = Math.floor(remainingMs / 1000);
      const days = Math.floor(remainingSeconds / 86400);
      const hours = Math.floor((remainingSeconds % 86400) / 3600);
      const minutes = Math.floor((remainingSeconds % 3600) / 60);
      const seconds = remainingSeconds % 60;
      const timeStr = `${days}d ${hours}h ${minutes}m ${seconds}s`;
      listInstance.addItem(`${code} - ${timeStr}`);
    } else {
      listInstance.addItem(`${code} - Expired`);
    }
  });
};

self.copyGeneratedPromoCode = async function () {
  const code = runtimeGlobal.globalVars.GeneratedPromoCode;
  if (!code) {
    setStatusMessage("No promo code to copy.");
    return;
  }
  try {
    await navigator.clipboard.writeText(code);
    setStatusMessage("Promo code copied to clipboard!");
  } catch (err) {
    console.error("Copy to clipboard error:", err);
    setStatusMessage("Error copying to clipboard: " + err.message);
  }
};

self.copyAllActivePromoCodes = async function () {
  const codes = activePromoCodes.map(pc => pc.code).join("\n");
  if (!codes) {
    setStatusMessage("No active promo codes to copy.");
    return;
  }
  try {
    await navigator.clipboard.writeText(codes);
    setStatusMessage("All active promo codes copied to clipboard!");
  } catch (err) {
    console.error("Copy to clipboard error:", err);
    setStatusMessage("Error copying to clipboard: " + err.message);
  }
};

self.generatePromoCode = async function () {
  if (!runtimeGlobal || !window.custodianActor) return;
  try {
    const code = await window.custodianActor.generatePromoCode();
    runtimeGlobal.globalVars.GeneratedPromoCode = code;
    setStatusMessage("Generated promo code: " + code);
    activePromoCodes = await window.custodianActor.getActivePromoCodes();
    window.updatePromoCodeList();
  } catch (err) {
    console.error("generatePromoCode error:", err);
    setStatusMessage("Error generating promo code: " + err.message);
  }
};

self.getCanisterBalance = async function () {
  if (!runtimeGlobal) return;
  try {
    const canisterPrincipal = Principal.fromText("sphs3-ayaaa-aaaah-arajq-cai");
    const balanceE8s = await ledger_balanceOf(canisterPrincipal, null);
    const balanceIcp = Number(balanceE8s) / 1e8;
    runtimeGlobal.globalVars.CanisterBalance = balanceIcp;
    setStatusMessage(`Canister Balance: ${balanceIcp.toFixed(4)} ICP`);
  } catch (err) {
    console.error("getCanisterBalance error:", err);
    setStatusMessage("Error fetching canister balance: " + err.message);
  }
};
window.getCanisterBalance = self.getCanisterBalance;

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

  let attempts = 0;
  const maxAttempts = 2;
  let lastAdId = null;

  while (attempts < maxAttempts) {
    try {
      const fetchPromise = getNextAd(runtimeGlobal.globalVars.projectId, runtimeGlobal.globalVars.AdTypeInput || "");
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Ad fetch timed out")), 5000));
      const result = await Promise.race([fetchPromise, timeoutPromise]);

      if (!result || result.length === 0) {
        setStatusMessage(`Attempt ${attempts + 1}: No ads available. Retrying...`);
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      const [ad, tokenId] = result;

      if (lastAdId === ad.id && attempts < maxAttempts - 1) {
        setStatusMessage(`Attempt ${attempts + 1}: Repeated Ad #${ad.id}. Retrying...`);
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      runtimeGlobal.globalVars.CurrentAdBase64 = ad.imageBase64;
      runtimeGlobal.globalVars.CurrentAdClickUrl = ad.clickUrl;
      setStatusMessage(`Fetched Ad #${ad.id} (served: ${ad.viewsServed}), token: ${tokenId}`);

      runtimeGlobal.callFunction("DisplayAd");

      if (adViewTimeoutId !== null) {
        clearTimeout(adViewTimeoutId);
      }

      adViewTimeoutId = setTimeout(async () => {
        try {
          const success = await recordViewWithToken(tokenId);
          if (success) {
            setStatusMessage(`View for Ad #${ad.id} counted (token ${tokenId}).`);
          } else {
            setStatusMessage(`View for Ad #${ad.id} NOT counted (invalid token or timing).`);
          }
        } catch (err) {
          console.error("recordViewWithToken error:", err);
          setStatusMessage("Error recording ad view: " + err.message);
        }
        adViewTimeoutId = null;
      }, 5000);

      lastAdId = ad.id;
      return;

    } catch (err) {
      console.error("fetchNextAd error (attempt " + (attempts + 1) + "):", err);
      setStatusMessage(`Attempt ${attempts + 1} failed: ${err.message}. Retrying...`);
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  setStatusMessage("No ad available after retries. Continuing game...");
  runtimeGlobal.globalVars.CurrentAdBase64 = "";
  runtimeGlobal.callFunction("CloseAdLayer");
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
  setStatusMessage("Processing transfer...");
  try {
    const toPrincipalStr = runtimeGlobal.globalVars.TokenRecipient;
    const toPrincipal = Principal.fromText(toPrincipalStr);
    const decimalAmount = parseFloat(runtimeGlobal.globalVars.TokenAmount) || 0;
    const rawAmount = BigInt(Math.round(decimalAmount * 10 ** DECIMALS));

    let result;
    if (authMethod === "OisyWallet" && oisyWallet) {
      const accounts = await oisyWallet.accounts();
      if (!accounts || accounts.length === 0) throw new Error("No accounts found in Oisy Wallet");
      const account = accounts[0];
      const request = {
        to: {
          owner: toPrincipal,
          subaccount: null,
        },
        amount: rawAmount,
      };
      result = await oisyWallet.icrc1Transfer({
        owner: account.owner,
        request
      });
    } else {
      result = await ledger_transfer({
        fromSubaccount: null,
        toPrincipal,
        toSubaccount: null,
        amount: rawAmount,
      });
    }

    if ("Ok" in result) {
      setStatusMessage(`Transfer success! Block index: ${result.Ok}`);
      const recipientInput = runtimeGlobal.objects.TextInput_Recipient.getFirstInstance();
      if (recipientInput) recipientInput.text = "";
      const amountInput = runtimeGlobal.objects.TextInput_Amount.getFirstInstance();
      if (amountInput) amountInput.text = "";
      runtimeGlobal.callFunction("OnTransferComplete", 1);
    } else {
      setStatusMessage("Transfer error: " + stringifyWithBigInt(result.Err));
      runtimeGlobal.callFunction("OnTransferComplete", 0);
    }
  } catch (err) {
    console.error(err);
    setStatusMessage("Error transferring tokens: " + err.message);
    runtimeGlobal.callFunction("OnTransferComplete", 0);
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

    const textInstance = runtimeGlobal.objects.Text_Balance.getFirstInstance();
    if (textInstance) {
      textInstance.text = displayBalance + " ICP";
    } else {
      console.warn("Text_Balance instance not found on current layout.");
    }

    setStatusMessage(`Balance: ${displayBalance} ICP`);
  } catch (err) {
    console.error("checkTokenBalance error:", err);
    setStatusMessage("Error checking token balance: " + err.message);
  }
};

self.addToGoldPot = async function (amountIcp) {
  if (!runtimeGlobal || !window.icpTransferActor) return;
  if (!authMethod) {
    setStatusMessage("Please authenticate first to add to Gold Pot.");
    return;
  }
  try {
    const amountE8s = BigInt(Math.round(amountIcp * 1e8));
    const success = await window.icpTransferActor.addToGoldPot(amountE8s);
    if (success) {
      setStatusMessage(`Added ${amountIcp} ICP to Gold Pot.`);
      await self.getGoldPot();
    } else {
      setStatusMessage("Failed to add to Gold Pot. Possibly not authorized.");
    }
  } catch (err) {
    console.error("addToGoldPot error:", err);
    setStatusMessage("Error adding to Gold Pot: " + err.message);
  }
};
window.addToGoldPot = self.addToGoldPot;

self.addToSilverPot = async function (amountIcp) {
  if (!runtimeGlobal || !window.icpTransferActor) return;
  if (!authMethod) {
    setStatusMessage("Please authenticate first to add to Silver Pot.");
    return;
  }
  try {
    const amountE8s = BigInt(Math.round(amountIcp * 1e8));
    const success = await window.icpTransferActor.addToSilverPot(amountE8s);
    if (success) {
      setStatusMessage(`Added ${amountIcp} ICP to Silver Pot.`);
      await self.getSilverPot();
    } else {
      setStatusMessage("Failed to add to Silver Pot. Possibly not authorized.");
    }
  } catch (err) {
    console.error("addToSilverPot error:", err);
    setStatusMessage("Error adding to Silver Pot: " + err.message);
  }
};
window.addToSilverPot = self.addToSilverPot;

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
window.stopWinStatsPolling = stopWinStatsPolling;

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
    const name = runtimeGlobal.globalVars.PlayerNameInput;
    const email = runtimeGlobal.globalVars.PlayerEmailInput;
    const score = runtimeGlobal.globalVars.Score;
    const token = window.currentRoundToken;

    const principal = runtimeGlobal.globalVars.currentPrincipal;
    const sessionToken = generateSessionToken(principal, token, score, name, email);

    setStatusMessage(`Submitting secure high score ${score}…`);
    const ok = await custodian_addHighScoreSecure(name, email, score, token, sessionToken);
    if (ok) setStatusMessage("High score accepted!");
    else setStatusMessage("High score rejected (token or score invalid).");
  } catch (err) {
    console.error("submitHighScore:", err);
    setStatusMessage("Error submitting high score: " + err.message);
  }
};

function generateSessionToken(principal, roundToken, score, name, email) {
  const seed = principal + roundToken.toString() + score.toString() + name + email;
  const hash = sha256(seed);
  return hash;
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

self.isPasswordSet = async function () {
  if (!runtimeGlobal || !window.custodianActor) return false;
  try {
    const isSet = await window.custodianActor.isPasswordSet();
    return isSet;
  } catch (err) {
    console.error("isPasswordSet error:", err);
    setStatusMessage("Error checking if password is set: " + err.message);
    return false;
  }
};
window.isPassword = self.isPasswordSet;

self.checkPassword = async function () {
  if (!runtimeGlobal) return;
  try {
    const input = runtimeGlobal.globalVars.UserInputPassword;
    const isSet = await self.isPasswordSet();
    if (!isSet) {
      setStatusMessage("Beta tester password not set. Contact the administrator.");
      return;
    }
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

self.checkLastAwardTs = async function () {
  if (!runtimeGlobal || !window.custodianActor) return;
  try {
    const currentTs = await window.custodianActor.getLastHighScoreAwardTs();
    console.log(`Current lastHighScoreAwardTs: ${ns2DateString(currentTs)}`);
    setStatusMessage(`Last award timestamp: ${ns2DateString(currentTs)}`);

    const success = await window.custodianActor.awardHighScorePot();
    if (success) {
      setStatusMessage("High score pot awarded successfully!");
      const updatedTs = await window.custodianActor.getLastHighScoreAwardTs();
      console.log(`Updated lastHighScoreAwardTs: ${ns2DateString(updatedTs)}`);
      await self.getHighScorePot();
    } else {
      setStatusMessage("High score pot not due for award yet.");
    }
  } catch (err) {
    console.error("checkLastAwardTs error:", err);
    setStatusMessage("Error awarding high score pot: " + err.message);
  }
};
window.checkLastAwardTs = self.checkLastAwardTs;

self.getHighScorePot = async function () {
  if (!runtimeGlobal || !window.icpTransferActor) return;
  try {
    const e8s = await window.icpTransferActor.getHighScorePot();
    const asIcp = Number(e8s) / 1e8;
    runtimeGlobal.globalVars.HighScorePot = asIcp;
    setStatusMessage(`High Score Pot: ${asIcp} ICP`);
  } catch (err) {
    console.error("getHighScorePot error:", err);
    setStatusMessage("Error fetching High Score Pot: " + err.message);
  }
};
window.getHighScorePot = self.getHighScorePot;

self.checkGoldenDuck = async function () {
  try {
    if (!window.custodianActor) {
      setStatusMessage("Custodian actor not initialized. No golden duck check.");
      return false;
    }
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Golden duck check timed out")), 7000);
    });
    const result = await Promise.race([
      window.custodianActor.oneIn50k(),
      timeoutPromise,
    ]);
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
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Silver duck check timed out")), 7000);
    });
    const shouldSpawn = await Promise.race([
      window.custodianActor.oneIn100(),
      timeoutPromise,
    ]);
    console.log("Silver Spawn =>", shouldSpawn);
    return shouldSpawn;
  } catch (err) {
    console.error("checkSilverDuck:", err);
    setStatusMessage("Error checking silver duck: " + err.message);
    return false;
  }
};

async function fetchUserLogsSafe(userPrincipal) {
  if (!window.icpTransferActor) throw new Error("ICP-Transfer actor missing");

  if (typeof window.icpTransferActor.getUserLogs === "function") {
    return await window.icpTransferActor.getUserLogs(userPrincipal);
  }

  if (typeof window.icpTransferActor.getLogs === "function") {
    const all = await window.icpTransferActor.getLogs();
    return all.filter(l =>
      l.caller?.toText && l.caller.toText() === userPrincipal.toText()
    );
  }

  throw new Error("Neither getUserLogs nor getLogs is exposed on the actor");
}

self.getMyTransactionLogs = async function () {
  if (!runtimeGlobal) return [];
  if (!authMethod) {
    setStatusMessage("Please authenticate first to view transaction logs.");
    return [];
  }

  try {
    const principalString = runtimeGlobal.globalVars.currentPrincipal;
    if (!principalString) return [];
    const userPrincipal = Principal.fromText(principalString);

    const logs = await fetchUserLogsSafe(userPrincipal);
    const newest10 = logs
      .slice()
      .sort((a, b) => Number(b.timestamp) - Number(a.timestamp))
      .slice(0, 10);
    return newest10;
  } catch (err) {
    console.error("getMyTransactionLogs error:", err);
    setStatusMessage("Error fetching transaction logs: " + err.message);
    return [];
  }
};

self.refreshTransactionLogs = async function () {
  if (!authMethod) {
    setStatusMessage("Please authenticate first to view transaction logs.");
    return;
  }
  if (!window.icpTransferActor || !window.custodianActor) {
    setStatusMessage("Transaction service not ready.");
    return;
  }

  try {
    const principalString = runtimeGlobal.globalVars.currentPrincipal;
    if (!principalString) return;

    const userPrincipal = Principal.fromText(principalString);

    const depositLogs = await fetchUserLogsSafe(userPrincipal);
    const filteredDepositLogs = depositLogs.filter(log => log.action === "recordDeposit");

    const allWinLogs = await window.custodianActor.getRecentWins();
    const userWinLogs = allWinLogs.filter(win => win.pid.toText() === principalString);

    const combinedLogs = [
      ...filteredDepositLogs.map(log => ({ type: 'deposit', log })),
      ...userWinLogs.map(win => ({ type: 'win', win }))
    ];

    combinedLogs.sort((a, b) => {
      const tsA = a.type === 'deposit' ? Number(a.log.timestamp) : Number(a.win.ts);
      const tsB = b.type === 'deposit' ? Number(b.log.timestamp) : Number(b.win.ts);
      return tsB - tsA;
    });

    const logText = combinedLogs.map(entry => {
      if (entry.type === 'deposit') {
        const log = entry.log;
        const ts = new Date(Number(log.timestamp) / 1e6).toLocaleString();
        const amt = (Number(log.amount_e8s) / 1e8).toFixed(4);
        return `${ts}: Purchased Play ${amt} ICP`;
      } else if (entry.type === 'win') {
        const win = entry.win;
        const ts = new Date(Number(win.ts) / 1e6).toLocaleString();
        const amt = (Number(win.amount) / 1e8).toFixed(4);
        const eventType = win.duckType;
        if (eventType === "Gold" || eventType === "Silver") {
          return `${ts}: ${eventType} Duck Win ${amt} ICP`;
        } else if (eventType === "Promo") {
          return `${ts}: Used Promo Code`;
        } else if (eventType === "HighScore") {
          return `${ts}: Won High Score Pot ${amt} ICP`;
        } else {
          return `${ts}: Unknown Event ${eventType}`;
        }
      }
    }).join("\n");

    runtimeGlobal.globalVars.TransactionLogsText = logText || "— No transactions —";

    updateTransactionLogs(logText);
  } catch (err) {
    console.error("refreshTransactionLogs error:", err);
    setStatusMessage("Error fetching transaction logs: " + err.message);
  }
};
window.refreshTransactionLogs = self.refreshTransactionLogs;

function updateTransactionLogs(logText) {
  const logsDiv = document.getElementById("transaction-logs");
  if (logsDiv) {
    logsDiv.innerText = (logText || "— No recent transactions —");
  } else {
    console.warn("Could not find 'transaction-logs' div.");
  }
}

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

self.getTimeUntilNextAward = async function () {
  if (!runtimeGlobal || !window.custodianActor) return;
  try {
    const timeLeftNs = await window.custodianActor.getTimeUntilNextAward();
    const timeLeftSeconds = Number(timeLeftNs) / 1_000_000_000;
    runtimeGlobal.globalVars.TimeLeftSeconds = timeLeftSeconds;
    setStatusMessage(`Time until next award: ${Math.floor(timeLeftSeconds / 86400)} days remaining`);
  } catch (err) {
    console.error("getTimeUntilNextAward error:", err);
    setStatusMessage("Error fetching time until next award: " + err.message);
  }
};
window.getTimeUntilNextAward = self.getTimeUntilNextAward;

self.getLastWinnerDetails = async function () {
  if (!runtimeGlobal || !window.custodianActor) return null;
  try {
    const details = await window.custodianActor.getLastWinnerDetails();
    console.log("Last winner details:", details);

    if (details.winner && details.winner.length > 0) {
      const [principal, name, email, score] = details.winner[0];
      const amountIcp = Number(details.amount) / 1e8;
      const timestamp = details.timestamp ? ns2DateString(details.timestamp) : "N/A";

      runtimeGlobal.globalVars.LastWinnerName = name;
      runtimeGlobal.globalVars.LastWinnerScore = score;
      runtimeGlobal.globalVars.LastWinnerAmount = amountIcp.toFixed(8);
      runtimeGlobal.globalVars.LastWinnerTimestamp = timestamp;
    } else {
      runtimeGlobal.globalVars.LastWinnerName = "No winner yet";
      runtimeGlobal.globalVars.LastWinnerScore = 0;
      runtimeGlobal.globalVars.LastWinnerAmount = "0.00000000";
      runtimeGlobal.globalVars.LastWinnerTimestamp = "N/A";
    }

    return details;
  } catch (err) {
    console.error("getLastWinnerDetails error:", err);
    setStatusMessage("Error fetching last winner details: " + err.message);
    return null;
  }
};
window.getLastWinnerDetails = self.getLastWinnerDetails;