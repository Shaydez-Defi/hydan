import { useReadContract, useWriteContract } from 'wagmi';

const VAULT = '0x394fdd9013a55da0280ffd33c9e008878490a4d6';
const WETH = '0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c';

import vaultAbi from './abi/HydanVault.json';

const erc20Abi = [
  { inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'approve', outputs: [{ type: 'bool' }], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'account', type: 'address' }], name: 'balanceOf', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'decimals', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'symbol', outputs: [{ type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], name: 'allowance', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
];

export function useVaultTotalShares() {
  return useReadContract({ address: VAULT, abi: vaultAbi, functionName: 'totalShares' });
}

export function useVaultTotalAssets() {
  return useReadContract({ address: VAULT, abi: vaultAbi, functionName: 'totalAssets' });
}

export function useAssetInfo() {
  return {
    symbol: useReadContract({ address: WETH, abi: erc20Abi, functionName: 'symbol' }),
    decimals: useReadContract({ address: WETH, abi: erc20Abi, functionName: 'decimals' }),
    balance: useReadContract({ address: WETH, abi: erc20Abi, functionName: 'balanceOf', args: [VAULT] }),
  };
}

export function useUserBalance(address) {
  return useReadContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: 'balanceOf',
    args: [address],
    query: { enabled: !!address },
  });
}

export function usePreviewDeposit(assets) {
  return useReadContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: 'previewDeposit',
    args: [assets],
    query: { enabled: assets > 0n },
  });
}

export function useVaultDeposit() {
  return useWriteContract();
}

export function useVaultWithdraw() {
  return useWriteContract();
}

export function useTokenAllowance(owner, spender) {
  return useReadContract({
    address: WETH,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner, spender],
    query: { enabled: !!owner },
  });
}

export function useTokenApprove() {
  return useWriteContract();
}
