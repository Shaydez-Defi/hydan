import { useState, useEffect } from 'react';
import { useReadContract, useWriteContract, useAccount, usePublicClient, useWatchContractEvent } from 'wagmi';
import vaultAbi from './abi/HydanVault.json';

const VAULT = '0x394fdd9013a55da0280ffd33c9e008878490a4d6';
const WETH = '0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c';

const erc20Abi = [
  { inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'approve', outputs: [{ type: 'bool' }], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'account', type: 'address' }], name: 'balanceOf', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'decimals', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'symbol', outputs: [{ type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], name: 'allowance', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
];

const aavePoolAbi = [
  { inputs: [{ name: 'user', type: 'address' }], name: 'getUserAccountData', outputs: [
    { name: 'totalCollateralBase', type: 'uint256' },
    { name: 'totalDebtBase', type: 'uint256' },
    { name: 'availableBorrowsBase', type: 'uint256' },
    { name: 'currentLiquidationThreshold', type: 'uint256' },
    { name: 'ltv', type: 'uint256' },
    { name: 'healthFactor', type: 'uint256' },
  ], stateMutability: 'view', type: 'function' },
];

export function useVaultAddress() {
  return VAULT;
}

export function useTokenAddress() {
  return WETH;
}

export function useVaultTotalShares() {
  return useReadContract({ address: VAULT, abi: vaultAbi, functionName: 'totalShares' });
}

export function useVaultTotalAssets() {
  return useReadContract({ address: VAULT, abi: vaultAbi, functionName: 'totalAssets' });
}

export function useVaultHealthStatus() {
  return useReadContract({ address: VAULT, abi: vaultAbi, functionName: 'healthStatus' });
}

export function useAssetInfo() {
  return {
    symbol: useReadContract({ address: WETH, abi: erc20Abi, functionName: 'symbol' }),
    decimals: useReadContract({ address: WETH, abi: erc20Abi, functionName: 'decimals' }),
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

export function useUserWethBalance(address) {
  return useReadContract({
    address: WETH,
    abi: erc20Abi,
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

export function usePreviewWithdraw(assets) {
  return useReadContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: 'previewWithdraw',
    args: [assets],
    query: { enabled: assets > 0n },
  });
}

export function useVaultPoolAddress() {
  return useReadContract({ address: VAULT, abi: vaultAbi, functionName: 'aavePool' });
}

export function useVaultAsset() {
  return useReadContract({ address: VAULT, abi: vaultAbi, functionName: 'asset' });
}

export function useVaultAaveData(address) {
  const { data: pool } = useReadContract({ address: VAULT, abi: vaultAbi, functionName: 'aavePool' });
  return useReadContract({
    address: pool,
    abi: aavePoolAbi,
    functionName: 'getUserAccountData',
    args: [address],
    query: { enabled: !!pool && !!address },
  });
}

export function useTokenAllowance(owner, spender) {
  return useReadContract({
    address: spender === VAULT ? WETH : spender,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner, spender],
    query: { enabled: !!owner },
  });
}

export function useVaultDeposit() {
  return useWriteContract();
}

export function useVaultWithdraw() {
  return useWriteContract();
}

export function useVaultBorrow() {
  return useWriteContract();
}

export function useVaultRepay() {
  return useWriteContract();
}

export function useTokenApprove() {
  return useWriteContract();
}

const EVENT_NAMES = ['Deposited', 'Withdrawn', 'Borrowed', 'Repaid'];
const TYPE_MAP = { Deposited: 'deposit', Withdrawn: 'withdraw', Borrowed: 'borrow', Repaid: 'repay' };

function normalizeLog(log, ts) {
  return {
    type: TYPE_MAP[log.eventName] || log.eventName,
    assets: log.args.assets.toString(),
    blockNumber: Number(log.blockNumber),
    txHash: log.transactionHash,
    timestamp: ts || 0,
  };
}

export function useVaultActivity(address) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const publicClient = usePublicClient();

  useEffect(() => {
    if (!address || !publicClient) return;
    let cancelled = false;
    setLoading(true);

    async function fetch() {
      try {
        const logs = await publicClient.getContractEvents({
          address: VAULT, abi: vaultAbi,
          eventName: EVENT_NAMES,
          args: { user: address },
          fromBlock: 0n,
        });
        if (cancelled) return;
        const blockNums = [...new Set(logs.map(l => l.blockNumber))];
        const blocks = await Promise.all(
          blockNums.map(n => publicClient.getBlock({ blockNumber: n }))
        );
        const tsByBlock = {};
        blockNums.forEach((n, i) => { tsByBlock[Number(n)] = Number(blocks[i].timestamp); });
        setEvents(logs.map(l => normalizeLog(l, tsByBlock[Number(l.blockNumber)]))
          .sort((a, b) => b.blockNumber - a.blockNumber));
      } catch {
        try {
          const block = await publicClient.getBlockNumber();
          const logs = await publicClient.getContractEvents({
            address: VAULT, abi: vaultAbi,
            eventName: EVENT_NAMES,
            args: { user: address },
            fromBlock: block - 5000n,
          });
          if (cancelled) return;
          const blockNums = [...new Set(logs.map(l => l.blockNumber))];
          const blocks = await Promise.all(
            blockNums.map(n => publicClient.getBlock({ blockNumber: n }))
          );
          const tsByBlock = {};
          blockNums.forEach((n, i) => { tsByBlock[Number(n)] = Number(blocks[i].timestamp); });
          setEvents(logs.map(l => normalizeLog(l, tsByBlock[Number(l.blockNumber)]))
            .sort((a, b) => b.blockNumber - a.blockNumber));
        } catch { /* no events found */ }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetch();
    return () => { cancelled = true; };
  }, [address, publicClient]);

  useWatchContractEvent({
    address: VAULT, abi: vaultAbi,
    eventName: EVENT_NAMES,
    args: { user: address },
    onLogs(logs) {
      const now = Math.floor(Date.now() / 1000);
      const fresh = logs.map(l => normalizeLog(l, now));
      setEvents(prev => {
        const merged = [...fresh, ...prev];
        const seen = new Set();
        return merged.filter(e => {
          if (seen.has(e.txHash)) return false;
          seen.add(e.txHash);
          return true;
        }).sort((a, b) => b.blockNumber - a.blockNumber);
      });
    },
    enabled: !!address,
  });

  return { events, loading };
}
