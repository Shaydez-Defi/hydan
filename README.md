# hydan

Pooled vault with ERC-4626 share accounting, Nox-encrypted user balances, and Aave V3 integration. Deployed on Sepolia.

## Contracts

| Asset | Vault Address |
|-------|--------------|
| WETH  | `0x394fdd9013a55da0280ffd33c9e008878490a4d6` |
| USDC  | `0x35DFa22be33993419362367635F9Ff397E8B2D1d` |
| DAI   | `0x0E240A869D4FE0420Ff173aeb40C82ffb7184b4d` |
| GHO   | `0x3DD0a9E4B23dd821F537b1379913707274a00d87` |

## Stack

- **Contracts**: Solidity 0.8.35, Hardhat 3, Ignition deploys
- **Privacy**: Nox TEE protocol (encrypted user balance mapping, encrypted health factor)
- **Yield**: Aave V3 Sepolia (single counter-party per vault)
- **Frontend**: Vite + React, wagmi/viem, Tailwind CSS

## Dev

```bash
pnpm install
pnpm compile
pnpm test
pnpm deploy:weth
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

## Design

Pacifico wordmark, Bagel Fat One numerics, carmine + leaf green palette. JetBrains Mono for code values. No rounded corners, no gradients, no glows. Borderless cards. 8pt spacing grid.
