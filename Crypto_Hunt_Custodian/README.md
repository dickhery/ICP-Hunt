
# `high_score_project_backend` Custodian Canister

Welcome to the `high_score_project_backend` custodian canister. This canister manages:
1. Interactions with a separate High Score canister (e.g., adding and viewing high scores).
2. Token transfer functionality.
3. Simple password verification and update functionality.

Below you will find details on each method provided by this canister, along with sample commands to invoke them using the [Internet Computer `dfx` command-line tools](https://internetcomputer.org/docs/current/developer-docs/setup/install).

---

## Table of Contents

1. [Method Overview](#method-overview)
   - [addHighScore](#1-addhighscore)
   - [getHighScores](#2-gethighscores)
   - [resetHighScores](#3-resethighscores)
   - [transferTokens](#4-transfertokens)
   - [verify_password](#5-verify_password)
   - [updatePassword](#6-updatepassword)
2. [Calling the Methods](#calling-the-methods)
   - [Local Testing](#local-testing)
   - [Mainnet/IC Usage](#mainnetic-usage)
3. [Project Setup and Common Commands](#project-setup-and-common-commands)
4. [Further Resources](#further-resources)

---

## Method Overview

### 1. `addHighScore(name: Text, email: Text, score: Int) -> async Bool`
This method adds a new high score to a separate **High Score** canister.

- **Parameters**:
  - `name`: The player's name (text).
  - `email`: The player's email address (text).
  - `score`: The numeric score (int).
  
- **Returns**:
  - `true` if the score was successfully recorded; otherwise `false`.

### 2. `getHighScores() -> async [(Principal, Text, Text, Int)]`
Retrieves the list of all high scores from the **High Score** canister.

- **Returns**:
  - A list of tuples: `(playerPrincipal, name, email, score)`.

### 3. `resetHighScores() -> async ()`
Resets all existing high scores in the **High Score** canister (use with caution).

### 4. `transferTokens(args: TransferArgs) -> async TransferResult`
Facilitates token transfers by calling the **Token Transfer** canister.

- **Parameters** (`TransferArgs`):
  - `amount: Tokens` (e.g. `{ e8s: Nat64 }` where `e8s` is the number of 10^-8 tokens).
  - `to_principal: Principal` (the recipient of the tokens).
  - `to_subaccount: ?[Nat8]` (optional subaccount bytes).
  
- **Returns** (`TransferResult`):
  - `{ Ok: Nat }` containing a block height if successful,
  - or `{ Err: Text }` with an error message if the transfer fails.

### 5. `verify_password(inputPassword: Text) -> async Bool`
Checks if the `inputPassword` matches the currently stored password.

- **Parameters**:
  - `inputPassword`: The password to verify.
  
- **Returns**:
  - `true` if `inputPassword` matches the stored password; otherwise `false`.

### 6. `updatePassword(newPassword: Text) -> async Bool`
Updates the stored password to a new value. 

> **Important**: In this example, the method checks if the caller’s `Principal` matches a specific admin Principal before allowing the update. By default, only that Principal can change the stored password. Calls from other Principals will be rejected.

- **Parameters**:
  - `newPassword`: The new password to store.
  
- **Returns**:
  - `true` if the password was successfully updated,
  - `false` if the caller is not allowed to update the password.

---

## Calling the Methods

Below are example commands using `dfx`. Replace `high_score_project_backend` with your canister name if it differs, and be sure to use the correct identity or Principal if a method requires specific permissions.

### Local Testing

1. **Start the local replica** (if not running yet):
   ```bash
   dfx start --background
   ```
2. **Deploy your canisters locally**:
   ```bash
   dfx deploy
   ```
3. **Call `addHighScore`**:
   ```bash
   dfx canister call high_score_project_backend addHighScore '("Alice", "alice@example.com", 123)'
   ```
4. **Call `getHighScores`**:
   ```bash
   dfx canister call high_score_project_backend getHighScores
   ```
5. **Call `resetHighScores`**:
   ```bash
   dfx canister call high_score_project_backend resetHighScores
   ```
6. **Call `transferTokens`**:
   ```bash
   dfx canister call high_score_project_backend transferTokens '({
     amount = record { e8s = 1000000 };
     to_principal = principal "aaaaa-aa";
     to_subaccount = null;
   })'
   ```
7. **Call `verify_password`**:
   ```bash
   dfx canister call high_score_project_backend verify_password '("TestPassword")'
   ```
8. **Call `updatePassword`**:
   ```bash
   dfx canister call high_score_project_backend updatePassword '("NewSecurePassword")'
   ```
   This will return `true` only if the caller is the allowed admin Principal.

### Mainnet/IC Usage

When calling methods on the **Internet Computer** network (`ic`), add `--network ic` to your commands. For example, to update the password on the mainnet:

```bash
dfx canister call high_score_project_backend updatePassword '("Paytoplay")' --network ic
```

Ensure your current `dfx identity` or hardware wallet Principal has the correct permissions if the method enforces Principal checks.

---

## Project Setup and Common Commands

Below are some common commands you might use for this project:

- **Generate Candid/TypeScript bindings**:
  ```bash
  npm run generate
  ```
- **Start the local dev server** (for frontend work):
  ```bash
  npm start
  ```
  By default, this hosts your frontend at `http://localhost:8080`.

- **Deploy canisters** (locally or to mainnet, depending on your config):
  ```bash
  dfx deploy
  ```
  
For more details, see the official [DFX Documentation](https://internetcomputer.org/docs/current/developer-docs/setup/install).
