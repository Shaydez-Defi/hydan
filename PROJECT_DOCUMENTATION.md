# hydan — Complete Project Documentation

Every technical and non-technical detail about the hydan project: what it is, how it works,
down to the smallest implementation specifics. This is the single source of truth for anyone
(including future-me) who needs to understand the entire system without reading every file.

---

## 1. One-paragraph summary

hydan is a **private lending vault** built as a solo hackathon entry for the **iExec WTF
Hackathon** (Nox + Aave track, Sepolia). Users deposit **WETH** as collateral and borrow
**USDC** against it — exactly like a normal Aave position — but the vault's share balances
and debt balances are stored as **Nox encrypted handles** (`euint256`), so nobody on-chain
can see how much any user has deposited or borrowed. Amounts are only ever decrypted inside
Nox's TEE (or for the owner via their own keys), and every sensitive operation (borrow
amount, withdraw approval) is gated by a **decryption proof** produced by the Nox gateway
and verified on-chain by the vault contract. The health factor is computed by Aave itself
from the vault's aggregated position; the public only ever sees a boolean "healthy / at
risk", never the numbers. A polished React frontend (Vite + wagmi/viem + Tailwind) exposes
four actions — Deposit, Borrow, Repay, Withdraw — plus an activity feed and a privacy-aware
"public explorer".

---

## 2. Project status

- Solo hackathon build, **time-boxed ~10 days**, judged partly on _working end-to-end
  functionality with no mock data_.
- The full cycle (deposit → borrow → repay → withdraw) is **live and verified on Sepolia**
  via `scripts/e2e_full_cycle.mjs`.
- **All live addresses** (Sepolia):

  | Item                       | Address                                      |
  | -------------------------- | -------------------------------------------- |
  | HydanVault                 | `0xb05c9770e926bf193f1d69a4490591ab18e6a12a` |
  | asset (WETH)               | `0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c` |
  | debtAsset (USDC)           | `0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8` |
  | Aave V3 Pool               | `0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951` |
  | Aave PoolAddressesProvider | `0x012bAC54348C0E635dCAc9D5FB99f06F24136C9A` |
  | Aave aWETH (aToken)        | `0x5b071b590a59395fE4025A0Ccc1FcC931AAc1830` |
  | Aave ProtocolDataProvider  | `0x3e9708d80f7B3e43118013075F7e95CE3AB31F31` |
  | Nox ACP (testnets)         | `0x24ef36ec5b626d7dcd09a98f3083c2758f0f77bf` |

- Deployer account: `0x2b374aDd4b86Ab1bf6196D1f698Eeb77156aA0F0` (owns the vault, paid deploy
  - e2e gas).
- Git remote: `https://github.com/Shaydez-Defi/hydan`, branch `main`.

---

## 3. Stack at a glance

| Layer             | Tech                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| Contracts         | Solidity `0.8.35`, Hardhat 3 (`hardhat.config.ts`), Nox SDK contracts                                |
| Compiler settings | `viaIR: true`, optimizer `{ enabled: true, runs: 200 }`                                              |
| Deploys           | Hardhat Ignition (`ignition/modules/DeployWETH.ts`) or raw viem script (`scripts/deployNewWETH.mjs`) |
| Nox SDK (JS)      | `@iexec-nox/handle` v`0.1.0-beta.13`                                                                 |
| Nox contract lib  | `@iexec-nox/nox-protocol-contracts` v`0.2.4`, `encrypted-types` v`0.0.4`                             |
| Yield             | Aave V3 Sepolia                                                                                      |
| Frontend          | Vite 6 + React 19 + wagmi 2 + viem 2 + @tanstack/react-query 5 + Tailwind 3                          |
| RPC               | Alchemy free tier (Sepolia), see gotchas in §13                                                      |

---

## 4. Nox — the core of the project (deep dive)

### 4.1 What Nox is

[Nox](https://docs.noxprotocol.io) is iExec's confidential-computing protocol for
Ethereum. It lets smart contracts read/write **encrypted values** while staying fully
deterministic and auditable. The idea:

- A value is encrypted into a **handle** (a 32-byte value, often just `bytes32`) using
  **FHE-like encrypted operations** (TFHE / cryptographic computing) on chain.
- The handle is _not_ plaintext: reading storage gives you a ciphertext blob you cannot
  decode without the right keys.
- The heavy lifting (key generation, key management, decryption, proving) is done by the
  **Nox Compute contract** (on-chain) and the **Nox gateway** (off-chain, runs inside a
  **TEE / secure enclave**).
- The SDK (`@iexec-nox/handle`) provides `handleClient.encryptInput(...)` and
  `handleClient.publicDecrypt(...)` so apps can encrypt inputs and decrypt results via the
  gateway, producing **decryption proofs** that the target contract verifies on-chain.

### 4.2 The key primitives used

From `@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol`:

- **`euint256`** — encrypted `uint256` type. Under the hood it's a handle (a 32-byte
  ciphertext reference). Supports homomorphic-ish ops via the Nox library:
  - `euint256.unwrap(x)` → raw `bytes32`
  - `euint256.wrap(bytes32)` → back to `euint256`
  - `.add(other)` → encrypted sum (another `euint256`)
  - `.sub(other)` → encrypted difference
  - `.ge(other)` → encrypted comparison, returns **`ebool`**
  - `.gt(other)` → encrypted greater-than, returns `ebool`
  - `.allow(addr)` / `.allowPublicDecryption()` — ACL: who may decrypt this handle
- **`ebool`** — encrypted boolean, same idea.
- **`externalEuint256`** — a handle coming from _outside_ the contract (i.e. produced by
  the user via the SDK, not by the contract's own `Nox.toEuint256`). Usually paired with an
  **`inputProof`** to prove it was legitimately wrapped by the user.
- **`Nox.toEuint256(plain)`** — contract-side encryption: wraps a plaintext value into an
  encrypted handle on-chain. **This calls the NoxCompute contract's `wrapAsPublicHandle`**.
  Huge debugging consequence (see §13): you cannot reproduce this on a fork.
- **`Nox.fromExternal(ext, inputProof)`** → `euint256` — imports an external handle into
  the contract, verifying the `inputProof`.
- **`Nox.publicDecrypt(handle, proof)`** → `bool` / `uint256` — verifies a decryption
  proof on-chain against a handle that was made publicly decryptable. If the proof is valid
  the plaintext is revealed _to the transaction caller's context_ (on-chain, so it's
  readable in that tx, but it is never stored).
- **`Nox.allowPublicDecryption(handle)`** — marks a handle as publicly decryptable (used
  for the ebool approvals and health status).

### 4.3 How the pieces talk (the request/response dance)

1. **Encrypt (client-side → chain):**
   `handleClient.encryptInput(value, solidityType, contractAddress)` returns
   `{ handle, handleProof }`. The handle is a `bytes32`; the proof proves the caller
   legitimately created it. The app submits `handle` + `handleProof` in a tx.

2. **Register on-chain:**
   The vault contract calls `Nox.fromExternal(handle, handleProof)`, then marks the handle
   with `.allow(contract)`, `.allow(msg.sender)`, and (for borrow) `Nox.allowPublicDecryption(...)`.

3. **Decrypt (off-chain via gateway):**
   The Nox **gateway** (`https://gateway-testnets.noxprotocol.dev/v0/public/{handle}?salt={...}`)
   is polled until it returns `200`; the JSON body carries
   `{ payload: { decryptionProof } }`. The salt is a fresh random 32-byte hex string used to
   nonce each decryption request.

4. **Verify on-chain:**
   The next transaction calls `Nox.publicDecrypt(handle, decryptionProof)`. The contract
   verifies the proof _and_ the handle's ACL (`isPubliclyDecryptable`); if valid, the
   plaintext is available to the contract for that call — and **only** that call; nothing is
   written to storage.

The `@iexec-nox/handle` SDK's `handleClient.publicDecrypt(handle)` returns
`{ value, solidityType, decryptionProof }`. It first checks on-chain ACL
(`isPubliclyDecryptable`); if the handle isn't publicly decryptable it can still decrypt
for the owner via the user's own keys (used by the activity feed).

### 4.4 Why Nox is _the core_

- **Privacy of balances:** `balanceOf[user]` and `debtOf[user]` are `euint256` (encrypted
  handles). A blockchain explorer sees only opaque 32-byte values. The _only_ parties who
  can read them are the user (via their keys) and the vault contract itself (via its own
  ACL allowances). No plaintext amounts ever touch storage.
- **Privacy of operations:** Borrow amounts are encrypted before they hit a transaction and
  only decrypted inside the borrow call via a gateway proof. Withdraw approval is computed
  as an _encrypted comparison_ (`balanceOf >= shares`) whose result is an `ebool` — the
  actual share/amount numbers stay hidden.
- **Verifiable proofs, not trust:** Decryption happens in the TEE and the resulting proof
  is verified _on-chain_, so the contract never blindly trusts anyone.
- **Events are encrypted too:** `Deposited`, `Withdrawn`, `Borrowed`, `Repaid`,
  `WithdrawPrepared` emit `euint256`/`ebool` handles, not values.

---

## 5. The contract — `contracts/HydanVault.sol`

### 5.1 Storage layout (very important for debugging)

Solidity slot layout for `HydanVault` (used for raw `eth_call` state-override testing):

| Slot   | Variable           | Type                                    |
| ------ | ------------------ | --------------------------------------- |
| 0      | `aavePool`         | `address`                               |
| 1      | `aToken`           | `address`                               |
| 2      | `totalShares`      | `uint256`                               |
| 3      | `balanceOf`        | `mapping(address => euint256)` — slot 3 |
| 4      | `debtOf`           | `mapping(address => euint256)` — slot 4 |
| 5      | `withdrawApproval` | `mapping(address => ebool)` — slot 5    |
| (next) | `healthStatus`     | `ebool`                                 |

Mapping slot formula: `keccak256(abi.encodePacked(key, mappingSlot))`. E.g. for user `U`,
`balanceOf[U]` = `keccak256(encodePacked([U, 3n]))`; `withdrawApproval[U]` =
`keccak256(encodePacked([U, 5n]))`. Knowing this let us **fake handle values with eth_call
state overrides** for local testing.

Immutables (`asset`, `aavePoolAddressesProvider`, `debtAsset`, `priceOracle`) are baked into
bytecode, not storage.

### 5.2 Constructor & one-time setters

```
constructor(address _asset, address _aavePoolAddressesProvider, address _debtAsset)
```

- Stores `asset`, `aavePoolAddressesProvider`, `debtAsset`, resolves and stores
  `priceOracle` via `IPoolAddressesProvider(_aavePoolAddressesProvider).getPriceOracle()`.
- Emits `VaultInitialized(asset, address(0))`.

```
setAavePool(address _aavePool)  // one-time, requires aavePool == address(0)
setAToken(address _aToken)      // one-time, requires aToken == address(0)
```

Two-step deploy: deploy contract → look up pool/aToken from Aave → call setters.
`deployNewWETH.mjs` does exactly this; `DeployWETH.ts` (Ignition) does it declaratively.

### 5.3 View functions

- **`totalAssets()`** → `IERC20(aToken).balanceOf(address(this))`. The vault's collateral
  is _aTokens_ (yield-bearing). Simple and correct because the vault only ever supplies.
- **`maxWithdrawable()`** — the money function. Reads Aave:
  `getUserAccountData(vault) → (collateralBase, debtBase, availableBorrowsBase,
currentLiquidationThreshold, ltv, healthFactor)`. Collateral and debt are in **USD
  base units with 8 decimals**; health factor is `1e18` precision.
  Logic:
  - If `debtBase == 0` → return `totalAssets()`.
  - `minCollateralBase = (debtBase * 10000 + liquidationThreshold - 1) / liquidationThreshold`
    (integer **ceiling** division so the vault never leaves itself at/under HF = 1).
  - If `collateralBase <= minCollateralBase` → return `0`.
  - Else `return ((collateralBase - minCollateralBase) * 1e18) / price` where
    `price = priceOracle.getAssetPrice(asset)` (WETH/USD, 8 decimals).
- **`previewDeposit(assets)`** / **`previewWithdraw(assets)`** — ERC-4626-style proportional
  share math against `totalShares`/`totalAssets()` (1:1 when `totalShares == 0`).

### 5.4 `deposit(assets, receiver)` → `euint256 shares`

1. `require(assets > 0, 'Amount must be > 0')`.
2. `sharesPlain = previewDeposit(assets)`; `require(sharesPlain > 0, 'Zero shares')`.
3. **Encrypt on-chain:** `shares = Nox.toEuint256(sharesPlain)` (hits NoxCompute on live
   networks; **cannot be forked**).
4. Pull WETH from `msg.sender`, `forceApprove(aavePool, assets)`, call
   `IPool(aavePool).supply(asset, assets, address(this), 0)` — the vault supplies **on
   behalf of itself**, so the aTokens accrue to the vault.
5. Share accounting: if `balanceOf[receiver]` is zero `bytes32`, set it; else
   `balanceOf[receiver] = balanceOf[receiver].add(shares)` (encrypted addition).
6. `totalShares += sharesPlain`.
7. `balanceOf[receiver].allow(receiver)` and `.allow(address(this))` — grant decryption ACL
   to the receiver and the contract.
8. Emit `Deposited(receiver, shares)` (the encrypted handle).

### 5.5 `prepareWithdraw(assets, onBehalfOf)` — step 1 of 2

1. `shares = previewWithdraw(assets)`; `require(shares > 0, 'Zero shares')`.
2. `sharesEncrypted = Nox.toEuint256(shares)`.
3. `canWithdraw = balanceOf[onBehalfOf].ge(sharesEncrypted)` → **`ebool`** (encrypted
   comparison, computed on-chain by Nox).
4. `withdrawApproval[onBehalfOf] = canWithdraw`.
5. `Nox.allowPublicDecryption(canWithdraw)` — lets the gateway decrypt just this boolean.
6. Emit `WithdrawPrepared(onBehalfOf, canWithdraw)` — the approval handle is read from this
   event log by the frontend/e2e.

Nothing moves yet. The _amount_ never leaks — only a boolean "has enough shares" handle.

### 5.6 `withdraw(approvalProof, assets, receiver, owner)` — step 2 of 2

1. `approved = Nox.publicDecrypt(withdrawApproval[owner], approvalProof)` —
   **verifies the gateway proof on-chain**; `require(approved, 'Withdraw not approved')`.
2. Reset the approval: `withdrawApproval[owner] = ebool.wrap(bytes32(0))` (one-time use).
3. **Safety cap:** `maxAssets = maxWithdrawable(); if (assets > maxAssets) assets = maxAssets;`
   — never lets the vault's health factor drop to liquidation.
4. `shares = previewWithdraw(assets)`; `require(shares > 0, 'Zero shares')`.
5. `sharesEncrypted = Nox.toEuint256(shares)`; `balanceOf[owner] = balanceOf[owner].sub(sharesEncrypted)`;
   `totalShares -= shares`.
6. `withdrawn = IPool(aavePool).withdraw(asset, assets, address(this))` (Aave returns actual
   amount after interest accrue), `IERC20(asset).safeTransfer(receiver, withdrawn)`.
7. Re-grant ACL (`allow(owner)`, `allow(address(this))`).
8. Emit `Withdrawn(owner, sharesEncrypted)`.

**Gas reality:** this function needs **~400–450k gas** (the bare `bytes(0)` revert alone
eats a lot). Callers must set an explicit high gas limit (frontend uses `800000n`).

### 5.7 `prepareBorrow(externalEuint256 encryptedAmount, bytes calldata inputProof)` — step 1 of 2

1. `amountEncrypted = Nox.fromExternal(encryptedAmount, inputProof)` — imports the user's
   encrypted amount handle, verifying the proof.
2. `.allow(address(this))`, `.allow(msg.sender)`, `Nox.allowPublicDecryption(amountEncrypted)`.

It only registers the handle. Note: the _actual amount plaintext_ isn't known to the
contract yet — it's decrypted in step 2 via the proof.

### 5.8 `borrow(_asset, encryptedAmount, decryptionProof, interestRateMode, referralCode, onBehalfOf)` — step 2 of 2

1. `amountEncrypted = euint256.wrap(externalEuint256.unwrap(encryptedAmount))`.
2. `assets = Nox.publicDecrypt(amountEncrypted, decryptionProof)` — verifies proof + ACL.
3. `require(assets > 0, 'Amount must be > 0')`.
4. Debt accounting: first borrow sets `debtOf[onBehalfOf] = amountEncrypted`, else
   `.add(amountEncrypted)`. Re-grant ACL for `onBehalfOf` and the contract.
5. `IPool(aavePool).borrow(_asset, assets, interestRateMode, referralCode, address(this))`.
   - `interestRateMode = 2` = variable rate (the mode the demo uses).
   - The vault borrows in its own name (collateral is the vault's aTokens).
6. `IERC20(_asset).safeTransfer(onBehalfOf, assets)` — user receives the borrowed USDC.
7. Emit `Borrowed(onBehalfOf, amountEncrypted, interestRateMode)`.

### 5.9 `repay(_asset, assets, interestRateMode, onBehalfOf)`

1. `require(assets > 0, ...)`.
2. `safeTransferFrom(onBehalfOf, this, assets)`, `forceApprove(aavePool, assets)`,
   `IPool(aavePool).repay(_asset, assets, interestRateMode, address(this))`.
3. `assetsEncrypted = Nox.toEuint256(assets)`; `debtOf[onBehalfOf] = debtOf[onBehalfOf].sub(assetsEncrypted)`;
   re-grant ACL.
4. Emit `Repaid(onBehalfOf, assetsEncrypted)`.

Note: repay is **not** two-step (amount is revealed in the calldata) — a deliberate
simplification; the sensitive reads (balances) stay encrypted.

### 5.10 `updateHealthStatus(externalEuint256 encryptedHealthFactor, bytes inputProof, uint256 threshold)`

1. `healthFactor = Nox.fromExternal(encryptedHealthFactor, inputProof)`.
2. `isHealthy = healthFactor.gt(Nox.toEuint256(threshold))` → `ebool`.
3. Store `healthStatus = isHealthy`; `Nox.allowPublicDecryption(isHealthy)`.
4. Emit `HealthStatusUpdated(address(this), isHealthy)`.

This is the "privacy-aware health" primitive: a third party (a keeper/TEE job) can
encrypt the health factor and the contract turns it into a public **boolean** — the world
sees "healthy/at risk", never the number. The frontend currently reads Aave's own health
factor directly; this function is the future-proofed on-chain health gate (the Automation
screen's copy references it).

### 5.11 Events (all encrypted)

| Event                 | Args                                                      |
| --------------------- | --------------------------------------------------------- |
| `VaultInitialized`    | `asset indexed`, `aavePool`                               |
| `Deposited`           | `user indexed`, `shares` (`euint256`→`bytes32`)           |
| `Withdrawn`           | `user indexed`, `shares` (`euint256`)                     |
| `Borrowed`            | `user indexed`, `amount` (`euint256`), `interestRateMode` |
| `Repaid`              | `user indexed`, `assets` (`euint256`)                     |
| `WithdrawPrepared`    | `user indexed`, `approval` (`ebool`)                      |
| `HealthStatusUpdated` | `vault indexed`, `isHealthy` (`ebool`)                    |

The ABI also surfaces two errors: `MalformedDecryptedData(bytes data)` and
`SafeERC20FailedOperation(address token)` (from OpenZeppelin).

### 5.12 Design decisions & anti-patterns avoided

- Shares computed **on-chain** (`previewDeposit`), never user-supplied — fixes a critical
  vulnerability where users could mint arbitrary shares.
- No upgradeable proxies, no config-everything constructors, no custom error library —
  explicitly required by `AGENTS.md` (anti-slop rules).
- `asset`/`debtAsset` separated so the vault can borrow a _different_ token than it accepts
  as collateral (WETH in, USDC out).

---

## 6. End-to-end flows (what a user actually does)

### 6.1 Deposit

1. (UI) User has ETH. If WETH balance < amount, frontend **auto-wraps** ETH→WETH via
   `wethAbi.deposit()` (payable) and waits for receipt.
2. If WETH allowance < amount, frontend approves vault for `amount`, waits for receipt.
3. Calls `vault.deposit(amount, user)` with `gas: 800000n`. Vault transfers WETH, supplies
   to Aave, encrypts shares, updates storage, emits `Deposited`.

### 6.2 Borrow (2-step, encrypted)

1. UI calls `handleClient.encryptInput(usdcAmount, 'uint256', vaultAddress)`
   → `{ handle, handleProof }`. Amount is never sent in plaintext.
2. `vault.prepareBorrow(handle, handleProof)` with `gas: 200000n`.
3. UI polls `https://gateway-testnets.noxprotocol.dev/v0/public/{handle}?salt={random32bytes}`
   every 1s (max 30 tries) until `200` → reads `payload.decryptionProof`.
4. `vault.borrow(USDC, handle, decryptionProof, 2, 0, user)` with `gas: 800000n`. Vault
   verifies the proof, borrows USDC from Aave, transfers to user, tracks encrypted debt.

### 6.3 Repay

1. If USDC allowance < amount, approve vault.
2. `vault.repay(USDC, amount, 2, user)` with `gas: 800000n`. Vault pulls USDC, repays Aave,
   subtracts from encrypted `debtOf`.

### 6.4 Withdraw (2-step via TEE comparison)

1. `vault.prepareWithdraw(amount, user)` with `gas: 300000n` — does the encrypted balance
   check, stores an `ebool`, emits `WithdrawPrepared`.
2. UI reads the `WithdrawPrepared` log from the receipt block to get the `approval` handle.
3. Polls the gateway for the approval handle until `200` → decryptionProof.
4. `vault.withdraw(decryptionProof, amount, user, user)` with `gas: 800000n`. Vault verifies
   the proof, caps at `maxWithdrawable()`, withdraws from Aave, transfers WETH to user.

### 6.5 Live proof

`scripts/e2e_full_cycle.mjs` runs the whole cycle on real Sepolia:
deposit `0.004 WETH` → borrow `0.5 USDC` → repay `0.5 USDC` → withdraw
`maxWithdrawable()` WETH. Known-good post-run state: `totalAssets ≈ 9.125e-10 WETH`
(dust), `collateralBase = 364`, `debtBase = 300`.

---

## 7. Frontend (`frontend/`)

### 7.1 Files

- `src/main.jsx` — wagmi setup: `createConfig({ chains: [sepolia], connectors: [injected()], transports: { [sepolia.id]: http(import.meta.env.VITE_SEPOLIA_RPC_URL) } })`, React Query provider. Only injected (MetaMask/Rabby/etc.) connector.
- `src/App.jsx` — the whole UI (1058 lines): theming, nav, landing, vault screen + modals,
  explorer, automation, toast.
- `src/hooks.js` — all wagmi read/write hooks + the activity feed hook + Nox SDK usage.
- `src/ActivityFeed.jsx` — renders the decrypted activity list with `Lock + "Encrypted"`
  fallback when a handle can't be decrypted.
- `src/abi/HydanVault.json` — hand-synced 34-entry ABI (must match contract; events emit
  `bytes32` handles).
- `src/index.css` — Tailwind directives + small utility layers.
- `frontend/.env.example` → `VITE_SEPOLIA_RPC_URL=...` (real `.env` is gitignored).

### 7.2 Key constants (hard-coded in `hooks.js` / `App.jsx`)

```
VAULT = 0xb05c9770e926bf193f1d69a4490591ab18e6a12a
WETH  = 0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c
USDC  = 0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8
```

### 7.3 Health-factor display logic (`VaultScreen`)

- `aaveData[5]` is Aave's health factor (`1e18` precision). If `>= 2^255` treat as infinity
  (`∞`). `hfNum = Number(hf)/1e18`.
- **Dust detection:** `isDust = collateralBase < 100000n && debtBase < 100000n`
  (both < 0.000001 in USD base units) → the position is effectively empty, so the UI shows
  a neutral `—` / "No position" in `inkFaint`/`chip` colors _instead_ of a scary red
  "1.00 Liquidation" (dusty real positions read HF ≈ 1).
- Labels: `> 3 → "Safe"`, `> 1.5 → "Moderate"`, `> 1.05 → "Risky"`, else `"Liquidation"`.
  Colors map through `c.green / c.gold / c.orange / c.carmine` with soft backgrounds.
- The big health display is wrapped in a **blur reveal** (`reveal-mask`), matching the
  privacy story: hover/focus to reveal your numbers.
- "Publicly, this vault only ever shows as healthy/at risk" — the privacy promise.

### 7.4 Action modals (`ActionModal`)

- Shared modal for the 4 actions. Input sanitized by `sanitizeDecimal` (strips non
  numeric/decimal chars, keeps a single dot).
- **Deposit:** wraps ETH if needed, approves if needed, then `deposit`.
- **Borrow:** `encryptInput` → `prepareBorrow` → gateway poll → `borrow`.
- **Repay:** approve USDC → `repay`.
- **Withdraw:** `prepareWithdraw` → parse log for approval handle → gateway poll → `withdraw`.
- Explicit gas: deposit/borrow/repay/withdraw `800000n`, prepareWithdraw `300000n`,
  prepareBorrow `200000n`.
- Button states: `wrapping / approving / encrypting / preparing / waiting ("Awaiting proof")
/ pending / success / error`, with a spinner via `Loader2`.

### 7.5 Activity feed (`useVaultActivity`)

- **Initial fetch:** takes latest block, queries events for `Deposited`, `Withdrawn`,
  `Borrowed`, `Repaid` filtered by `user: address` with `fromBlock = block - 9n`,
  `toBlock = block` (**Alchemy free tier caps eth_getLogs at a 10-block range**).
- For each event: field = `amount` (Borrowed), `assets` (Repaid), `shares` (others);
  decrypts via `handleClient.publicDecrypt(handle)`. Fetch block timestamps in parallel.
- **Live updates:** four `useWatchContractEvent` subscriptions; new events are merged and
  de-duplicated by `txHash`, sorted newest-block-first.
- Renders via `ActivityFeed.jsx` with `fmtAmount` (USDC ÷1e6, 2dp; ETH ÷1e18, 4dp),
  `timeAgo`, and a Lock+Encrypted row when decryption fails (not owner / not public).

### 7.6 Screens / UX

- **Landing:** big "hýdan" wordmark, "Borrow on Aave without broadcasting your balance
  sheet." ProofCard "Same loan, two views" — left: Aave public record (the raw
  `healthStatus` handle, truncated `0x…`), right: "hýdan · decrypted for you → healthy".
- **Vault:** health hero card, 4 action cards (Deposit/Repay green, Borrow/Withdraw carmine),
  activity feed on desktop right rail.
- **Explorer:** a single vault row (`0xb05c…6a12a`), "Healthy" if Aave HF ≥ 1e18, stats
  chips, search box (filters the one vault by id).
- **Automation:** auto-repay toggle (defaults on), threshold input (default `1.20`), and the
  privacy line: "The trigger check runs inside Nox on your encrypted position. Nobody,
  including hýdan, sees the comparison happen."
- **Theme:** light/dark palettes (`PALETTES`), `hýdan` wordmark, `Bagel Fat One` numerics,
  `Manrope` body, `Schibsted Grotesk` wordmark (loaded via `useGoogleFonts`).
- Footer: "Built on Nox × Aave — Sepolia testnet", GitHub link, iExec WTF Hackathon link.

### 7.7 Build quirk

`frontend/package.json` build script:
`NODE_OPTIONS=--max-old-space-size=2048 vite build` — the Codespace has ~8GB RAM; two VS
Code tsservers (~1.6GB each) were OOMing the default build, so the heap is capped. Build
takes ~14–25s and emits `dist/` (gitignored).

---

## 8. Scripts & tooling (root `scripts/`, `ignition/`)

### 8.1 Kept (current)

- **`scripts/e2e_full_cycle.mjs`** — the live demo/proof (§6.5). Reads
  `SEPOLIA_PRIVATE_KEY` + `SEPOLIA_RPC_URL` from env; loads ABI from
  `frontend/src/abi/HydanVault.json`. Its own `waitForGateway(handle, maxWait=30)` helper.
- **`scripts/deployNewWETH.mjs`** — raw-viem deploy used for the live vault: deploys
  `HydanVault(WETH, PoolAddressesProvider, USDC)`, then `setAavePool(POOL)`, then resolves
  aWETH via the data provider and `setAToken(aWETH)`. Reads env vars the same way.
- **`ignition/modules/DeployWETH.ts`** — declarative Ignition equivalent (used by
  `pnpm deploy:weth`), including `m.staticCall` for `getPool` and
  `getReserveTokensAddresses`.
- **`scripts/mintTestUSDC.ts`** (`pnpm mint:usdc`) — mints USDC via Aave's faucet contract.
- **`scripts/wrapWETH.ts`** (`pnpm mint:weth`) — wraps ETH→WETH via the WETH `deposit()`.
- **`hardhat.config.ts`** — profiles with `viaIR`, networks: `hardhatMainnet`,
  `hardhatOp`, `hardhatSepolia` (EDR fork), `sepolia` (HTTP, hardhat vars for RPC + key).

### 8.2 Deleted during cleanup (for the record)

`deploy.ts`, `Deploy.ts`, `DeployGHO.ts`, `mintGHO.ts`, `mintTestDAI.ts`, `testDeposit.ts`,
`testPooledDeposit.ts`, `updateHealthFactor.ts`, `runUpdateHealthFactor.mjs`,
`testNoxSepolia.ts`, `checkReserveCap.ts`, `checkAllReserveCaps.ts`, `raiseSupplyCap.ts`,
the stale `test/unit/HydanVault.test.ts`, two backup `App*.jsx` files, and ~44 scratch
scripts (all `check_*.mjs`, `debug_borrow*.mjs`, `direct_*_test.mjs`, `traceRevert*.ts`,
`e2e_*_test/debug/final.mjs`, etc.). Removed unused tooling: `husky`, `lint-staged`,
`chai`. Removed the broken `test` npm script (no local tests exist; verification is the
live e2e).

---

## 9. Deployment procedure (from scratch)

```bash
# 1. Secrets (Hardhat 3 uses its vars store, not .env, for hardhat CLI)
npx hardhat vars set SEPOLIA_RPC_URL
npx hardhat vars set SEPOLIA_PRIVATE_KEY

# 2. Install + compile
pnpm install
pnpm compile

# 3. Deploy (either)
pnpm deploy:weth                # Ignition
# or
set -a; source .env; set +a     # exports SEPOLIA_PRIVATE_KEY + SEPOLIA_RPC_URL
node scripts/deployNewWETH.mjs  # raw viem

# 4. Fund a test wallet (optional)
pnpm mint:weth
pnpm mint:usdc

# 5. Prove it works
set -a; source .env; set +a
node scripts/e2e_full_cycle.mjs

# 6. Frontend
cd frontend
cp .env.example .env            # fill VITE_SEPOLIA_RPC_URL
npm install
npm run dev
```

---

## 10. Testing & verification philosophy

- **No mock data** (hackathon judging criterion). The one test that matters is the live
  `e2e_full_cycle.mjs` against real Sepolia: real Aave, real Nox gateway, real proofs.
- Local unit tests were removed because Nox's `toEuint256` calls
  `NoxCompute.wrapAsPublicHandle`, which the local Hardhat Nox test stack does **not**
  implement — so any meaningful test (deposit → encrypted balance) can't run locally.
- **Fork debugging is a dead end:** because `Nox.toEuint256` is a live-network-only call,
  a Sepolia fork can't repro deposit/borrow flows. (EDR forks also default to the latest
  _safe_ block, which lags, making fork state look drained; `cache/edr-fork-cache` held
  stale state and was deleted.)
- Testing tricks that _did_ work:
  - **`eth_call` with state overrides** to fake storage slots (using the §5.1 layout) so
    view functions like `maxWithdrawable()` could be exercised without real txs.
  - The vault's own `withdrawApproval` slot holding a **public-decryptable** ebool handle
    (e.g. `0x0000aa36a700012bc8c6f540a95cb2607ac658dd2172b9fdf84dc388d33e62b0` returns
    `isPubliclyDecryptable`/`isViewer` = true) for override-based withdraw testing.

---

## 11. Repository layout (current, post-cleanup)

```
.
├── AGENTS.md                     # build rules (anti-slop, conventions)
├── README.md                     # concise public overview
├── PROJECT_DOCUMENTATION.md      # this file
├── hardhat.config.ts
├── package.json / pnpm-lock.yaml
├── .env.example                  # documents hardhat vars (root .env is gitignored)
├── contracts/HydanVault.sol
├── ignition/modules/DeployWETH.ts
├── scripts/
│   ├── deployNewWETH.mjs
│   ├── e2e_full_cycle.mjs
│   ├── mintTestUSDC.ts
│   └── wrapWETH.ts
├── frontend/
│   ├── package.json
│   ├── .env.example
│   └── src/
│       ├── main.jsx / App.jsx / ActivityFeed.jsx / hooks.js / index.css
│       └── abi/HydanVault.json
└── .gitignore                    # node_modules, dist, artifacts, cache, .env, ignition deployments
```

---

## 12. Git history (highlights)

- `b0ce0bf` Initial commit → `6ebc206` agent build rules → `1c87533` first contract + Aave
  fork setup.
- Reserve-cap saga: fixing Aave Sepolia supply-cap helpers (`486d6ce`, `1b4a991`,
  `dede3fb`, `042cc91`, `875e783`).
- `225c3b2` pooled ERC-4626 architecture; `df74c39` Nox-encrypted balances; `bc7567e`
  **critical fix** — on-chain share computation instead of user-supplied encrypted shares.
- Multi-asset era (USDC/DAI/GHO) then convergence on **single WETH vault**.
- `8dfbe55`/`616a9a8` health-factor tracking; `c368907` encrypt for vault address fix.
- Frontend: `6c69f0e` → `2133c26` real contract calls → `f3e8401` design restore →
  `da0c4fd` merge → `958bcda` wire-up → `bf78a0a` new UI → `f612d9a`/`ed14d04` fixes →
  `d850967` "encrypted vault with Aave v3, activity feed, dust-safe withdraw".
- `bb360f6` (latest) cleanup: stripped stale scripts/modules/tooling, README sync.

---

## 13. Hard-won gotchas & debugging notes (read before touching anything)

1. **Nox encrypt/decrypt is network-live only.** `toEuint256` → `wrapAsPublicHandle` on the
   NoxCompute contract; **never fork-reproducible**. Don't waste time on fork repros.
2. **Gateway protocol:** `GET https://gateway-testnets.noxprotocol.dev/v0/public/{handle}?salt={32-byte-hex}`
   returns `200` only once decryption is ready; poll every ~1s up to 30s.
   Body shape: `{ payload: { decryptionProof } }`.
3. **SDK shapes:** `handleClient.encryptInput(value, type, contractAddr)` →
   `{ handle, handleProof }`; `handleClient.publicDecrypt(handle)` →
   `{ value, solidityType, decryptionProof }` and it checks on-chain ACL first.
4. **Aave precision triple:** HF is `1e18`; collateral/debt base units are 8 decimals (USD);
   withdraw math `(collateralBase*LT >= debtBase*10000)` uses integer/ceiling boundaries —
   an exact HF = 1 simulation still reverts, so always leave ≥ 1 unit margin.
5. **Alchemy free tier:** `eth_getLogs` is capped at a **10-block range** → frontend pins
   `fromBlock = latest - 9n` / `toBlock = latest`; `debug_traceCall` is **not** available.
   `eth_call` with state overrides _is_ supported.
6. **Withdraw is gas-hungry (~400–450k).** Never omit the gas limit; frontend and e2e use
   `800000n` (deposit/borrow/repay/withdraw), `300000n` (prepareWithdraw), `200000n`
   (prepareBorrow). Auto-estimation can under-cap and you'll see bare `bytes(0)` reverts
   (which read as out-of-gas / empty error).
7. **OOM memory management:** Codespace ~8GB; the two VS Code tsservers are the OOM culprits
   for `vite build`. Either kill them or rely on the capped-heap build script.
8. **`.env` vs hardhat vars:** Hardhat CLI reads `SEPOLIA_RPC_URL`/`SEPOLIA_PRIVATE_KEY`
   from hardhat vars; the plain node scripts (`e2e_full_cycle.mjs`, `deployNewWETH.mjs`)
   read them from env — hence `set -a; source .env; set +a`. The `.env` files are
   gitignored.
9. **Fund the deployer!** Deployer `0x2b374aDd…` briefly drained to ~0.00027 ETH (the cause
   of several "failed" txs); it now holds ~0.06 ETH.
10. **Storage overrides** use the §5.1 slot map for fake-balance testing
    (`balanceOf` slot 3, `debtOf` slot 4, `withdrawApproval` slot 5 via
    `keccak256(encodePacked([addr, slot]))`).
11. **`abi` sync:** `frontend/src/abi/HydanVault.json` must match the compiled artifact;
    event args are `bytes32` (the handles). Keep them in sync or the feed/parsing breaks.
12. **Prettier formatting is safe** on the contract (whitespace/quote-only; bytecode is
    identical since solc strips it) — `pnpm lint`/`pnpm format` gate style.

---

## 14. Security & privacy properties (summary for judges)

- **Confidentiality:** user balances and debts are `euint256` handles in storage; amounts
  never appear as plaintext on-chain. Events only emit handles.
- **Verifiability:** every decryption used for control flow (borrow amount, withdraw
  approval) is gated by a gateway-produced proof verified on-chain via
  `Nox.publicDecrypt` against the handle's ACL.
- **Integrity of accounting:** shares are computed on-chain (no user-supplied numbers),
  balances are updated with encrypted add/sub under the Nox library, and the vault never
  drops below `maxWithdrawable()` during withdrawals.
- **Non-goals (deliberate):** repay reveals its amount in calldata; interest-rate mode is
  fixed at variable; single vault (WETH collateral / USDC debt); no liquidation
  incentives within the vault itself (Aave handles liquidations on the vault's aggregate
  position).
- **Trust model:** you must trust Nox's TEE + gateway for decryption proofs, and Aave for
  the underlying pool math. hydan adds no trusted third parties beyond those.

---

## 15. FAQ

- **What happens if the gateway is down?** Borrow and withdraw wait loops time out after
  30s and the UI shows "Gateway timeout" / "Awaiting proof" states; the chain state is
  untouched (prepareBorrow/prepareWithdraw are inert until the proof arrives).
- **Can anyone read my balance?** Only you (via your keys), the vault contract, and — for
  the specific handles we mark public (the withdraw-approval ebool, health ebool) — the
  world, and those are just booleans.
- **Why 2 steps?** The TEE gateway needs a beat to decrypt and mint a proof after the
  handle is registered on-chain; the second tx consumes that proof. It's the price of
  verifiable privacy.
- **Why does the explorer show one vault?** The hackathon demo is a single deployed vault
  (`0xb05c…`). The UI is built to accommodate more (the list + search are data-driven).
