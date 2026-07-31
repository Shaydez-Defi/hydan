# hydan

Private lending vault: Nox-encrypted share and debt balances on top of an Aave V3 pool. Users deposit WETH and borrow USDC without exposing position sizes on-chain. Deployed on Ethereum Sepolia.

![hydan vault](assets/vault.png)

## Deployed

| Item             | Address                                      |
| ---------------- | -------------------------------------------- |
| HydanVault       | `0xb05c9770e926bf193f1d69a4490591ab18e6a12a` |
| asset (WETH)     | `0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c` |
| debtAsset (USDC) | `0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8` |
| Aave Pool        | `0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951` |
| Aave aWETH       | `0x5b071b590a59395fE4025A0Ccc1FcC931AAc1830` |

## How it works

- **Deposit** — `deposit(assets, receiver)` converts the share amount to a Nox `euint256` handle before it touches storage. `balanceOf[user]` is an encrypted handle, so balances are only readable by the owner (or the vault) via Nox TEE decryption.
- **Borrow** — amounts stay encrypted end-to-end. The user encrypts the amount and submits `prepareBorrow(encryptedAmount, inputProof)`; the vault registers the handle. `borrow(...)` verifies a gateway-produced decryption proof on-chain, draws the USDC from Aave, and transfers it to the borrower without ever storing the plaintext amount.
- **Withdraw** — `prepareWithdraw(assets, onBehalfOf)` performs the balance check as an encrypted comparison (`balanceOf >= shares`) and stores the resulting `ebool` approval, which is made publicly decryptable. `withdraw(approvalProof, assets, receiver, owner)` verifies the proof, caps the amount at `maxWithdrawable()` (keeps the health factor above liquidation), and returns assets from Aave.
- **Repay** — `repay(...)` sends USDC to Aave and subtracts the repaid amount from the encrypted `debtOf` handle.

All events (`Deposited`, `Withdrawn`, `Borrowed`, `Repaid`, `WithdrawPrepared`) emit encrypted handles, never plaintext amounts.

## Stack

- **Contracts**: Solidity 0.8.35, Hardhat 3, Ignition deploys, Nox SDK (`euint256`/`ebool`)
- **Yield**: Aave V3 Sepolia
- **Privacy**: Nox TEE protocol + gateway decryption proofs
- **Frontend**: Vite + React, wagmi/viem, Tailwind CSS

## Dev

Set secrets (Hardhat 3 uses its vars store):

```bash
npx hardhat vars set SEPOLIA_RPC_URL
npx hardhat vars set SEPOLIA_PRIVATE_KEY
```

Build and deploy:

```bash
pnpm install
pnpm compile
pnpm deploy:weth
```

Testnet helpers (only needed to fund a fresh wallet):

```bash
pnpm mint:weth   # wraps ETH into WETH
pnpm mint:usdc   # mints USDC via the Aave faucet
```

Live end-to-end demo (deposit WETH → borrow USDC → repay → withdraw):

```bash
set -a; source .env; set +a   # exports SEPOLIA_PRIVATE_KEY + SEPOLIA_RPC_URL for the script
node scripts/e2e_full_cycle.mjs
```

Frontend:

```bash
cd frontend
cp .env.example .env    # set VITE_SEPOLIA_RPC_URL
npm install
npm run dev
```

## Design

Pacifico wordmark, Bagel Fat One numerics, carmine + leaf green palette. JetBrains Mono for code values. No rounded corners, no gradients, no glows. Borderless cards. 8pt spacing grid.
