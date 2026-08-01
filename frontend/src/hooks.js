import { useState, useEffect } from 'react';
import { useReadContract, useWriteContract, useAccount, usePublicClient, useWatchContractEvent, useWalletClient } from 'wagmi';
import { createViemHandleClient } from '@iexec-nox/handle';
import vaultAbi from './abi/HydanVault.json';

const VAULT = '0x330b5c509bc1621585e88dc4c07b763e4a399fba';
const WETH = '0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c';
export const USDC = '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8';

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

export function useVaultMaxWithdrawable() {
  return useReadContract({ address: VAULT, abi: vaultAbi, functionName: 'maxWithdrawable' });
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

export function useUserWethBalance(address) {
  return useReadContract({
    address: WETH,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address],
    query: { enabled: !!address },
  });
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

const TYPE_UNIT = { deposit: 'ETH', withdraw: 'ETH', borrow: 'USDC', repay: 'USDC' };

const EVENT_HANDLE_FIELD = {
  Deposited: 'balance',
  Withdrawn: 'assets',
  Borrowed: 'amount',
  Repaid: 'assets',
};

function normalizeLog(log, ts, value) {
  const type = log.eventName === 'Deposited' ? 'deposit'
    : log.eventName === 'Withdrawn' ? 'withdraw'
    : log.eventName === 'Borrowed' ? 'borrow'
    : log.eventName === 'Repaid' ? 'repay'
    : 'unknown';
  return {
    type,
    unit: TYPE_UNIT[type] || '',
    assets: value !== null && value !== undefined ? value.toString() : null,
    blockNumber: Number(log.blockNumber),
    txHash: log.transactionHash,
    timestamp: ts || 0,
  };
}

function mergeEvents(prev, fresh) {
  const prevArr = Array.isArray(prev) ? prev : [];
  const merged = [...fresh, ...prevArr];
  const seen = new Set();
  return merged.filter(e => {
    if (seen.has(e.txHash)) return false;
    seen.add(e.txHash);
    return true;
  }).sort((a, b) => b.blockNumber - a.blockNumber);
}

export function useVaultActivity(address) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refetchTrigger, setRefetchTrigger] = useState(0);
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  async function decryptHandle(handle) {
    try {
      if (!walletClient || !handle) return null;
      const handleClient = await createViemHandleClient(walletClient);
      // Deposits and borrows emit unique handles this user is a viewer of
      // (only they can decrypt). Withdraws and repays emit public handles.
      try {
        const { value } = await handleClient.decrypt(handle);
        return value;
      } catch {
        const res = await handleClient.publicDecrypt(handle);
        return res.value;
      }
    } catch {
      return null;
    }
  }

  async function resolveEvents(logs) {
    const blockNums = [...new Set(logs.map(l => l.blockNumber))];
    const blocks = await Promise.all(
      blockNums.map(n => publicClient.getBlock({ blockNumber: n }))
    );
    const tsByBlock = {};
    blockNums.forEach((n, i) => { tsByBlock[Number(n)] = Number(blocks[i].timestamp); });
    const resolved = await Promise.all(logs.map(async log => {
      const value = await decryptHandle(log.args[EVENT_HANDLE_FIELD[log.eventName]]);
      return normalizeLog(log, tsByBlock[Number(log.blockNumber)], value);
    }));
    return resolved.sort((a, b) => b.blockNumber - a.blockNumber);
  }

  useEffect(() => {
    if (!address || !publicClient) return;
    let cancelled = false;
    setLoading(true);

    async function fetch() {
      try {
        const block = await publicClient.getBlockNumber();
        const fromBlock = block - 9n;
        const names = ['Deposited', 'Withdrawn', 'Borrowed', 'Repaid'];
        const all = await Promise.all(names.map(eventName =>
          publicClient.getContractEvents({
            address: VAULT, abi: vaultAbi,
            eventName, args: { user: address },
            fromBlock, toBlock: block,
          })
        ));
        const logs = all.flat();
        if (cancelled) return;
        if (logs.length) {
          const resolved = await resolveEvents(logs);
          if (cancelled) return;
          setEvents(resolved);
        }
      } catch { /* no events yet */ }
      if (!cancelled) setLoading(false);
    }
    fetch();
    return () => { cancelled = true; };
  }, [address, publicClient, refetchTrigger]);

  const addEvent = async (logs) => {
    if (!Array.isArray(logs) || !logs.length) return;
    const now = Math.floor(Date.now() / 1000);
    const fresh = await Promise.all(logs.map(async l => {
      const value = await decryptHandle(l.args[EVENT_HANDLE_FIELD[l.eventName]]);
      return normalizeLog(l, now, value);
    }));
    setEvents(prev => mergeEvents(prev, fresh));
  };

  useWatchContractEvent({ address: VAULT, abi: vaultAbi, eventName: 'Deposited', args: { user: address }, onLogs: addEvent, enabled: !!address });
  useWatchContractEvent({ address: VAULT, abi: vaultAbi, eventName: 'Withdrawn', args: { user: address }, onLogs: addEvent, enabled: !!address });
  useWatchContractEvent({ address: VAULT, abi: vaultAbi, eventName: 'Borrowed', args: { user: address }, onLogs: addEvent, enabled: !!address });
  useWatchContractEvent({ address: VAULT, abi: vaultAbi, eventName: 'Repaid', args: { user: address }, onLogs: addEvent, enabled: !!address });

  const refetch = () => setRefetchTrigger(n => n + 1);

  return { events, loading, refetch };
}
