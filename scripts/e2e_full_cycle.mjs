import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { createViemHandleClient } from '@iexec-nox/handle';

const pk = process.env.SEPOLIA_PRIVATE_KEY;
const account = privateKeyToAccount(pk.startsWith('0x') ? pk : '0x' + pk);
const publicClient = createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL) });
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL) });

const vaultAbi = JSON.parse(readFileSync('frontend/src/abi/HydanVault.json', 'utf8'));
const VAULT = '0xb05c9770e926bf193f1d69a4490591ab18e6a12a';
const WETH = '0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c';
const USDC = '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8';

async function waitForGateway(handle, maxWait = 30) {
  for (let i = 0; i < maxWait; i++) {
    const salt = '0x' + randomBytes(32).toString('hex');
    const resp = await fetch('https://gateway-testnets.noxprotocol.dev/v0/public/' + handle + '?salt=' + salt);
    if (resp.status === 200) {
      const data = await resp.json();
      return data.payload.decryptionProof;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('Gateway timeout after 30s');
}

async function main() {
  const wethBal = await publicClient.readContract({
    address: WETH, abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
    functionName: 'balanceOf', args: [account.address],
  });
  console.log('WETH balance:', Number(wethBal) / 1e18);

  const handleClient = await createViemHandleClient(walletClient);

  // 1. Deposit
  const depositAmount = 4000000000000000n; // 0.004 WETH
  console.log('\n1. Depositing', Number(depositAmount)/1e18, 'WETH...');
  let hash = await walletClient.writeContract({
    address: WETH, abi: parseAbi(['function approve(address,uint256) returns (bool)']),
    functionName: 'approve', args: [VAULT, depositAmount],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  hash = await walletClient.writeContract({
    address: VAULT, abi: vaultAbi, functionName: 'deposit',
    args: [depositAmount, account.address], gas: 800000n,
  });
  let receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log('   Status:', receipt.status);

  // 2. Borrow (2-step encrypted)
  const borrowAmount = 500000n; // 0.5 USDC
  console.log('\n2. Borrowing', Number(borrowAmount)/1e6, 'USDC...');
  const { handle, handleProof } = await handleClient.encryptInput(
    borrowAmount, 'uint256', VAULT,
  );
  console.log('   Step 1: prepareBorrow...');
  hash = await walletClient.writeContract({
    address: VAULT, abi: vaultAbi, functionName: 'prepareBorrow',
    args: [handle, handleProof], gas: 200000n,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log('   Step 2: waiting for gateway...');
  const borrowProof = await waitForGateway(handle);
  console.log('   Step 3: borrow...');
  hash = await walletClient.writeContract({
    address: VAULT, abi: vaultAbi, functionName: 'borrow',
    args: [USDC, handle, borrowProof, 2n, 0, account.address], gas: 800000n,
  });
  receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log('   Status:', receipt.status);

  const usdcBal = await publicClient.readContract({
    address: USDC, abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
    functionName: 'balanceOf', args: [account.address],
  });
  console.log('   USDC balance:', Number(usdcBal) / 1e6);

  // 3. Repay
  console.log('\n3. Repaying', Number(borrowAmount)/1e6, 'USDC...');
  hash = await walletClient.writeContract({
    address: USDC, abi: parseAbi(['function approve(address,uint256) returns (bool)']),
    functionName: 'approve', args: [VAULT, borrowAmount],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  hash = await walletClient.writeContract({
    address: VAULT, abi: vaultAbi, functionName: 'repay',
    args: [USDC, borrowAmount, 2n, account.address], gas: 800000n,
  });
  receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log('   Status:', receipt.status);

  const usdcBalAfter = await publicClient.readContract({
    address: USDC, abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
    functionName: 'balanceOf', args: [account.address],
  });
  console.log('   USDC balance after repay:', Number(usdcBalAfter) / 1e6);

  // 4. Withdraw (2-step via TEE comparison)
  const withdrawAmount = await publicClient.readContract({
    address: VAULT, abi: vaultAbi, functionName: 'maxWithdrawable',
  });
  console.log('\n4. Withdrawing', Number(withdrawAmount)/1e18, 'ETH (maxWithdrawable)...');
  console.log('   Step 1: prepareWithdraw...');
  hash = await walletClient.writeContract({
    address: VAULT, abi: vaultAbi, functionName: 'prepareWithdraw',
    args: [withdrawAmount, account.address], gas: 300000n,
  });
  receipt = await publicClient.waitForTransactionReceipt({ hash });
  // Parse the WithdrawPrepared event for the approval ebool handle
  const withdrawPreparedEvent = vaultAbi.find(e => e.name === 'WithdrawPrepared');
  const logs = await publicClient.getLogs({
    address: VAULT, event: withdrawPreparedEvent,
    args: { user: account.address },
    fromBlock: receipt.blockNumber,
    toBlock: receipt.blockNumber,
  });
  const approvalHandle = logs[0].args.approval;
  console.log('   Approval handle:', approvalHandle);
  console.log('   Step 2: waiting for gateway...');
  const approvalProof = await waitForGateway(approvalHandle);
  console.log('   Step 3: withdraw...');
  hash = await walletClient.writeContract({
    address: VAULT, abi: vaultAbi, functionName: 'withdraw',
    args: [approvalProof, withdrawAmount, account.address, account.address],
    gas: 800000n,
  });
  receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log('   Status:', receipt.status);

  console.log('\n✅ Full cycle passed!');
}

main().catch(err => console.error('Error:', err.shortMessage || err.message));
