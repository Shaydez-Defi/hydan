import { useState, useCallback } from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { Wallet, ArrowUpRight, ArrowDownLeft, TrendingUp } from 'lucide-react';
import { formatUnits, parseUnits, maxUint256 } from 'viem';
import vaultAbi from './abi/HydanVault.json';
import {
  useVaultTotalShares,
  useVaultTotalAssets,
  useAssetInfo,
  useUserBalance,
  usePreviewDeposit,
  useVaultDeposit,
  useVaultWithdraw,
  useTokenAllowance,
  useTokenApprove,
} from './hooks.js';

const VAULT_ADDRESS = '0x394fdd9013a55da0280ffd33c9e008878490a4d6';
const WETH = '0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c';

const erc20Approve = [
  { inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'approve', outputs: [{ type: 'bool' }], stateMutability: 'nonpayable', type: 'function' },
];

function Stat({ label, value }) {
  return (
    <div className="card flex-1 min-w-0">
      <p className="label mb-2">{label}</p>
      <p className="stat-value truncate">{value}</p>
    </div>
  );
}

function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connectors, connect } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected) {
    return (
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-muted">{address.slice(0, 6)}...{address.slice(-4)}</span>
        <button onClick={disconnect} className="btn-ghost text-xs">Disconnect</button>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      {connectors.map((c) => (
        <button key={c.id} onClick={() => connect({ connector: c })} className="btn-primary flex items-center gap-2">
          <Wallet size={14} />
          {c.name}
        </button>
      ))}
    </div>
  );
}

function VaultScreen({ address }) {
  const [mode, setMode] = useState('deposit');
  const [amount, setAmount] = useState('');
  const [txHash, setTxHash] = useState(null);

  const { data: totalShares, refetch: refetchShares } = useVaultTotalShares();
  const { data: totalAssets, refetch: refetchAssets } = useVaultTotalAssets();
  const { symbol, decimals } = useAssetInfo();
  const { data: userBalance } = useUserBalance(address);
  const { data: allowance, refetch: refetchAllowance } = useTokenAllowance(address, VAULT_ADDRESS);

  const parsedAmount = amount ? parseUnits(amount, decimals?.data ?? 18) : 0n;
  const { data: preview } = usePreviewDeposit(mode === 'deposit' ? parsedAmount : 0n);

  const { writeContract: doDeposit, isPending: depositing } = useVaultDeposit();
  const { writeContract: doWithdraw, isPending: withdrawing } = useVaultWithdraw();
  const { writeContract: doApprove, isPending: approving } = useTokenApprove();

  const handleAction = useCallback(async () => {
    if (!amount || parsedAmount <= 0n) return;
    setTxHash(null);

    try {
      if (mode === 'deposit') {
        if ((allowance ?? 0n) < parsedAmount) {
          await doApprove({
            address: WETH,
            abi: erc20Approve,
            functionName: 'approve',
            args: [VAULT_ADDRESS, maxUint256],
          });
          await refetchAllowance();
        }
        const hash = await doDeposit({
          address: VAULT_ADDRESS,
          abi: vaultAbi,
          functionName: 'deposit',
          args: [parsedAmount, address],
        });
        setTxHash(hash);
      } else {
        const hash = await doWithdraw({
          address: VAULT_ADDRESS,
          abi: vaultAbi,
          functionName: 'withdraw',
          args: [parsedAmount, address, address],
        });
        setTxHash(hash);
      }
      setAmount('');
      refetchShares();
      refetchAssets();
    } catch (e) {
      console.error(e);
    }
  }, [amount, mode, parsedAmount, allowance, address, doDeposit, doWithdraw, doApprove, refetchShares, refetchAssets, refetchAllowance]);

  const assetSymbol = symbol?.data ?? 'ETH';
  const assetDecimals = decimals?.data ?? 18;
  const shares = totalShares ?? 0n;
  const assets = totalAssets ?? 0n;
  const sharePrice = shares > 0n ? (assets * BigInt(10 ** Math.min(assetDecimals, 18))) / shares : BigInt(10 ** Math.min(assetDecimals, 18));

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex gap-4 flex-wrap">
        <Stat label="Total Assets" value={`${formatUnits(assets, assetDecimals)} ${assetSymbol}`} />
        <Stat label="Total Shares" value={shares.toString()} />
        <Stat label="Share Price" value={`${formatUnits(sharePrice, assetDecimals)} ${assetSymbol}`} />
      </div>

      <div className="card space-y-4">
        <p className="label">Your encrypted balance (bytes32 handle)</p>
        <p className="font-mono text-xs text-muted break-all">{userBalance ?? '0x0000000000000000000000000000000000000000000000000000000000000000'}</p>
      </div>

      <div className="card">
        <div className="flex border-b border-border mb-6">
          <button
            onClick={() => setMode('deposit')}
            className={`pb-3 px-4 text-sm flex items-center gap-2 transition-colors ${mode === 'deposit' ? 'text-white border-b-2 border-carmine' : 'text-muted hover:text-white'}`}
          >
            <ArrowDownLeft size={14} />
            Deposit
          </button>
          <button
            onClick={() => setMode('withdraw')}
            className={`pb-3 px-4 text-sm flex items-center gap-2 transition-colors ${mode === 'withdraw' ? 'text-white border-b-2 border-leaf' : 'text-muted hover:text-white'}`}
          >
            <ArrowUpRight size={14} />
            Withdraw
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <p className="label mb-2">Amount ({assetSymbol})</p>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
              className="input"
              min="0"
              step="any"
            />
          </div>

          {mode === 'deposit' && preview !== undefined && amount && (
            <p className="text-xs text-muted">
              You receive ~{formatUnits(preview ?? 0n, assetDecimals)} shares
            </p>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleAction}
              disabled={!amount || parsedAmount <= 0n || depositing || withdrawing || approving}
              className={mode === 'deposit' ? 'btn-primary flex-1' : 'btn-secondary flex-1'}
            >
              {depositing || withdrawing || approving ? 'Pending...' : mode === 'deposit' ? 'Deposit' : 'Withdraw'}
            </button>
          </div>

          {txHash && (
            <div className="!p-3 border border-leaf/30 bg-surface/50">
              <p className="text-xs text-leaf font-mono break-all">{txHash}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { address, isConnected } = useAccount();

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-border">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <h1 className="font-display text-2xl text-carmine tracking-wide">hydan</h1>
          <ConnectButton />
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {!isConnected ? (
          <div className="text-center py-24 space-y-4">
            <TrendingUp size={40} className="text-muted mx-auto" />
            <p className="text-muted">Connect a wallet to interact with the vault</p>
          </div>
        ) : (
          <VaultScreen address={address} />
        )}
      </main>
    </div>
  );
}
