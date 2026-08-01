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
  throw new Error('Gateway timeout');
}

async function main() {
  const poolAbi = parseAbi([
    'function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)',
  ]);
  const pool = await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'aavePool' });
  const data = await publicClient.readContract({ address: pool, abi: poolAbi, functionName: 'getUserAccountData', args: [VAULT] });
  console.log('Aave position: collateral', Number(data[0]) / 1e8, '| debt', Number(data[1]) / 1e8, '| avail', Number(data[2]) / 1e8, '| HF', Number(data[5]) / 1e18);

  const borrowAmount = 15000000n; // 15 USDC
  console.log('\nBorrowing', Number(borrowAmount) / 1e6, 'USDC (2-step encrypted)...');
  const handleClient = await createViemHandleClient(walletClient);
  const { handle, handleProof } = await handleClient.encryptInput(borrowAmount, 'uint256', VAULT);
  const { handle: storageHandle, handleProof: storageProof } = await handleClient.encryptInput(borrowAmount, 'uint256', VAULT);
  console.log('  amount handle  :', handle.slice(0, 20) + '...', 'unique:', handle.slice(2).slice(12, 14) === '01');
  console.log('  storage handle :', storageHandle.slice(0, 20) + '...', 'unique:', storageHandle.slice(2).slice(12, 14) === '01');

  console.log('  prepareBorrow...');
  const est = await publicClient.estimateContractGas({
    address: VAULT, abi: vaultAbi, functionName: 'prepareBorrow',
    args: [handle, storageHandle, handleProof, storageProof], account,
  });
  console.log('  est gas:', est.toString());
  let hash = await walletClient.writeContract({
    address: VAULT, abi: vaultAbi, functionName: 'prepareBorrow',
    args: [handle, storageHandle, handleProof, storageProof], gas: est + 200000n,
  });
  await publicClient.waitForTransactionReceipt({ hash });

  console.log('  waiting for gateway proof...');
  const decryptionProof = await waitForGateway(handle);

  console.log('  borrow...');
  const est2 = await publicClient.estimateContractGas({
    address: VAULT, abi: vaultAbi, functionName: 'borrow',
    args: [USDC, handle, storageHandle, storageProof, decryptionProof, 2, 0, account.address], account,
  });
  console.log('  est gas:', est2.toString());
  hash = await walletClient.writeContract({
    address: VAULT, abi: vaultAbi, functionName: 'borrow',
    args: [USDC, handle, storageHandle, storageProof, decryptionProof, 2, 0, account.address],
    gas: est2 + 200000n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log('  borrow status:', receipt.status, '| gas used:', receipt.gasUsed.toString());
  if (receipt.status === 'reverted') process.exit(1);

  const debtHandle = await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'debtOf', args: [account.address] });
  console.log('  debtOf handle:', debtHandle, 'unique:', debtHandle.slice(2).slice(12, 14) === '01');
  const resp = await fetch('https://gateway-testnets.noxprotocol.dev/v0/public/' + debtHandle + '?salt=0x' + randomBytes(32).toString('hex'));
  console.log('  /v0/public on debtOf:', resp.status, '(403 = private)');
  const dec = await handleClient.decrypt(debtHandle);
  console.log('  owner decrypt debtOf:', dec.value.toString(), '(expected', borrowAmount.toString() + ')');

  const data2 = await publicClient.readContract({ address: pool, abi: poolAbi, functionName: 'getUserAccountData', args: [VAULT] });
  console.log('\nFinal: collateral', Number(data2[0]) / 1e8, '| debt', Number(data2[1]) / 1e8, '| HF', Number(data2[5]) / 1e18);
  console.log('ETH balance:', Number(await publicClient.getBalance({ address: account.address })) / 1e18);
}

main().catch(e => { console.error(e); process.exit(1); });
