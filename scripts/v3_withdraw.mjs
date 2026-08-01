import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { randomBytes } from 'crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createViemHandleClient } from '@iexec-nox/handle';

const __dirname = dirname(fileURLToPath(import.meta.url));
const vaultAbi = JSON.parse(readFileSync(join(__dirname, '../frontend/src/abi/HydanVault.json'), 'utf8')).abi;

const pk = process.env.SEPOLIA_PRIVATE_KEY;
const account = privateKeyToAccount(pk.startsWith('0x') ? pk : '0x' + pk);
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL) });
const publicClient = createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL) });

const VAULT = '0x330b5c509bc1621585e88dc4c07b763e4a399fba';
const WETH = '0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c';
const AMOUNT = 10000000000000000n; // 0.01 WETH

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
  throw new Error('Gateway timeout');
}

async function main() {
  const handleClient = await createViemHandleClient(walletClient);

  console.log('Before:');
  const td = await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'totalDeposited' });
  const balHandle = await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'balanceOf', args: [account.address] });
  const maxW = await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'maxWithdrawable' });
  console.log('  totalDeposited:', Number(td) / 1e18, 'WETH | balance unique:', balHandle.slice(2).slice(12, 14) === '01', '| maxWithdrawable:', Number(maxW) / 1e18, 'WETH');
  const wethBal = await publicClient.readContract({ address: WETH, abi: parseAbi(['function balanceOf(address) view returns (uint256)']), functionName: 'balanceOf', args: [account.address] });
  console.log('  deployer WETH balance:', Number(wethBal) / 1e18);

  console.log('\n1. prepareWithdraw(0.01 WETH)...');
  let est = await publicClient.estimateContractGas({ address: VAULT, abi: vaultAbi, functionName: 'prepareWithdraw', args: [AMOUNT, account.address], account });
  console.log('  est gas:', est.toString());
  let hash = await walletClient.writeContract({ address: VAULT, abi: vaultAbi, functionName: 'prepareWithdraw', args: [AMOUNT, account.address], gas: est + 200000n });
  let rec = await publicClient.waitForTransactionReceipt({ hash });
  console.log('  status:', rec.status, 'gas:', rec.gasUsed.toString());
  if (rec.status === 'reverted') process.exit(1);

  console.log('2. fetching both proofs...');
  const apprHandle = await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'withdrawApproval', args: [account.address] });
  const bookHandle = await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'booksInvariant', args: [account.address] });
  console.log('  approval:', String(apprHandle).slice(0, 24), '| books:', String(bookHandle).slice(0, 24));
  const approvalProof = await waitForGateway(String(apprHandle));
  const invariantProof = await waitForGateway(String(bookHandle));
  console.log('  both proofs fetched');

  console.log('3. withdraw...');
  est = await publicClient.estimateContractGas({ address: VAULT, abi: vaultAbi, functionName: 'withdraw', args: [approvalProof, invariantProof, AMOUNT, account.address, account.address], account });
  console.log('  est gas:', est.toString());
  hash = await walletClient.writeContract({ address: VAULT, abi: vaultAbi, functionName: 'withdraw', args: [approvalProof, invariantProof, AMOUNT, account.address, account.address], gas: est + 300000n });
  rec = await publicClient.waitForTransactionReceipt({ hash });
  console.log('  status:', rec.status, 'gas:', rec.gasUsed.toString());
  if (rec.status === 'reverted') process.exit(1);

  console.log('\nAfter withdraw:');
  const td2 = await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'totalDeposited' });
  const balHandle2 = await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'balanceOf', args: [account.address] });
  console.log('  totalDeposited:', Number(td2) / 1e18, 'WETH (expected 0.01)');
  const dec2 = await handleClient.decrypt(balHandle2);
  console.log('  owner decrypt balanceOf:', dec2.value.toString(), '(expected 10000000000000000)');
  const wethBal2 = await publicClient.readContract({ address: WETH, abi: parseAbi(['function balanceOf(address) view returns (uint256)']), functionName: 'balanceOf', args: [account.address] });
  console.log('  deployer WETH balance:', Number(wethBal2) / 1e18, '(+0.01 expected)');

  console.log('\n4. re-depositing 0.01 WETH to restore position...');
  const { handle, handleProof } = await handleClient.encryptInput(AMOUNT, 'uint256', VAULT);
  hash = await walletClient.writeContract({ address: WETH, abi: parseAbi(['function approve(address,uint256) returns (bool)']), functionName: 'approve', args: [VAULT, AMOUNT] });
  await publicClient.waitForTransactionReceipt({ hash });
  est = await publicClient.estimateContractGas({ address: VAULT, abi: vaultAbi, functionName: 'deposit', args: [AMOUNT, account.address, handle, handleProof], account });
  hash = await walletClient.writeContract({ address: VAULT, abi: vaultAbi, functionName: 'deposit', args: [AMOUNT, account.address, handle, handleProof], gas: est + 300000n });
  rec = await publicClient.waitForTransactionReceipt({ hash });
  console.log('  re-deposit status:', rec.status, 'gas:', rec.gasUsed.toString());

  const td3 = await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'totalDeposited' });
  console.log('  final totalDeposited:', Number(td3) / 1e18, 'WETH (expected 0.02)');
  console.log('ETH balance:', Number(await publicClient.getBalance({ address: account.address })) / 1e18);
}

main().catch(e => { console.error(e); process.exit(1); });
