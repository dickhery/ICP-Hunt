

const scriptsInEvents = {

	async Game_event_Event7_Act19(runtime, localVars)
	{
		self.getGoldPot();
		
	},

	async Game_event_Event7_Act20(runtime, localVars)
	{
		self.getSilverPot();
		
	},

	async Game_event_Event17_Act1(runtime, localVars)
	{
		self.getGoldPot();
		
	},

	async Game_event_Event17_Act2(runtime, localVars)
	{
		self.getSilverPot();
		
	},

	async Game_event_Event34_Act1(runtime, localVars)
	{
		await window.incRoundCounters();
		
	},

	async Game_event_Event36_Act1(runtime, localVars)
	{

	},

	async Game_event_Event38_Act1(runtime, localVars)
	{
		try {
		    const isGolden = await self.checkGoldenDuck();
		    runtime.globalVars.SpawnGoldenDuck = isGolden ? 1 : 0;
		    console.log("SpawnGoldenDuck set to", runtime.globalVars.SpawnGoldenDuck);
		    runtime.globalVars.GoldenCheckDone = true;
		    runtime.callFunction("OnCheckGoldenDuckComplete");
		} catch (err) {
		    runtime.globalVars.SpawnGoldenDuck = 0;
		    runtime.globalVars.GoldenCheckDone = true;
		    runtime.callFunction("OnCheckGoldenDuckComplete");
		    console.error("Golden duck check failed:", err);
		}
	},

	async Game_event_Event39_Act1(runtime, localVars)
	{
		try {
		    const isSilver = await self.checkSilverDuck();
		    runtime.globalVars.SpawnSilverDuck = isSilver ? 1 : 0;
		    console.log("SpawnSilverDuck set to", runtime.globalVars.SpawnSilverDuck);
		    runtime.globalVars.SilverCheckDone = true;
		    runtime.callFunction("OnCheckSilverDuckComplete");
		} catch (err) {
		    runtime.globalVars.SpawnSilverDuck = 0;
		    runtime.globalVars.SilverCheckDone = true;
		    runtime.callFunction("OnCheckSilverDuckComplete");
		    console.error("Silver duck check failed:", err);
		}
	},

	async Game_event_Event192_Act12(runtime, localVars)
	{
		const success = await self.recordDuckWin("Gold");
		if (success) {
		    runtime.globalVars.GoldWon = true;
		    runtime.callFunction("ShowWinner", "Gold", runtime.globalVars.GoldPot);
		    const ok = await window.custodianActor.awardGoldPotToCaller();
		    console.log("awardGoldPotToCaller ->", ok);
		    if (ok) {
		        setStatusMessage("Gold pot awarded successfully!");
		    } else {
		        setStatusMessage("Failed to award Gold pot.");
		    }
		} else {
		    runtime.globalVars.StatusMessage = "Cannot record Gold duck win: Operation in progress or invalid token.";
		}
	},

	async Game_event_Event193_Act12(runtime, localVars)
	{
		const success = await self.recordDuckWin("Silver");
		if (success) {
		    runtime.globalVars.SilverWon = true;
		    runtime.callFunction("ShowWinner", "Silver", runtime.globalVars.SilverPot);
		    const ok = await window.custodianActor.awardSilverPotToCaller();
		    console.log("awardSilverPotToCaller ->", ok);
		    if (ok) {
		        setStatusMessage("Silver pot awarded successfully!");
		    } else {
		        setStatusMessage("Failed to award Silver pot.");
		    }
		} else {
		    runtime.globalVars.StatusMessage = "Cannot record Silver duck win: Operation in progress or invalid token.";
		}
	},

	async Game_event_Event223_Act7(runtime, localVars)
	{

	},

	async Game_event_Event223_Act9(runtime, localVars)
	{
		self.fetchNextAd();
		
	},

	async Menu_event_Event17_Act1(runtime, localVars)
	{
		window.depositIcpForUser();
	},

	async Menu_event_Event18_Act3(runtime, localVars)
	{
		window.depositIcpForUser();
	},

	async Menu_event_Event19_Act3(runtime, localVars)
	{
		window.depositIcpForUser();
	},

	async Menu_event_Event28_Act2(runtime, localVars)
	{
		window.logout();
	},

	async Game_over_event_Event7_Act2(runtime, localVars)
	{
		(async function() {
		  console.log("[GameOver] Checking if new high score?");
		  
		  // 1) Load scoreboard
		  await self.loadHighScores();  
		  let arr = runtime.globalVars.HighScoreArray || [];
		
		  // 2) Sort descending by score
		  arr = arr.slice().sort((a, b) => Number(b[3]) - Number(a[3]));
		
		  // 3) Compare the player's final Score
		  let score = runtime.globalVars.Score;
		  let isTop = false;
		
		  if (arr.length < 10) {
		    isTop = true;
		  } else {
		    let tenthPlaceScore = Number(arr[9][3]);
		    if (score > tenthPlaceScore) {
		      isTop = true;
		    }
		  }
		
		  // 4) Instead of show/hide directly, do this:
		  if (isTop) {
		    console.log("You got a new high score!");
		    runtime.globalVars.GotHighScore = 1;
		  } else {
		    console.log("Not a top score.");
		    runtime.globalVars.GotHighScore = 0;
		  }
		})();
		
	},

	async Game_over_event_Event10_Act1(runtime, localVars)
	{
		const nameBox  = runtime.objects.NameInputBox.getFirstInstance();
		const emailBox = runtime.objects.EmailInputBox.getFirstInstance();
		
		runtime.globalVars.PlayerNameInput  = nameBox.text;
		runtime.globalVars.PlayerEmailInput = emailBox.text;
		
		self.submitHighScore();   
		
	},

	async Auth_event_Event2_Act1(runtime, localVars)
	{
		window.initAdNetworkWithPlug();
		
	},

	async Auth_event_Event3_Act1(runtime, localVars)
	{
		window.initAdNetworkWithII();
	},

	async Bounties_event_Event2_Act7(runtime, localVars)
	{
		const p = runtime.globalVars.currentPrincipal;
		
		if (p && p.length > 0) {
		  runtime.objects.Text_Principal.getFirstInstance().text = "Principal: " + p;
		} else {
		  runtime.objects.Text_Principal.getFirstInstance().text = "Principal not found";
		}
		
		runtime.objects.Text_Balance.getFirstInstance().text = "Balance: ???";
		
	},

	async Bounties_event_Event2_Act9(runtime, localVars)
	{
		// call your main.js function
		window.checkTokenBalance();
		
	},

	async Bounties_event_Event2_Act10(runtime, localVars)
	{
		window.refreshWinStats();
	},

	async Bounties_event_Event5_Act1(runtime, localVars)
	{
		// call your main.js function
		window.checkTokenBalance();
		
	},

	async Bounties_event_Event7_Act1(runtime, localVars)
	{
		// 1) Capture the user input from your text inputs into the global vars:
		runtime.globalVars.TokenRecipient = runtime.objects.TextInput_Recipient.getFirstInstance().text;
		runtime.globalVars.TokenAmount = runtime.objects.TextInput_Amount.getFirstInstance().text;
		
		// 2) Call the main.js function to do the transfer:
		window.transferTokens();
		
	},

	async Bounties_event_Event8_Act1(runtime, localVars)
	{
		window.depositIcpForUser();
		
	},

	async Bounties_event_Event9_Act1(runtime, localVars)
	{
		window.withdrawIcp();
		
	},

	async Bounties_event_Event10_Act1(runtime, localVars)
	{
		window.checkMyIcpTransferBalance();
		
	},

	async Bounties_event_Event11_Act2(runtime, localVars)
	{
		window.checkUserIcpTransferBalance();
	},

	async Bounties_event_Event12_Act1(runtime, localVars)
	{
		let typed = runtime.objects.TextInput_PotAmount.getFirstInstance().text;
		let potNum = parseFloat(typed) || 0;
		window.addToSilverPot(potNum);
		
	},

	async Bounties_event_Event13_Act1(runtime, localVars)
	{
		let typed = runtime.objects.TextInput_PotAmount.getFirstInstance().text;
		let potNum = parseFloat(typed) || 0;
		window.addToGoldPot(potNum);
		
	},

	async Bounties_event_Event14_Act1(runtime, localVars)
	{
		window.getGoldPot();
	},

	async Bounties_event_Event15_Act1(runtime, localVars)
	{
		window.getSilverPot();
	},

	async Bounties_event_Event16_Act1(runtime, localVars)
	{
		window.getTotalPot();
	},

	async Bounties_event_Event17_Act1(runtime, localVars)
	{
		window.resetGoldPotFromCustodian();
	},

	async Bounties_event_Event18_Act1(runtime, localVars)
	{
		window.copyPrincipalToClipboard();
		
	},

	async Leaderboard_event_Event1_Act1(runtime, localVars)
	{
// A single async script to fetch and display high scores
(async () => {
  // 1) Log that we are starting
  console.log('[Leaderboard] On start of layout -> begin fetching scores');

  // 2) Call the function that fetches from your custodian canister
  //    This must be an async function in your main.js
  await self.loadHighScores();

  // 3) Retrieve the scores array from globalVars
  let arr = runtime.globalVars.HighScoreArray || [];
  console.log('[Leaderboard] High scores array loaded:', arr);

  // 4) Build a scoreboard string
  let str = '=== HIGH SCORES ===\n';

  // Sort by score descending (the 4th element in each [principal, name, email, score])
  arr = arr.slice().sort((a,b) => Number(b[3]) - Number(a[3]));

  // 5) Loop through results, build text line by line
  for (let i = 0; i < arr.length; i++) {
    let [principal, name, email, score] = arr[i];
    str += `${i+1}) ${name} (${score} pts)\n`;
  }

  console.log('[Leaderboard] Final scoreboard string:\n' + str);

  // 6) Assign the string to globalVars (if you want to store it) and set the text object
  runtime.globalVars.LeaderboardString = str;

  // 7) Actually set the text in your text object named 'LeaderboardText'
  const textObj = runtime.objects.LeaderboardText.getFirstInstance();
  if (textObj) {
    textObj.text = str;
  } else {
    console.warn('No LeaderboardText object found!');
  }
})();
	},

	async Leaderboard_event_Event2_Act1(runtime, localVars)
	{
// A single async script to fetch and display high scores
(async () => {
  // 1) Log that we are starting
  console.log('[Leaderboard] On start of layout -> begin fetching scores');

  // 2) Call the function that fetches from your custodian canister
  //    This must be an async function in your main.js
  await self.loadHighScores();

  // 3) Retrieve the scores array from globalVars
  let arr = runtime.globalVars.HighScoreArray || [];
  console.log('[Leaderboard] High scores array loaded:', arr);

  // 4) Build a scoreboard string
  let str = '=== HIGH SCORES ===\n';

  // Sort by score descending (the 4th element in each [principal, name, email, score])
  arr = arr.slice().sort((a,b) => Number(b[3]) - Number(a[3]));

  // 5) Loop through results, build text line by line
  for (let i = 0; i < arr.length; i++) {
    let [principal, name, email, score] = arr[i];
    str += `${i+1}) ${name} (${score} pts)\n`;
  }

  console.log('[Leaderboard] Final scoreboard string:\n' + str);

  // 6) Assign the string to globalVars (if you want to store it) and set the text object
  runtime.globalVars.LeaderboardString = str;

  // 7) Actually set the text in your text object named 'LeaderboardText'
  const textObj = runtime.objects.LeaderboardText.getFirstInstance();
  if (textObj) {
    textObj.text = str;
  } else {
    console.warn('No LeaderboardText object found!');
  }
})();
	},

	async Beta_event_Event1_Act1(runtime, localVars)
	{
		window.checkPassword();
	},

	async Beta_event_Event6_Act1(runtime, localVars)
	{
		self.getGoldPot();
		
	},

	async Beta_event_Event6_Act2(runtime, localVars)
	{
		self.getSilverPot();
		
	},

	async Wallet_event_Event2_Act3(runtime, localVars)
	{
		const p = runtime.globalVars.currentPrincipal;
		
		if (p && p.length > 0) {
		  runtime.objects.Text_Principal.getFirstInstance().text = "Principal: " + p;
		} else {
		  runtime.objects.Text_Principal.getFirstInstance().text = "Principal not found";
		}
		
		runtime.objects.Text_Balance.getFirstInstance().text = "Balance: ???";
		
	},

	async Wallet_event_Event2_Act5(runtime, localVars)
	{
		// call your main.js function
		window.checkTokenBalance();
		
	},

	async Wallet_event_Event2_Act6(runtime, localVars)
	{
		window.refreshWinStats();
	},

	async Wallet_event_Event5_Act1(runtime, localVars)
	{
		// call your main.js function
		window.checkTokenBalance();
		
	},

	async Wallet_event_Event7_Act1(runtime, localVars)
	{
		// 1) Capture the user input from your text inputs into the global vars:
		runtime.globalVars.TokenRecipient = runtime.objects.TextInput_Recipient.getFirstInstance().text;
		runtime.globalVars.TokenAmount = runtime.objects.TextInput_Amount.getFirstInstance().text;
		
		// 2) Call the main.js function to do the transfer:
		window.transferTokens();
		
	},

	async Wallet_event_Event8_Act1(runtime, localVars)
	{
		window.depositIcpForUser();
		
	},

	async Wallet_event_Event9_Act1(runtime, localVars)
	{
		window.withdrawIcp();
		
	},

	async Wallet_event_Event10_Act1(runtime, localVars)
	{
		window.checkMyIcpTransferBalance();
		
	},

	async Wallet_event_Event11_Act2(runtime, localVars)
	{
		window.checkUserIcpTransferBalance();
	},

	async Wallet_event_Event12_Act1(runtime, localVars)
	{
		let typed = runtime.objects.TextInput_PotAmount.getFirstInstance().text;
		let potNum = parseFloat(typed) || 0;
		window.addToSilverPot(potNum);
		
	},

	async Wallet_event_Event13_Act1(runtime, localVars)
	{
		let typed = runtime.objects.TextInput_PotAmount.getFirstInstance().text;
		let potNum = parseFloat(typed) || 0;
		window.addToGoldPot(potNum);
		
	},

	async Wallet_event_Event14_Act1(runtime, localVars)
	{
		window.getGoldPot();
	},

	async Wallet_event_Event15_Act1(runtime, localVars)
	{
		window.getSilverPot();
	},

	async Wallet_event_Event16_Act1(runtime, localVars)
	{
		window.getTotalPot();
	},

	async Wallet_event_Event17_Act1(runtime, localVars)
	{
		window.resetGoldPotFromCustodian();
	},

	async Wallet_event_Event18_Act1(runtime, localVars)
	{
		window.copyPrincipalToClipboard();
		
	},

	async Auth_event_Event1_Act3(runtime, localVars)
	{
		self.getGoldPot();
		
	},

	async Auth_event_Event1_Act4(runtime, localVars)
	{
		self.getSilverPot();
		
	},

	async Auth_event_Event1_Act1(runtime, localVars)
	{
		window.logout();
	},

	async Auth_event_Event1_Act2(runtime, localVars)
	{
		window.initAdNetworkActor();
	},

	async Bounties_event_Event2_Act1(runtime, localVars)
	{
		self.getGoldPot();
		
	},

	async Bounties_event_Event2_Act2(runtime, localVars)
	{
		self.getSilverPot();
		
	},

	async Menu_event_Event2_Act1(runtime, localVars)
	{
		window.checkTokenBalance();
	},

	async Menu_event_Event3_Act3(runtime, localVars)
	{
		window.checkTokenBalance();
	},

	async Game_over_event_Event5_Act1(runtime, localVars)
	{
		window.checkTokenBalance();
	},

	async Game_over_event_Event12_Act1(runtime, localVars)
	{
		window.checkTokenBalance();
	},

	async Menu_event_Event3_Act2(runtime, localVars)
	{
		const p = runtime.globalVars.currentPrincipal;
		
		if (p && p.length > 0) {
		  runtime.objects.Text_Principal.getFirstInstance().text = "Principal: " + p;
		} else {
		  runtime.objects.Text_Principal.getFirstInstance().text = "Principal not found";
		}
	},

	async Game_over_event_Event2_Act1(runtime, localVars)
	{
		const p = runtime.globalVars.currentPrincipal;
		
		if (p && p.length > 0) {
		  runtime.objects.Text_Principal.getFirstInstance().text = "Principal: " + p;
		} else {
		  runtime.objects.Text_Principal.getFirstInstance().text = "Principal not found";
		}
	},

	async Menu_event_Event2_Act2(runtime, localVars)
	{
		const p = runtime.globalVars.currentPrincipal;
		
		if (p && p.length > 0) {
		  runtime.objects.Text_Principal.getFirstInstance().text = "Principal: " + p;
		} else {
		  runtime.objects.Text_Principal.getFirstInstance().text = "Principal not found";
		}
	},

	async Game_over_event_Event13_Act1(runtime, localVars)
	{
		window.copyPrincipalToClipboard();
		
	},

	async Game_over_event_Event14_Act2(runtime, localVars)
	{
		const p = runtime.globalVars.currentPrincipal;
		
		if (p && p.length > 0) {
		  runtime.objects.Text_Principal.getFirstInstance().text = "Principal: " + p;
		} else {
		  runtime.objects.Text_Principal.getFirstInstance().text = "Principal not found";
		}
	},

	async Menu_event_Event5_Act2(runtime, localVars)
	{
		const p = runtime.globalVars.currentPrincipal;
		
		if (p && p.length > 0) {
		  runtime.objects.Text_Principal.getFirstInstance().text = "Principal: " + p;
		} else {
		  runtime.objects.Text_Principal.getFirstInstance().text = "Principal not found";
		}
	},

	async Menu_event_Event4_Act1(runtime, localVars)
	{
		window.copyPrincipalToClipboard();
		
	}
};

self.C3.ScriptsInEvents = scriptsInEvents;
