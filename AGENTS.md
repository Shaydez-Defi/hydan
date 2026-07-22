# AGENTS.md — hýdan build rules

## Context
Solo hackathon build (iExec WTF Hackathon, Nox + Aave on Sepolia). 
Time-boxed, ~10 days left. Judged partly on working end-to-end 
functionality with no mock data — code must actually work, not 
just look complete.

## Anti-slop rules — apply to ALL code in this repo

- No defensive over-engineering. No custom error libraries, no 
  upgradeable-proxy patterns "just in case," no configurable-
  everything constructors. Build for exactly what this demo needs.
- No comment bloat. Skip comments that restate the code. Comment 
  only where the *why* isn't obvious from the code itself.
- No redundant validation stacking. One clear check per condition, 
  not three overlapping ones "to be safe."
- No unused imports, unused variables, or empty scaffolded 
  functions left over from generation. Delete anything not called.
- No generic naming. Use vault, pool, amount — not data, 
  temp, result, handleThing.
- Match the Nox Hardhat starter's actual existing conventions in 
  this repo, not generic Solidity-tutorial style.
- No unnecessary abstraction layers. Don't wrap a single external 
  call in multiple helper functions "for readability."
- Real, specific error messages — not placeholders like "error" 
  or "invalid input."
- Tests must verify actual behavior (state changes, correct 
  values), not just "it doesn't revert."

## General
If a simpler version does the same job, use the simpler version. 
When in doubt, write less code, not more.