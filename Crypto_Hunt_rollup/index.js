/**************************************
 * index.js — for ic_ad_network_bundle.js
 **************************************/
import { Actor, HttpAgent } from "@dfinity/agent";
import { AuthClient } from "@dfinity/auth-client";
import { Principal } from "@dfinity/principal";
import { sha256 } from 'js-sha256';

// === IMPORT YOUR AD NETWORK CANISTER ===
import {
  idlFactory as adNetIdl,
  canisterId as adNetCanisterId,
} from "./ad_network_canister.js";

// === IMPORT THE OFFICIAL ICP LEDGER CANISTER ===
import {
  idlFactory as ledgerIdl,
  canisterId as ledgerCanisterId,
} from "./ledger_canister.js";

// === NEW: import the custodian canister references ===
import {
  idlFactory as custodianIdlFactory,
  canisterId as custodianCanisterId,
} from "./custodian_canister.js";

// === ADD THIS import for the High Score canister: ===
import {
  idlFactory as highScoreIdlFactory,
  canisterId as highScoreCanisterId,
} from "./high_score_canister.js";

// ========== import the ICP Transfer canister references ========== 
import {
  idlFactory as icpTransferIdlFactory,
  canisterId as icpTransferCanisterId,
} from "./token_transfer_from_backend_canister.js";




export { AuthClient, Principal };

let adNetworkActor = null;
let icpTransferActor = null;
let ledgerActor = null;
let custodianActor = null;
let authClient = null;
let highScoreActor = null;

export {
  adNetworkActor,
  custodianActor,
  ledgerActor,
  icpTransferActor,
  highScoreActor,
  sha256,
};

export function getCurrentIdentity() {
  return authClient ? authClient.getIdentity() : null;
}

/** ========== AD NETWORK ACTOR SETUP ========== **/
export async function initActorUnauthenticated() {
  if (!adNetworkActor) {
    const agent = new HttpAgent({ host: "https://ic0.app", identity: undefined });
    adNetworkActor = Actor.createActor(adNetIdl, {
      agent,
      canisterId: adNetCanisterId,
    });
    window.adNetworkActor = adNetworkActor;
  }
}

export async function initActorWithPlug() {
  if (!window.ic || !window.ic.plug) {
    console.warn("Plug wallet not detected for Ad Network init.");
    return false;
  }
  // -- REMOVED requestConnect here! We'll rely on initAllWithPlug instead.
  adNetworkActor = await window.ic.plug.createActor({
    canisterId: adNetCanisterId,
    interfaceFactory: adNetIdl,
  });
  window.adNetworkActor = adNetworkActor;
  return true;
}

export async function initActorWithInternetIdentity() {
  if (!authClient) {
    authClient = await AuthClient.create();
    window.authClient = authClient;
  }
  if (await authClient.isAuthenticated()) {
    const identity = authClient.getIdentity();
    const agent = new HttpAgent({ identity, host: "https://ic0.app" });
    adNetworkActor = Actor.createActor(adNetIdl, {
      agent,
      canisterId: adNetCanisterId,
    });
    window.adNetworkActor = adNetworkActor;
    return;
  }
  return new Promise((resolve, reject) => {
    authClient.login({
      identityProvider: "https://identity.ic0.app",
      onSuccess: async () => {
        const identity = authClient.getIdentity();
        const agent = new HttpAgent({ identity, host: "https://ic0.app" });
        adNetworkActor = Actor.createActor(adNetIdl, {
          agent,
          canisterId: adNetCanisterId,
        });
        window.adNetworkActor = adNetworkActor;
        window.authClient = authClient;
        resolve();
      },
      onError: reject,
    });
  });
}

function checkAdNetworkActor() {
  if (!adNetworkActor) {
    throw new Error("Ad Network actor is not initialized. Call initActor first.");
  }
}

/** ========== CUSTODIAN ACTOR SETUP ========== **/
export async function initCustodianActorUnauthenticated() {
  if (!custodianActor) {
    const agent = new HttpAgent({ host: "https://ic0.app", identity: undefined });
    custodianActor = Actor.createActor(custodianIdlFactory, {
      agent,
      canisterId: custodianCanisterId,
    });
    window.custodianActor = custodianActor; // optional
    if (window.installSecureWinShim)               // ← NEW
      window.installSecureWinShim(window.runtimeGlobal);
  }
}

export async function initCustodianActorWithPlug() {
  if (!window.ic || !window.ic.plug) {
    console.warn("Plug not found for custodian init.");
    return false;
  }
  // -- REMOVED requestConnect here!
  custodianActor = await window.ic.plug.createActor({
    canisterId: custodianCanisterId,
    interfaceFactory: custodianIdlFactory,
  });
  window.custodianActor = custodianActor;
  if (window.installSecureWinShim)               // ← NEW
    window.installSecureWinShim(window.runtimeGlobal);
  return true;
}

export async function initCustodianActorWithInternetIdentity() {
  if (!authClient) {
    authClient = await AuthClient.create();
    window.authClient = authClient;
  }
  // If already authenticated, create the actor
  if (await authClient.isAuthenticated()) {
    const identity = authClient.getIdentity();
    const agent = new HttpAgent({ identity, host: "https://ic0.app" });
    custodianActor = Actor.createActor(custodianIdlFactory, {
      agent,
      canisterId: custodianCanisterId,
    });
    window.custodianActor = custodianActor;
    if (window.installSecureWinShim)               // ← NEW
      window.installSecureWinShim(window.runtimeGlobal);
    return;
  }

  return new Promise((resolve, reject) => {
    authClient.login({
      identityProvider: "https://identity.ic0.app",
      onSuccess: async () => {
        const identity = authClient.getIdentity();
        const agent = new HttpAgent({ identity, host: "https://ic0.app" });
        custodianActor = Actor.createActor(custodianIdlFactory, {
          agent,
          canisterId: custodianCanisterId,
        });
        window.custodianActor = custodianActor;
        resolve();
      },
      onError: reject,
    });
  });
}

function checkCustodianActor() {
  if (!custodianActor) {
    throw new Error("Custodian actor not initialized. Call initCustodianActor first.");
  }
}

// ========== 1) Initialization functions ==========

export async function initIcpTransferActorUnauthenticated() {
  if (!icpTransferActor) {
    const agent = new HttpAgent({ host: "https://ic0.app", identity: undefined });
    icpTransferActor = Actor.createActor(icpTransferIdlFactory, {
      agent,
      canisterId: icpTransferCanisterId,
    });
    window.icpTransferActor = icpTransferActor; // optional
  }
}

export async function initLedgerActorWithPlug() {
  if (!window.ic || !window.ic.plug) {
    console.warn("Plug not found for ICP ledger.");
    return false;
  }
  // -- REMOVED requestConnect here!
  ledgerActor = await window.ic.plug.createActor({
    canisterId: ledgerCanisterId,
    interfaceFactory: ledgerIdl,
  });
  window.ledgerActor = ledgerActor;
  return true;
}

export async function initIcpTransferActorWithPlug() {
  if (!window.ic || !window.ic.plug) {
    console.warn("Plug wallet not detected for ICP Transfer canister init.");
    return false;
  }
  // -- REMOVED requestConnect here!
  icpTransferActor = await window.ic.plug.createActor({
    canisterId: icpTransferCanisterId,
    interfaceFactory: icpTransferIdlFactory,
  });
  window.icpTransferActor = icpTransferActor;
  return true;
}

/** -------------------------------------------------------------------
    NEW SINGLE FUNCTION: initAllWithPlug()
    This does ONE requestConnect with all needed canisters in the whitelist,
    then creates each actor. The user sees only one approval popup.
------------------------------------------------------------------- **/
export async function initAllWithPlug() {
  if (!window.ic || !window.ic.plug) {
    console.warn("Plug wallet not detected.");
    return false;
  }
  // Single requestConnect call:
  const canisterWhitelist = [
    adNetCanisterId,
    ledgerCanisterId,
    custodianCanisterId,
    icpTransferCanisterId,
    highScoreCanisterId
  ];

  await window.ic.plug.requestConnect({
    whitelist: canisterWhitelist,
    host: "https://ic0.app",
  });

  // Now create each actor:
  adNetworkActor = await window.ic.plug.createActor({
    canisterId: adNetCanisterId,
    interfaceFactory: adNetIdl,
  });
  window.adNetworkActor = adNetworkActor;

  ledgerActor = await window.ic.plug.createActor({
    canisterId: ledgerCanisterId,
    interfaceFactory: ledgerIdl,
  });
  window.ledgerActor = ledgerActor;

  custodianActor = await window.ic.plug.createActor({
    canisterId: custodianCanisterId,
    interfaceFactory: custodianIdlFactory,
  });
  window.custodianActor = custodianActor;

  icpTransferActor = await window.ic.plug.createActor({
    canisterId: icpTransferCanisterId,
    interfaceFactory: icpTransferIdlFactory,
  });
  window.icpTransferActor = icpTransferActor;

  // Optional: create the High Score actor with Plug
  highScoreActor = await window.ic.plug.createActor({
    canisterId: highScoreCanisterId,
    interfaceFactory: highScoreIdlFactory,
  });
  window.highScoreActor = highScoreActor;

  return true;
}

// === Add this line so your Construct 3 script can call window.initAllWithPlug() ===
window.initAllWithPlug = initAllWithPlug;


export async function initIcpTransferActorWithInternetIdentity() {
  if (!authClient) {
    authClient = await AuthClient.create();
    window.authClient = authClient;
  }
  if (await authClient.isAuthenticated()) {
    const identity = authClient.getIdentity();
    const agent = new HttpAgent({ identity, host: "https://ic0.app" });
    icpTransferActor = Actor.createActor(icpTransferIdlFactory, {
      agent,
      canisterId: icpTransferCanisterId,
    });
    window.icpTransferActor = icpTransferActor;
    return;
  }
  return new Promise((resolve, reject) => {
    authClient.login({
      identityProvider: "https://identity.ic0.app",
      onSuccess: async () => {
        const identity = authClient.getIdentity();
        const agent = new HttpAgent({ identity, host: "https://ic0.app" });
        icpTransferActor = Actor.createActor(icpTransferIdlFactory, {
          agent,
          canisterId: icpTransferCanisterId,
        });
        window.icpTransferActor = icpTransferActor;
        resolve();
      },
      onError: reject,
    });
  });
}

function checkIcpTransferActor() {
  if (!icpTransferActor) {
    throw new Error("ICP Transfer actor not initialized. Call initIcpTransferActor first.");
  }
}

// ========== 2) Exported calls to the new canister ==========

export async function icpTransfer_recordDeposit(userPrincipal, amountE8s, blockIndex) {
  checkIcpTransferActor();
  return await icpTransferActor.recordDeposit(userPrincipal, amountE8s, blockIndex);
}

export async function icpTransfer_withdraw(amountE8s) {
  checkIcpTransferActor();
  return await icpTransferActor.withdraw(amountE8s);
}

export async function icpTransfer_getBalanceOf(userPrincipal) {
  checkIcpTransferActor();
  return await icpTransferActor.getBalanceOf(userPrincipal);
}

export async function icpTransfer_getMyBalance() {
  checkIcpTransferActor();
  return await icpTransferActor.getMyBalance();
}

// If you want to call the older "transfer" method from the custodian canister perspective:
export async function icpTransfer_transfer(transferArg) {
  checkIcpTransferActor();
  return await icpTransferActor.transfer(transferArg);
}

///////////////////////////////////////////////////////////
//  (1) Initialize the High Score actor anonymously
///////////////////////////////////////////////////////////
export async function initHighScoreActorUnauthenticated() {
  if (!highScoreActor) {
    const agent = new HttpAgent({ host: "https://ic0.app", identity: undefined });
    highScoreActor = Actor.createActor(highScoreIdlFactory, {
      agent,
      canisterId: highScoreCanisterId
    });
    window.highScoreActor = highScoreActor; // optional
  }
}

// Helper check
function checkHighScoreActor() {
  if (!highScoreActor) {
    throw new Error("High Score actor not initialized. Call initHighScoreActorUnauthenticated() first.");
  }
}

///////////////////////////////////////////////////////////
//  (2) Direct call to getHighScores on sque3-gyaaa...
///////////////////////////////////////////////////////////
export async function highScore_getHighScores() {
  checkHighScoreActor();
  // Directly call sque3-gyaaa-aaaam-qde7a-cai’s getHighScores
  return await highScoreActor.getHighScores();
}

/** ========== CUSTODIAN CALLS ========== **/
export async function custodian_addHighScoreSecure(
  playerName,
  playerEmail,
  playerScore,
  roundToken,
  sessionToken
) {
  checkCustodianActor();
  return await custodianActor.addHighScoreSecure(
    playerName,
    playerEmail,
    playerScore,
    roundToken,
    sessionToken
  );
}

export async function custodian_getHighScores() {
  checkCustodianActor();
  return await custodianActor.getHighScores();
}

export async function custodian_resetHighScores() {
  checkCustodianActor();
  return await custodianActor.resetHighScores();
}

export async function custodian_transferTokens(transferArg) {
  checkCustodianActor();
  return await custodianActor.transferTokens(transferArg);
}


/** ========== OFFICIAL ICP LEDGER ACTOR ========== **/
let ledgerAgent = null;

async function createLedgerActorAnonymous() {
  ledgerAgent = new HttpAgent({ host: "https://ic0.app", identity: undefined });
  ledgerActor = Actor.createActor(ledgerIdl, {
    agent: ledgerAgent,
    canisterId: ledgerCanisterId,
  });
  window.ledgerActor = ledgerActor;
  return ledgerActor;
}

export async function initLedgerActorUnauthenticated() {
  if (!ledgerActor) {
    await createLedgerActorAnonymous();
  }
}

export async function initLedgerActorWithInternetIdentity() {
  if (!authClient) {
    authClient = await AuthClient.create();
    window.authClient = authClient;
  }
  if (await authClient.isAuthenticated()) {
    const identity = authClient.getIdentity();
    ledgerAgent = new HttpAgent({ identity, host: "https://ic0.app" });
    ledgerActor = Actor.createActor(ledgerIdl, {
      agent: ledgerAgent,
      canisterId: ledgerCanisterId,
    });
    window.ledgerActor = ledgerActor;
    return;
  }
  return new Promise((resolve, reject) => {
    authClient.login({
      identityProvider: "https://identity.ic0.app",
      onSuccess: async () => {
        const identity = authClient.getIdentity();
        ledgerAgent = new HttpAgent({ identity, host: "https://ic0.app" });
        ledgerActor = Actor.createActor(ledgerIdl, {
          agent: ledgerAgent,
          canisterId: ledgerCanisterId,
        });
        window.ledgerActor = ledgerActor;
        resolve();
      },
      onError: reject,
    });
  });
}

function checkLedgerActor() {
  if (!ledgerActor) {
    throw new Error("ICP Ledger actor not initialized.");
  }
}

// "balanceOf" and "transfer" for your official ledger calls:
export async function ledger_balanceOf(principal, subaccount) {
  checkLedgerActor();
  const account = {
    owner: principal,
    subaccount: subaccount ? [Array.from(subaccount)] : [],
  };
  return await ledgerActor.icrc1_balance_of(account);
}

export async function ledger_transfer({ fromSubaccount, toPrincipal, toSubaccount, amount }) {
  checkLedgerActor();
  const transferArg = {
    to: {
      owner: toPrincipal,
      subaccount: toSubaccount ? [Array.from(toSubaccount)] : [],
    },
    fee: [],
    memo: [],
    from_subaccount: fromSubaccount ? [Array.from(fromSubaccount)] : [],
    created_at_time: [],
    amount,
  };
  return await ledgerActor.icrc1_transfer(transferArg);
}

/** ========== AD NETWORK CANISTER CALLS ========== **/
export async function purchaseViews(adId, additionalViews) {
  checkAdNetworkActor();
  return await adNetworkActor.purchaseViews(BigInt(adId), BigInt(additionalViews));
}

export async function createAd(imageB64, clickUrl, views, adType) {
  checkAdNetworkActor();
  return await adNetworkActor.createAd(imageB64, clickUrl, BigInt(views), adType);
}

export async function cashOutProject(projectId) {
  checkAdNetworkActor();
  return await adNetworkActor.cashOutProject(projectId);
}

export async function cashOutAllProjects() {
  checkAdNetworkActor();
  return await adNetworkActor.cashOutAllProjects();
}

export async function registerProject(pid, contact) {
  checkAdNetworkActor();
  return await adNetworkActor.registerProject(pid, contact);
}

export async function verifyPassword(password) {
  checkAdNetworkActor();
  return await adNetworkActor.verify_password(password);
}

export async function getTotalActiveAds() {
  checkAdNetworkActor();
  return await adNetworkActor.getTotalActiveAds();
}

export async function getTotalViewsForProject(pid) {
  checkAdNetworkActor();
  return await adNetworkActor.getTotalViewsForProject(pid);
}

export async function getTotalViewsForAllProjects() {
  checkAdNetworkActor();
  return await adNetworkActor.getTotalViewsForAllProjects();
}

export async function getRemainingViewsForAd(adId) {
  checkAdNetworkActor();
  return await adNetworkActor.getRemainingViewsForAd(BigInt(adId));
}

export async function getRemainingViewsForAllAds() {
  checkAdNetworkActor();
  return await adNetworkActor.getRemainingViewsForAllAds();
}

export async function getAllAds() {
  checkAdNetworkActor();
  return await adNetworkActor.getAllAds();
}
export async function getAdById(adId) {
  checkAdNetworkActor();
  return await adNetworkActor.getAdById(BigInt(adId));
}
export async function getProjectById(projectId) {
  checkAdNetworkActor();
  return await adNetworkActor.getProjectById(projectId);
}
export async function getAllProjects() {
  checkAdNetworkActor();
  return await adNetworkActor.getAllProjects();
}
export async function getMyAdsLite() {
  checkAdNetworkActor();
  return await adNetworkActor.getMyAdsLite();
}

/** CHANGED: getNextAd => returns Option<tuple>. We handle as [ad, tokenId] or null. */
export async function getNextAd(projectId, adType) {
  checkAdNetworkActor();
  // The canister returns an Option of a tuple (Ad, Nat).
  // In JS, if it's null or empty array => return null
  const result = await adNetworkActor.getNextAd(projectId, adType);
  if (!result || result.length === 0) {
    return null;
  }
  // result[0] is the tuple
  const [ad, token] = result[0];
  return [ad, token];
}

/** recordViewWithToken => increments if 5s passed + valid token. */
export async function recordViewWithToken(tokenId) {
  checkAdNetworkActor();
  return await adNetworkActor.recordViewWithToken(BigInt(tokenId));
}

//Beta Tester password check
export async function custodian_verifyPassword(inputPassword) {
  checkCustodianActor();
  return await custodianActor.verify_password(inputPassword);
}
