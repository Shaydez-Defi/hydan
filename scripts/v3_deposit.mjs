import { createPublicClient, createWalletClient, http, getContract, parseAbi } from 'viem';
import { randomBytes } from 'crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createViemHandleClient } from '@iexec-nox/handle';

const __dirname = dirname(fileURLToPath(import.meta.url));
const artifact = JSON.parse(readFileSync(join(__dirname, '../frontend/src/abi/HydanVault.json'), 'utf8'));
const vaultAbi = artifact.abi;

const pk = process.env.SEPOLIA_PRIVATE_KEY;
const account = privateKeyToAccount(pk.startsWith('0x') ? pk : '0x' + pk);
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL) });
const publicClient = createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL) });

const VAULT = '0x330b5c509bc1621585e88dc4c07b763e4a399fba';
const WETH = '0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c';

async function main() {
  const bal = await publicClient.getBalance({ address: account.address });
  console.log('ETH:', Number(bal) / 1e18);

  const handleClient = await createViemHandleClient(walletClient);

  const depositAmount = 20000000000000000n; // 0.02 WETH
  console.log('\n1. Approving WETH...');
  let hash = await walletClient.writeContract({
    address: WETH, abi: parseAbi(['function approve(address,uint256) returns (bool)']),
    functionName: 'approve', args: [VAULT, depositAmount],
  });
  await publicClient.waitForTransactionReceipt({ hash });

  console.log('2. Encrypting deposit amount...');
  const { handle, handleProof } = await handleClient.encryptInput(depositAmount, 'uint256', VAULT);
  console.log('   handle:', handle.slice(0, 20) + '...', 'unique:', handle.slice(2).slice(12, 14) === '01');

  console.log('3. Depositing', Number(depositAmount) / 1e18, 'WETH...');
  const est = await publicClient.estimateContractGas({
    address: VAULT, abi: vaultAbi, functionName: 'deposit',
    args: [depositAmount, account.address, handle, handleProof], account,
  });
  console.log('   estimated gas:', est.toString());
  hash = await walletClient.writeContract({
    address: VAULT, abi: vaultAbi, functionName: 'deposit',
    args: [depositAmount, account.address, handle, handleProof],
    gas: est + 200000n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log('   status:', receipt.status, '| gas used:', receipt.gasUsed.toString());
  if (receipt.status === 'reverted') process.exit(1);

  const balAfter = await publicClient.getBalance({ address: account.address });
  console.log('ETH after:', Number(balAfter) / 1e18);

  // Read the confidential balance handle
  const balHandle = await publicClient.readContract({
    address: VAULT, abi: vaultAbi, functionName: 'balanceOf', args: [account.address],
  });
  console.log('balanceOf handle:', balHandle, 'unique:', balHandle.slice(2).slice(12, 14) === '01');
  console.log('totalDeposited:', (await publicClient.readContract({
    address: VAULT, abi: vaultAbi, functionName: 'totalDeposited', args: [],
  })).toString());

  // Privacy check: public endpoint must 403 on the confidential balance
  const salt = '0x' + randomBytes(32).toString('hex');
  const resp = await fetch('https://gateway-testnets.noxprotocol.dev/v0/public/' + balHandle + '?salt=' + salt);
  console.log('   /v0/public on balanceOf:', resp.status, '(403 = private)');

  // Owner can still decrypt their own balance
  const dec = await handleClient.decrypt(balHandle);
  console.log('   owner decrypt balanceOf:', dec.value.toString(), '(expected', depositAmount.toString() + ')');
}

main().catch(e => { console.error(e); process.exit(1); });
