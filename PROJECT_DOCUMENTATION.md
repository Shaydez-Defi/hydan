# hydan — Complete Project Documentation

Every technical detail about the hydan project: what it is, how it works, and how it was
verified. This is the single source of truth for anyone (including future-me) who needs to
understand the system without reading every file.

---

## 1. One-paragraph summary

hydan is a **private lending vault** built as a solo hackathon entry for the **iExec WTF
Hackathon** (Nox + Aave track, Sepolia). Users deposit **WETH** as collateral and borrow
**USDC** against it — exactly like a normal Aave position — but each user's balance and debt
are stored on-chain as **unique Nox-encrypted handles** (`euint256`). Reading `balanceOf[user]`
or `debtOf[user]` from a block explorer returns an opaque ciphertext that the Nox gateway
refuses to serve publicly (HTTP `403`) and that only the position owner can decrypt with
their own keys. Sensitive checks (withdraw approval, books-invariant) are computed **inside
Nox's TEE** on the encrypted values and only the resulting booleans ever surface on-chain.
A polished React frontend (Vite + wagmi/viem + Tailwind) exposes Deposit, Borrow, Repay and
Withdraw plus an activity feed.

---

## 2. Project status

- Solo hackathon build, **time-boxed ~10 days**, judged partly on _working end-to-end
  functionality with no mock data_.
- Every flow is **live and verified on Sepolia**: deposit, borrow, withdraw (with the
  health-cap), and repay. Each verified path left a unique private handle (gateway `403`,
  owner decrypt correct).
- **Live position** on the shipping vault: **0.02 WETH collateral, 15 USDC debt,
  health factor ≈ 4.4** (at `0x330b5c…`).
- **All live addresses** (Sepolia):

  | Item                        | Address                                      |
  | --------------------------- | -------------------------------------------- |
  | HydanVault (v3, shipping)   | `0x330b5c509bc1621585e88dc4c07b763e4a399fba` |
  | HydanVault (v3, superseded) | `0xeaa3f8928c4d443e38cf02298afd0e7e3a19e0d5` |
  | HydanVault (v2, superseded) | `0x2441c46db1b18c5a424524f61795d35355f817af` |
  | asset (WETH)                | `0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c` |
  | debtAsset (USDC)            | `0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8` |
  | Aave V3 Pool                | `0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951` |
  | Aave PoolAddressesProvider  | `0x012bAC54348C0E635dCAc9D5FB99f06F24136C9A` |
  | Aave aWETH (aToken)         | `0x5b071b590a59395fE4025A0Ccc1FcC931AAc1830` |
  | Aave ProtocolDataProvider   | `0x3e9708d80f7B3e43118013075F7e95CE3AB31F31` |
  | Nox ACP (testnets)          | `0x24ef36ec5b626d7dcd09a98f3083c2758f0f77bf` |

- Deployer account: `0x2b374aDd4b86Ab1bf6196D1f698Eeb77156aA0F0` (owns the vaults, paid all
  deploy + e2e gas).
- Git remote: `https://github.com/Shaydez-Defi/hydan`, branch `main`.

---

## 3. Stack at a glance

| Layer             | Tech                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------- |
| Contracts         | Solidity `0.8.35`, Hardhat 3 (`hardhat.config.ts`), Nox SDK contracts                       |
| Compiler settings | `viaIR: true`, optimizer `{ enabled: true, runs: 200 }`                                     |
| Deploys           | Raw viem script (`scripts/deployNewWETH.mjs`); Ignition module kept for declarative deploys |
| Nox SDK (JS)      | `@iexec-nox/handle` v`0.1.0-beta.13`                                                        |
| Nox contract lib  | `@iexec-nox/nox-protocol-contracts` v`0.2.4`, `encrypted-types` v`0.0.4`                    |
| Yield             | Aave V3 Sepolia                                                                             |
| Frontend          | Vite 6 + React 19 + wagmi 2 + viem 2 + @tanstack/react-query 5 + Tailwind 3                 |
| RPC               | Alchemy free tier (Sepolia), see gotchas in §13                                             |

---

## 4. Nox — the core of the project (deep dive)

### 4.1 What Nox is

[Nox](https://docs.noxprotocol.io) is iExec's confidential-computing protocol for Ethereum.
It lets smart contracts hold and compute on **encrypted values** while staying deterministic
and auditable:

- A value is encrypted into a **handle** — a `bytes32` ciphertext reference — that nobody can
  read as plaintext without the right keys.
- The heavy lifting (encryption, key management, decryption, proving) is done by the **Nox
  gateway** (off-chain, inside a **TEE / secure enclave**).
- The SDK (`@iexec-nox/handle`) provides `encryptInput`, `decrypt`, and `publicDecrypt` so
  apps can encrypt inputs and fetch proofs.

### 4.2 Empirically verified Nox behavior (this repo's ground truth)

A series of live-Sepolia probes (`HandleProbe`) established exactly how Nox behaves on the
testnet gateway. These facts drive every design decision:

- **`encryptInput(value, type, contractAddress)` returns a UNIQUE handle every time.** Byte 6
  of the handle is `0x01` for unique/randomized handles. Each encryption is salted, so the
  same plaintext never produces the same ciphertext.
- **Unique handles are NOT publicly decryptable.** `GET /v0/public/{handle}` on a fresh
  unique handle returns **HTTP 403 `access_denied` ("not publicly decryptable")**.
- **Compute results are unique and private too.** `add`, `sub`, `ge`, `eq` results all have
  byte 6 = `0x01` and `isPubliclyDecryptable = false`. A computed handle has **no viewers by
  default** — the contract must explicitly call `Nox.addViewer(handle, addr)` for the owner
  to decrypt it.
- **Owner decryption works via the authenticated path.** After `addViewer(handle, owner)`,
  `handleClient.decrypt(handle)` returns the correct plaintext (verified: `add` → `425242`,
  `sub(500000,300000)` → `200000`, deposit balance → `20000000000000000`).
- **On-chain decryption requires a public handle.** `Nox.publicDecrypt(handle, proof)`
  verifies the gateway proof (signature check) — but the gateway only mints proofs for
  handles that are `allowPublicDecryption`-marked. So any value a contract must decrypt
  on-chain is necessarily public; everything it _stores_ stays private.

### 4.3 The request/response dance

1. **Encrypt (off-chain):** `handleClient.encryptInput(value, 'uint256', vault)` →
   `{ handle, handleProof }`. The app submits both in a tx.
2. **Register on-chain:** the vault calls `Nox.fromExternal(handle, handleProof)` (validates
   the proof), then grants ACL: `.allow(contract)`, `.allow(user)`, and where the value must
   stay confidential, `Nox.addViewer(handle, user)`.
3. **Decrypt (off-chain via gateway):** poll
   `https://gateway-testnets.noxprotocol.dev/v0/public/{handle}?salt={32-byte-hex}` until
   `200`; the body carries `{ payload: { decryptionProof } }`. Salt must be fresh per request.
4. **Verify on-chain:** the next tx calls `Nox.publicDecrypt(handle, decryptionProof)`; the
   plaintext is available for that one call only and is never stored.

---

## 5. The contract — `contracts/HydanVault.sol`

### 5.1 Storage layout

| Variable                    | Type                           | Notes                                         |
| --------------------------- | ------------------------------ | --------------------------------------------- |
| `asset`                     | `address immutable`            | WETH (baked into bytecode)                    |
| `aavePool`                  | `address`                      | set once via `setAavePool`                    |
| `aavePoolAddressesProvider` | `address immutable`            | baked into bytecode                           |
| `debtAsset`                 | `address immutable`            | USDC (baked into bytecode)                    |
| `priceOracle`               | `address immutable`            | resolved from Aave provider                   |
| `aToken`                    | `address`                      | set once via `setAToken`                      |
| `balanceOf`                 | `mapping(address => euint256)` | confidential per-user balance (unique handle) |
| `debtOf`                    | `mapping(address => euint256)` | confidential per-user debt (unique handle)    |
| `withdrawApproval`          | `mapping(address => ebool)`    | one-time public boolean per user              |
| `booksInvariant`            | `mapping(address => ebool)`    | one-time public boolean per user              |
| `aggregateBalance`          | `euint256`                     | encrypted sum of all balances                 |
| `totalDeposited`            | `uint256`                      | plaintext sum of all deposits                 |
| `healthStatus`              | `ebool`                        | informational public boolean                  |

### 5.2 Constructor & one-time setters

```
constructor(address _asset, address _aavePoolAddressesProvider, address _debtAsset)
setAavePool(address)   // one-time
setAToken(address)     // one-time
```

Two-step deploy: deploy → look up pool/aToken → call setters (`deployNewWETH.mjs` does this).

### 5.3 View functions

- **`totalAssets()`** → `aToken.balanceOf(this)` (yield-bearing aTokens).
- **`maxWithdrawable()`** → reads `getUserAccountData(vault)`. If `debtBase == 0` returns
  `totalAssets()`; else
  `minCollateralBase = ceil(debtBase * 10000 / liquidationThreshold)` and returns
  `((collateralBase - minCollateralBase) * 1e18) / price` (or `0` if collateral already at the
  liquidation edge). This is the health-safe ceiling used by `withdraw`.

### 5.4 `deposit(uint256 assets, address receiver, externalEuint256 encryptedAssets, bytes inputProof)`

1. `require(assets > 0)`.
2. `amount = Nox.fromExternal(encryptedAssets, inputProof)` — import the user's encrypted
   amount handle, verifying the proof.
3. Pull `assets` WETH from `msg.sender`, `forceApprove` the pool, `supply` to Aave (the vault
   supplies on its own behalf → aTokens accrue to the vault).
4. **Store without ever decrypting:** `balanceOf[receiver] = balanceOf[receiver].add(amount)`;
   `aggregateBalance += amount`; `totalDeposited += assets`.
5. Grant ACL: `allow(receiver)`, `allow(this)`, **`addViewer(balanceOf[receiver], receiver)`**
   so the owner can decrypt. **Never** `allowPublicDecryption` — the balance stays private.
6. Emit `Deposited(receiver, balanceOf[receiver])`.

> The vault deliberately does **not** verify `encryptedAssets == assets`. Verification would
> require decrypting the handle on-chain, which forces it public. Instead the soundness comes
> from the aggregate invariant (§5.6): an overstated declaration makes
> `aggregateBalance != totalDeposited`, which blocks every withdrawal.

### 5.5 `prepareWithdraw(uint256 assets, address onBehalfOf)` — step 1 of 2

1. `require(msg.sender == onBehalfOf, 'Only the position owner can prepare a withdrawal')` —
   **blocks the cross-user balance oracle** (see §14).
2. `canWithdraw = balanceOf[onBehalfOf].ge(toEuint256(assets))` → **ebool**, computed on the
   encrypted balance inside the TEE.
3. `booksOk = aggregateBalance.eq(toEuint256(totalDeposited))` → **ebool**. This is the
   soundness gate: it proves the sum of all encrypted balances still equals the plaintext sum.
4. Store both, `allowPublicDecryption` both (they're booleans — safe to reveal), emit
   `WithdrawPrepared` / `BooksPrepared`.

Nothing moves yet. The only information that can leave the TEE is "≥ X?" and "books match?".

### 5.6 `withdraw(bytes approvalProof, bytes invariantProof, uint256 assets, address receiver, address owner)` — step 2 of 2

1. `require(msg.sender == owner, 'Only the position owner can withdraw')` — prevents an
   attacker from front-running a prepared withdrawal and redirecting the funds.
2. `approved = publicDecrypt(withdrawApproval[owner], approvalProof)`; `require(approved)`.
3. `booksOk = publicDecrypt(booksInvariant[owner], invariantProof)`; `require(booksOk,
'Confidential books are inconsistent')`. **If any user ever overstated their balance, this
   fails for everyone** — the position freezes rather than letting fake balances cash out.
4. One-time reset of both ebools.
5. **Health cap:** `if (assets > maxWithdrawable()) assets = maxWithdrawable();` — never drops
   the vault below its liquidation edge.
6. `balanceOf[owner] -= toEuint256(assets)` (capped amount); `aggregateBalance -= …`;
   `totalDeposited -= assets`.
7. `pool.withdraw(...)` → `safeTransfer(receiver, withdrawn)`; re-grant ACL + `addViewer`.
8. Emit `Withdrawn(owner, assetsEncrypted)`.

Gas: **~444k** (measured live). `prepareWithdraw`: **~163k**.

### 5.7 `prepareBorrow(externalEuint256 encryptedAmount, externalEuint256 encryptedStorage, bytes amountInputProof, bytes storageInputProof)` — step 1 of 2

1. Import both handles via `fromExternal` (verifies both proofs).
2. `allow(this)`, `allow(msg.sender)` on both.
3. `allowPublicDecryption(amount)` — **only the amount handle**. The borrow amount has to be
   decrypted on-chain to call Aave, and Aave publicly emits the borrow anyway.

The **storage handle is never made public** — it becomes the confidential `debtOf`.

### 5.8 `borrow(address _asset, externalEuint256 encryptedAmount, externalEuint256 encryptedStorage, bytes storageInputProof, bytes decryptionProof, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)` — step 2 of 2

1. `amount = euint256.wrap(unwrap(encryptedAmount))`; `assets = publicDecrypt(amount,
decryptionProof)`; `require(assets > 0)`.
2. `storageHandle = fromExternal(encryptedStorage, storageInputProof)` — re-verified; this is
   the handle stored as the user's debt.
3. `debtOf[onBehalfOf] = debtOf[onBehalfOf].add(storageHandle)`; grant ACL + `addViewer` —
   **debt stays private**.
4. `pool.borrow(_asset, assets, interestRateMode=2, referralCode=0, this)` (variable rate,
   vault borrows in its own name against its own aTokens).
5. `safeTransfer(onBehalfOf, assets)` — the user gets the USDC.
6. Emit `Borrowed(onBehalfOf, debtOf[onBehalfOf], interestRateMode)`.

Gas: **~368–400k** measured.

### 5.9 `repay(address _asset, uint256 assets, uint256 interestRateMode, address onBehalfOf)`

1. `safeTransferFrom(onBehalfOf, this, assets)` (needs an approval), `forceApprove` pool,
   `pool.repay(...)`.
2. `debtOf[onBehalfOf] = debtOf[onBehalfOf].sub(toEuint256(assets))`; re-grant ACL +
   `addViewer`.
3. Emit `Repaid(onBehalfOf, assetsEncrypted)`.

Repay is deliberately one-step and its amount is plaintext (Aave emits it anyway). Gas:
**~310k** measured. Verified round-trip (borrow 5 → repay 5) leaves `debtOf` decrypting to the
correct remaining 15 USDC with a fresh unique private handle.

### 5.10 `updateHealthStatus(externalEuint256 encryptedHealthFactor, bytes inputProof, uint256 threshold)`

Turns an encrypted health factor into a public `healthStatus` boolean (`gt(threshold)`).
Informational in the demo (the frontend reads Aave's HF directly); it is the on-chain
"healthy / at risk" gate for keepers.

### 5.11 Events (all encrypted handles)

| Event                 | Args                                                      |
| --------------------- | --------------------------------------------------------- |
| `VaultInitialized`    | `asset indexed`, `aavePool`                               |
| `Deposited`           | `user indexed`, `balance` (`euint256`)                    |
| `Withdrawn`           | `user indexed`, `assets` (`euint256`)                     |
| `Borrowed`            | `user indexed`, `amount` (`euint256`), `interestRateMode` |
| `Repaid`              | `user indexed`, `assets` (`euint256`)                     |
| `WithdrawPrepared`    | `user indexed`, `approval` (`ebool`)                      |
| `BooksPrepared`       | `user indexed`, `booksOk` (`ebool`)                       |
| `HealthStatusUpdated` | `vault indexed`, `isHealthy` (`ebool`)                    |

Errors surfaced in the ABI: `MalformedDecryptedData(bytes)`, `SafeERC20FailedOperation(address)`.

### 5.12 Design decisions & the v3 privacy rewrite

- **v2 → v3:** v2 stored encrypted share balances but made handles effectively checkable, and
  used on-chain share math. v3 stores **unique owner-only handles** for both balance and debt,
  uses **1:1 bookkeeping** (`balanceOf` sum ⇔ `totalDeposited`) instead of share-price growth,
  and enforces soundness through the **aggregate invariant** instead of decrypting balances.
- **1:1 bookkeeping** is an explicit simplification (OK'd by the user): no share-price
  accrual, `totalAssets()` = aToken balance, each deposit/withdraw moves 1:1.
- **Owner-only `prepareWithdraw`/`withdraw`** — added after threat review to close the
  boolean-oracle and the front-running-redirect (§14).
- No upgradeable proxies, no config-everything constructors, no custom error library (per
  `AGENTS.md`).

---

## 6. End-to-end flows (what a user actually does)

All flows are driven by the Nox SDK + the gateway. Verified gas values are from live Sepolia.

### 6.1 Deposit (verified, 418k gas)

1. (UI) Wrap ETH→WETH if needed, approve the vault.
2. `encryptInput(amount, 'uint256', vault)` → `{ handle, handleProof }`.
3. `vault.deposit(amount, user, handle, handleProof)`.
4. Result (verified on-chain): `balanceOf[user]` is a **unique** handle; `GET /v0/public/{handle}`
   → **403**; `handleClient.decrypt(handle)` → `20000000000000000` (0.02 WETH).

### 6.2 Borrow (verified, ~368k gas)

1. `encryptInput(amount)` ×2 → `{ amountHandle, amountProof, storageHandle, storageProof }`.
2. `vault.prepareBorrow(amountHandle, storageHandle, amountProof, storageProof)`.
3. Poll gateway for `amountHandle` → `decryptionProof`.
4. `vault.borrow(USDC, amountHandle, storageHandle, storageProof, decryptionProof, 2, 0, user)`.
5. Result: `debtOf[user]` is a **unique** private handle; `403` on public; owner decrypt →
   `15000000` (15 USDC). Aave position: $80 collateral / $15 debt / HF ≈ 4.4.

### 6.3 Withdraw (verified, 163k + 444k gas)

1. `vault.prepareWithdraw(amount, user)` (owner only).
2. Read both handles (`withdrawApproval[user]`, `booksInvariant[user]`); poll gateway for both
   proofs.
3. `vault.withdraw(approvalProof, invariantProof, amount, user, user)`.
4. Result: withdraws min(amount, `maxWithdrawable()`); `balanceOf` re-computed to a fresh
   unique handle that still decrypts correctly; `totalDeposited` shrinks 1:1.

### 6.4 Repay (verified, ~310k gas)

1. Approve vault for USDC.
2. `vault.repay(USDC, amount, 2, user)`.
3. `debtOf` becomes a fresh unique private handle decrypting to the remaining debt.

### 6.5 The live proof

`scripts/v3_position.mjs` recreates the demo position and prints the privacy evidence:
unique handles, `403` on both public endpoints, and correct owner decryptions. `v3_withdraw.mjs`
and `v3_repay.mjs` are self-restoring round-trips (withdraw+re-deposit; borrow+repay) that
verify the full cycle without disturbing the live position.

---

## 7. Frontend (`frontend/`)

### 7.1 Files

- `src/main.jsx` — wagmi setup (sepolia + injected connector), React Query provider.
- `src/App.jsx` — the whole UI: landing, vault screen, action modals, explorer, automation.
- `src/hooks.js` — wagmi hooks + activity feed + Nox SDK usage; `VAULT` constant here.
- `src/ActivityFeed.jsx` — decrypted activity list with a Lock+Encrypted fallback.
- `src/abi/HydanVault.json` — regenerated from the artifact after every compile (35 entries).
- `src/index.css` — Tailwind + utility layers.

### 7.2 Key constants (`hooks.js` / `App.jsx`)

```
VAULT = 0x330b5c509bc1621585e88dc4c07b763e4a399fba
WETH  = 0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c
USDC  = 0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8
```

### 7.3 Action modals

- **Deposit:** wrap → approve → `encryptInput` → `deposit(amount, addr, handle, handleProof)`.
- **Borrow:** two `encryptInput` calls → `prepareBorrow` → gateway poll → `borrow(...)`.
- **Repay:** approve USDC → `repay`.
- **Withdraw:** `prepareWithdraw` → read both ebools → gateway poll (both) → `withdraw(proof,
proof, amount, addr, addr)`.
- Gas: explicit limits (`800000n` on deposit/borrow/repay/withdraw, `300000n` prepareWithdraw,
  `200000n` prepareBorrow) because `toEuint256` subcalls make auto-estimation unreliable.

### 7.4 Activity feed (`useVaultActivity`)

- Fetches `Deposited`/`Withdrawn`/`Borrowed`/`Repaid` in a 10-block window (Alchemy free-tier
  cap), live-subscribed afterwards; de-duped by `txHash`.
- Decryption tries `handleClient.decrypt(handle)` first (owner/authenticated), falls back to
  `publicDecrypt`; failed rows render with a Lock icon. Events now emit unique private
  handles, so non-owner observers see "Encrypted" rows — by design.

### 7.5 Build quirk

`NODE_OPTIONS=--max-old-space-size=2048 vite build` (the Codespace's two tsservers OOM the
default build). ~20–25s, emits `dist/` (gitignored).

---

## 8. Scripts & tooling (root `scripts/`)

- **`deployNewWETH.mjs`** — deploys `HydanVault(WETH, PoolAddressesProvider, USDC)` (3M gas),
  then `setAavePool` + resolves aWETH via the data provider + `setAToken`. Prints final config.
- **`v3_position.mjs`** — the live demo: wraps/approves WETH, deposits 0.02 WETH, borrows
  15 USDC, then verifies both stored handles are unique, `403` on the public endpoint, and
  owner-decrypt correctly. Prints the Aave position.
- **`v3_withdraw.mjs`** — withdraw round-trip: `prepareWithdraw` → fetch both proofs →
  `withdraw` → re-deposit to restore. Prints the privacy checks.
- **`v3_repay.mjs`** — repay round-trip: borrow 5 USDC → approve → repay → verify `debtOf`
  is unchanged (15 USDC) and private.
- **`v3_borrow.mjs` / `v3_deposit.mjs`** — standalone borrow/deposit with privacy checks.
- **`mintTestUSDC.ts`** (`pnpm mint:usdc`), **`wrapWETH.ts`** (`pnpm mint:weth`) — faucet helpers.

All scripts read `SEPOLIA_PRIVATE_KEY` / `SEPOLIA_RPC_URL` from env (`set -a; source .env`).

---

## 9. Deployment procedure (from scratch)

```bash
npx hardhat vars set SEPOLIA_RPC_URL
npx hardhat vars set SEPOLIA_PRIVATE_KEY

pnpm install
pnpm compile

set -a; source .env; set +a
node scripts/deployNewWETH.mjs     # deploy + setAavePool + setAToken
node scripts/v3_position.mjs       # create the live position + verify privacy

cd frontend
cp .env.example .env               # VITE_SEPOLIA_RPC_URL
npm install
npm run build
npx vercel deploy dist --prod --yes
```

---

## 10. Testing & verification philosophy

- **No mock data.** Verification is live on Sepolia against real Aave + the real Nox gateway.
- Everything was probed empirically before building (see §4.2): handle uniqueness, `403` on
  private handles, compute-result privacy, viewer-based decryption, and the public-handle
  requirement for on-chain decryption.
- Every vault flow was exercised live and its state re-verified (unique handle + `403` +
  correct owner decryption + Aave position).
- The two security guards (`prepareWithdraw`/`withdraw` owner-only) were verified by
  attempting cross-user calls: `prepareWithdraw(amount, other)` reverts.
- Local unit tests are not feasible: `toEuint256` calls `NoxCompute.wrapAsPublicHandle`,
  which the local Nox test stack does not implement, and EDR forks can't repro it either.

---

## 11. Repository layout (current)

```
.
├── AGENTS.md                     # build rules (anti-slop, conventions)
├── README.md                     # concise public overview
├── PROJECT_DOCUMENTATION.md      # this file
├── hardhat.config.ts
├── package.json / pnpm-lock.yaml
├── .env.example
├── contracts/HydanVault.sol
├── ignition/modules/DeployWETH.ts
├── scripts/
│   ├── deployNewWETH.mjs
│   ├── v3_position.mjs / v3_withdraw.mjs / v3_repay.mjs / v3_borrow.mjs / v3_deposit.mjs
│   ├── mintTestUSDC.ts
│   └── wrapWETH.ts
├── frontend/
│   ├── package.json / .env.example
│   └── src/
│       ├── main.jsx / App.jsx / ActivityFeed.jsx / hooks.js / index.css
│       └── abi/HydanVault.json
└── .gitignore
```

---

## 12. Security & privacy properties (summary for judges)

**Private (verified on-chain):**

- `balanceOf[user]` and `debtOf[user]` are unique Nox ciphertexts. The gateway returns `403`
  for them; only the owner's keys decrypt them. An attacker cannot re-encrypt a guess and
  match (unique salt per encryption), so stored handles don't leak equality either.

**Public (by necessity):**

- The vault's aggregate Aave position (aToken balance, debt tokens, health factor) — Aave
  makes this public.
- Borrow/repay transaction amounts — Aave emits `Transfer`/debt-token events.
- The two withdrawal ebools (`has enough`, `books match`) — required for on-chain verification.

**Soundness:**

- `aggregateBalance == totalDeposited` gates every withdrawal, so an overstated balance
  cannot be cashed out; the position would freeze rather than pay fake balances.
- Withdrawals are capped at `maxWithdrawable()` so the vault never drops to liquidation.

**Trust model:** you trust Nox's TEE + gateway for decryption proofs, and Aave for pool math.
hydan adds no trusted third parties beyond those.

**Known limitations (honest):**

- The withdraw-approval boolean is a public oracle **by design** (TEE reveals "≥ X?"). The
  owner-only `prepareWithdraw` guard prevents probing other users' balances.
- The borrow amount and any on-chain-decrypted value are public (forced by the protocol).
- 1:1 bookkeeping: no share-price accrual; `totalAssets()` is simply the aToken balance.
- `updateHealthStatus` is informational; the frontend reads Aave's HF directly.

---

## 13. FAQ

- **Can anyone read my balance or debt?** No. Both are unique encrypted handles; the gateway
  returns `403` for them, and only you (via `addViewer`) can decrypt. Verified live.
- **Why are balances private but borrow amounts public?** On-chain verification requires a
  public handle; Aave publicly emits borrows anyway. What we keep private is the _stored_
  position — what appears in `balanceOf`/`debtOf` state.
- **What stops me from depositing 0.01 WETH but claiming 1 WETH?** The aggregate invariant:
  the encrypted sum must equal the plaintext sum at withdraw time, otherwise every withdrawal
  is blocked. You can't profit from lying.
- **Why 2 steps?** The TEE gateway needs a beat to mint a decryption proof after a handle is
  registered; the second tx consumes it. It's the price of verifiable privacy.
- **Why did the vault get redeployed?** v3 added owner-only guards and removed an unused
  parameter; the new deployment got a fresh live position.

---

## 14. Hard-won gotchas (read before touching anything)

1. **Nox encrypt/decrypt is network-live only** (`toEuint256` → `wrapAsPublicHandle`); never
   fork-reproducible.
2. **Unique ≠ public:** byte 6 of a handle is `0x01` for unique (private) handles; unique
   handles `403` on `/v0/public`. Compute results are unique and viewerless by default —
   always `addViewer` before expecting an owner to decrypt.
3. **On-chain decrypt forces public:** if a value must be decrypted inside the contract, mark
   it `allowPublicDecryption`; everything you want to _store privately_ must never be.
4. **Gateway protocol:** poll `/v0/public/{handle}?salt={32-byte-hex}` (fresh salt each time)
   every ~1s up to 30s; `200` → `{ payload: { decryptionProof } }`.
5. **Aave precision triple:** HF `1e18`; collateral/debt base units 8 decimals (USD); leave
   ≥ 1 unit of margin above the liquidation edge.
6. **Alchemy free tier:** `eth_getLogs` capped at a 10-block range (frontend pins
   `latest-9n…latest`); `debug_traceCall` unavailable; `eth_call` state overrides OK.
7. **Gas numbers (measured):** deposit ~418k, borrow ~368–400k, prepareWithdraw ~163k,
   withdraw ~444k, repay ~310k. Always pass explicit gas limits — `toEuint256` subcalls make
   estimates unreliable.
8. **Approvals are consumed:** a 1:1 approval is used up by the first pull; scripts must
   re-approve before a re-deposit (v3_withdraw does).
9. **`.env` vs hardhat vars:** hardhat CLI reads vars; plain scripts read env —
   `set -a; source .env; set +a`.
10. **Keep `frontend/src/abi/HydanVault.json` in sync** with the compiled artifact (regenerate
    after every compile), and keep `hooks.js` `VAULT` pointing at the shipping deployment.
11. **Prettier formatting is safe** on the contract (`pnpm lint`/`pnpm format` gate style).
