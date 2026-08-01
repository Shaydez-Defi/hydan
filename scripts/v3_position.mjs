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
const USDC = '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8';
const erc20Abi = parseAbi([
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
]);

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

async function isPrivate(handle) {
  const salt = '0x' + randomBytes(32).toString('hex');
  const resp = await fetch('https://gateway-testnets.noxprotocol.dev/v0/public/' + handle + '?salt=' + salt);
  return resp.status === 403;
}

async function main() {
  const handleClient = await createViemHandleClient(walletClient);
  console.log('ETH:', Number(await publicClient.getBalance({ address: account.address })) / 1e18);

  // ---- Deposit 0.02 WETH ----
  const depositAmount = 20000000000000000n;
  let hash;
  const wethBal = await publicClient.readContract({ address: WETH, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] });
  if (wethBal < depositAmount) {
    console.log('\nWrapping ETH -> WETH...');
    const need = depositAmount - wethBal;
    hash = await walletClient.writeContract({ address: WETH, abi: parseAbi(['function deposit() payable']), functionName: 'deposit', value: need });
    await publicClient.waitForTransactionReceipt({ hash });
  }
  console.log('\n== DEPOSIT ==');
  hash = await walletClient.writeContract({ address: WETH, abi: erc20Abi, functionName: 'approve', args: [VAULT, depositAmount] });
  await publicClient.waitForTransactionReceipt({ hash });
  const { handle, handleProof } = await handleClient.encryptInput(depositAmount, 'uint256', VAULT);
  let est = await publicClient.estimateContractGas({ address: VAULT, abi: vaultAbi, functionName: 'deposit', args: [depositAmount, account.address, handle, handleProof], account });
  hash = await walletClient.writeContract({ address: VAULT, abi: vaultAbi, functionName: 'deposit', args: [depositAmount, account.address, handle, handleProof], gas: est + 200000n });
  let rec = await publicClient.waitForTransactionReceipt({ hash });
  console.log('  deposit:', rec.status, '| gas:', rec.gasUsed.toString());
  if (rec.status === 'reverted') process.exit(1);

  let balHandle = await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'balanceOf', args: [account.address] });
  console.log('  balanceOf handle unique:', balHandle.slice(2).slice(12, 14) === '01');
  console.log('  /v0/public on balanceOf:', await isPrivate(balHandle) ? '403 PRIVATE' : 'LEAK');
  await new Promise(r => setTimeout(r, 3000));
  console.log('  owner decrypt balanceOf:', (await handleClient.decrypt(balHandle)).value.toString());

  // ---- Borrow 15 USDC ----
  const borrowAmount = 15000000n;
  console.log('\n== BORROW ==');
  const { handle: amountHandle, handleProof: amountProof } = await handleClient.encryptInput(borrowAmount, 'uint256', VAULT);
  const { handle: storageHandle, handleProof: storageProof } = await handleClient.encryptInput(borrowAmount, 'uint256', VAULT);
  console.log('  amount handle unique:', amountHandle.slice(2).slice(12, 14) === '01', '| storage handle unique:', storageHandle.slice(2).slice(12, 14) === '01');
  est = await publicClient.estimateContractGas({ address: VAULT, abi: vaultAbi, functionName: 'prepareBorrow', args: [amountHandle, storageHandle, amountProof, storageProof], account });
  hash = await walletClient.writeContract({ address: VAULT, abi: vaultAbi, functionName: 'prepareBorrow', args: [amountHandle, storageHandle, amountProof, storageProof], gas: est + 200000n });
  await publicClient.waitForTransactionReceipt({ hash });
  const decryptionProof = await waitForGateway(amountHandle);
  est = await publicClient.estimateContractGas({ address: VAULT, abi: vaultAbi, functionName: 'borrow', args: [USDC, amountHandle, storageHandle, storageProof, decryptionProof, 2, 0, account.address], account });
  hash = await walletClient.writeContract({ address: VAULT, abi: vaultAbi, functionName: 'borrow', args: [USDC, amountHandle, storageHandle, storageProof, decryptionProof, 2, 0, account.address], gas: est + 200000n });
  rec = await publicClient.waitForTransactionReceipt({ hash });
  console.log('  borrow:', rec.status, '| gas:', rec.gasUsed.toString());
  if (rec.status === 'reverted') process.exit(1);

  const debtHandle = await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'debtOf', args: [account.address] });
  console.log('  debtOf handle unique:', debtHandle.slice(2).slice(12, 14) === '01');
  console.log('  /v0/public on debtOf:', await isPrivate(debtHandle) ? '403 PRIVATE' : 'LEAK');
  await new Promise(r => setTimeout(r, 3000));
  console.log('  owner decrypt debtOf:', (await handleClient.decrypt(debtHandle)).value.toString());

  // ---- Aave position ----
  const pool = await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'aavePool' });
  const d = await publicClient.readContract({ address: pool, abi: parseAbi(['function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)']), functionName: 'getUserAccountData', args: [VAULT] });
  console.log('\nAave: collateral $' + Number(d[0]) / 1e8 + ' | debt $' + Number(d[1]) / 1e8 + ' | HF ' + Number(d[5]) / 1e18);
  console.log('totalDeposited:', Number(await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'totalDeposited' })) / 1e18, 'WETH');
  console.log('deployer USDC balance:', Number(await publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] })) / 1e6);
  console.log('ETH:', Number(await publicClient.getBalance({ address: account.address })) / 1e18);
}

main().catch(e => { console.error(e); process.exit(1); });
