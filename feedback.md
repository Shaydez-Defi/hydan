# Feedback for iExec: Nox Protocol (WTF Hackathon)

Honest, detailed feedback from building hýdan, a confidential lending vault on Aave V3 using Nox. Most of this cost real time to figure out, so hopefully it saves the next builder some of that time.

## What worked well

Nox's core primitives (handles, ACLs, TEE-based computation) are a genuinely coherent model once you understand them. `fromExternal` for validating externally-supplied encrypted values, `toEuint256` for encrypting a trusted on-chain plaintext, and the ACL system (`allow`, `allowPublicDecryption`) for selective disclosure map cleanly onto real privacy needs. Once we understood the pattern, adding a new encrypted field or comparison was straightforward.

The reference implementations helped enormously. The cVault demo (encrypted positions) and another team's NoxRoll project were both more useful than the written docs for understanding real usage patterns. If anything, more visible, working reference repos per use case (lending, not just token wrapping) would shorten everyone's ramp-up time significantly.

The public Handle Gateway genuinely works well once configured correctly. Once we stopped fighting bad configuration, encryption and decryption were reliable and reasonably fast.

## Documentation gaps, in order of how much time they cost us

### 1. Ethereum Sepolia vs Arbitrum Sepolia support is unclear and cost the most time

The JS SDK's Advanced Configuration docs state that full SDK support for Ethereum Sepolia "ships with an upcoming @iexec-nox/handle release," and that until then the SDK auto-resolves configuration for Arbitrum Sepolia. This reads as "Ethereum Sepolia doesn't fully work yet." In practice, it does. `createViemHandleClient(account)` with no manual config works correctly against Ethereum Sepolia today, at least for our use case. The SDK ships the Ethereum Sepolia gateway URL, NoxCompute address, and subgraph URL in its built-in network config, but nothing in the docs says so, so we spent hours trying to find or guess a manual `gatewayUrl`/`subgraphUrl` for Ethereum Sepolia before discovering they simply weren't needed.

Given the hackathon explicitly requires ETH Sepolia deployment, this is a meaningful documentation-hackathon mismatch. We only resolved it by finding another team's public repo that had already proven it worked. Recommendation: either update the docs to say plainly "auto-resolution also works for Ethereum Sepolia today" or add a note directly on the hackathon page linking to a working ETH Sepolia example.

### 2. The Networks reference page is JS-rendered and doesn't show up in a plain fetch

The page at `/getting-started/networks` (which lists the actual NoxCompute contract address per chain) renders its content client-side. Anyone trying to pull this programmatically, or via any tool that fetches static HTML, gets an empty shell with no contract addresses. We only found the real Ethereum Sepolia NoxCompute address (`0x24ef36ec5b626d7dcd09a98f3083c2758f0f77bf`) by manually opening the page in a browser. A static fallback rendering, or the same data available in a plain JSON/markdown file, would make this discoverable by tooling and AI coding assistants, which is increasingly how people building on Nox are working.

### 3. The SDK's return field names don't match the obvious guess

`encryptInput()` returns `{ handle, handleProof }`. We initially assumed `inputProof` (matching the Solidity-side parameter name `bytes calldata inputProof` used throughout Nox.sol's `fromExternal` functions), and got a confusing `undefined` passed into the contract call with no early type error, just a downstream ABI encoding failure. A one-line note in the `encryptInput` docs ("note: returns `handleProof`, not `inputProof`, despite the Solidity parameter naming") would have saved real debugging time.

### 4. encryptInput's third argument (applicationContract) semantics aren't explained

`encryptInput(value, type, address)`, the third argument's purpose isn't documented anywhere we found. It is the `applicationContract`, and the proof binds it to the contract that will call `Nox.fromExternal`. On-chain, `validateInputProof` enforces `appInProof == msg.sender`, i.e. the consuming contract itself, while the SDK's connected account is bound separately as the `owner` and must be the transaction sender. We pass the vault (the consuming contract) as the third argument and it works; passing the end-user wallet fails with an "App mismatch" revert. A single sentence explaining "this must be the contract that will call `fromExternal`, not the user's wallet" would resolve a very confusing, silently-failing class of bug.

### 5. Local/forked testing isn't possible for anything that touches toEuint256

`toEuint256` calls the live NoxCompute contract's `wrapAsPublicHandle`, which means any local Hardhat network or Sepolia fork simply can't execute it. This isn't clearly stated anywhere, we assumed local unit tests would work like any other Hardhat project, and lost time before realizing every meaningful test needs to run against the actual live network. Given how much of typical Solidity development assumes local-first testing, this is a significant workflow difference worth calling out explicitly and early, ideally in the Hardhat plugin's own README or a "Testing" guide page, since right now it's something you discover by hitting a wall.

### 6. Aave-specific gotchas (not Nox's fault, but worth flagging since the hackathon suggests Aave as a target)

- `setSupplyCap()` takes whole-token units, not decimals-scaled amounts, unlike almost every other Aave function. This is a known Aave quirk but tripped us up since it's inconsistent with the rest of the interface.
- `getUserAccountData()`'s healthFactor is the 6th return value (index 5, zero-indexed), an easy off-by-one if you're counting fields by hand.
- `2^256 - 1` is Aave's sentinel for "infinite health factor" (zero debt). Worth knowing before you assume your encryption pipeline is broken because it's trying to handle an enormous number.
- Shared Sepolia testnet supply caps (2000 units on USDC and USDT during our build window) got saturated by hackathon traffic. Worth a heads-up to participants that they may need to test with less-popular assets (we ended up using WETH, wrapped directly from Sepolia ETH, to route around this entirely).

## A real security consideration worth flagging back to the Nox team

Early in our build, we wrote a version of a deposit function that accepted a caller-supplied encrypted amount alongside the deposit, intending to let the user's client compute and encrypt the correct value. This is a real vulnerability pattern: nothing on-chain ties the encrypted value to the actual amount deposited, so a malicious caller could submit an arbitrary encrypted balance disconnected from reality.

We couldn't close it by deriving the value on-chain and encrypting with `toEuint256`, because a deposit amount is user intent, not something the contract can compute from trusted state. The shipped vault instead enforces soundness with a reconciliation gate: it keeps a plaintext `totalDeposited` alongside the encrypted `aggregateBalance`, and every withdrawal requires a TEE-computed encrypted `eq` proving the two match. Overstate your balance and the invariant breaks, which freezes withdrawals instead of letting a fake balance cash out.

A short callout in the Solidity Library or "Accepting Private User Inputs" guide, explicitly warning "don't accept encrypted values for things you can't independently verify; derive them on-chain or pair them with a verifiable reconciliation invariant", would likely prevent other teams from shipping the same bug.

## Gas and reliability notes

Confidential compute transactions cost noticeably more gas than plain transfers, our withdraw function needs roughly 400-450k gas, well above what automatic estimation reliably provides. We saw automatic gas estimation fail silently and fall back to nonsensical values (21,000,000 gas for a simple deposit, in one case), which some RPC providers then reject outright as exceeding their own gas cap, producing an unhelpful RPC-level error that masks whatever the real underlying issue is. Explicit, generous gas limits on every confidential-compute call were the only reliable fix we found. A note in the docs recommending explicit gas limits for any function using Nox primitives, along with rough expected ranges, would help other builders skip this entirely.

## Summary

Nox's actual capabilities are strong and the core developer experience, once correctly configured, is good. Nearly all of our lost time came from documentation gaps around network support (Ethereum Sepolia specifically), a few SDK naming/semantic surprises, and the total absence of a local testing path. None of these are fundamental protocol problems, they're all things a slightly more complete docs pass or a couple of sentences in the right place would have prevented. We're glad we pushed through them, and we hope this list saves the next team the hours it cost us.
