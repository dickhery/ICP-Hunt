//
// ad_network_canister.js
//
export const idlFactory = ({ IDL }) => {
  // Reuse your existing Ad, Project, LogEntry, AdLite definitions.
  const Ad = IDL.Record({
    'id' : IDL.Nat,
    'viewsServed' : IDL.Nat,
    'adType' : IDL.Text,
    'imageBase64' : IDL.Text,
    'advertiser' : IDL.Principal,
    'viewsPurchased' : IDL.Nat,
    'clickUrl' : IDL.Text,
  });
  const Project = IDL.Record({
    'id' : IDL.Text,
    'contact' : IDL.Text,
    'views' : IDL.Nat,
    'owner' : IDL.Principal,
  });
  const LogEntry = IDL.Record({
    'method' : IDL.Text,
    'timestamp' : IDL.Nat,
    'details' : IDL.Text,
    'caller' : IDL.Principal,
  });
  const AdLite = IDL.Record({
    'id' : IDL.Nat,
    'viewsServed' : IDL.Nat,
    'adType' : IDL.Text,
    'advertiser' : IDL.Principal,
    'viewsPurchased' : IDL.Nat,
    'clickUrl' : IDL.Text,
  });

  // For returning ?(Ad, Nat):
  const GetNextAdReturn = IDL.Opt(IDL.Tuple(Ad, IDL.Nat));

  return IDL.Service({
    'cashOutAllProjects' : IDL.Func([], [IDL.Nat], []),
    'cashOutProject' : IDL.Func([IDL.Text], [IDL.Nat], []),
    'createAd' : IDL.Func([IDL.Text, IDL.Text, IDL.Nat, IDL.Text], [IDL.Nat], []),
    'getAdById' : IDL.Func([IDL.Nat], [IDL.Opt(Ad)], []),
    'getAllAds' : IDL.Func([], [IDL.Vec(Ad)], []),
    'getAllProjects' : IDL.Func([], [IDL.Vec(Project)], []),
    'getLogs' : IDL.Func([], [IDL.Vec(LogEntry)], []),
    'getMyAdsLite' : IDL.Func([], [IDL.Vec(AdLite)], []),
    // CHANGED:
    'getNextAd' : IDL.Func([IDL.Text, IDL.Text], [GetNextAdReturn], []),

    'getProjectById' : IDL.Func([IDL.Text], [IDL.Opt(Project)], []),
    'getRemainingViewsForAd' : IDL.Func([IDL.Nat], [IDL.Nat], []),
    'getRemainingViewsForAllAds' : IDL.Func([], [IDL.Nat], []),
    'getTotalActiveAds' : IDL.Func([], [IDL.Nat], []),
    'getTotalViewsForAllProjects' : IDL.Func([], [IDL.Nat], []),
    'getTotalViewsForProject' : IDL.Func([IDL.Text], [IDL.Nat], []),
    'purchaseViews' : IDL.Func([IDL.Nat, IDL.Nat], [IDL.Bool], []),
    'recordViewWithToken' : IDL.Func([IDL.Nat], [IDL.Bool], []), // NEW
    'registerProject' : IDL.Func([IDL.Text, IDL.Text], [IDL.Bool], []),
    'verify_password' : IDL.Func([IDL.Text], [IDL.Bool], ['query']),
  });
};

// Just export your canister ID as usual:
export const canisterId = "7kuqs-jaaaa-aaaal-qsrca-cai"; 
