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
const erc20Abi = parseAbi(['function approve(address,uint256) returns (bool)']);
const roundTrip = 5000000n; // 5 USDC

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
  const debtBefore = await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'debtOf', args: [account.address] });

  console.log('1. borrowing 5 USDC...');
  const { handle, handleProof } = await handleClient.encryptInput(roundTrip, 'uint256', VAULT);
  const { handle: storageHandle, handleProof: storageProof } = await handleClient.encryptInput(roundTrip, 'uint256', VAULT);
  let est = await publicClient.estimateContractGas({ address: VAULT, abi: vaultAbi, functionName: 'prepareBorrow', args: [handle, storageHandle, handleProof, storageProof], account });
  let hash = await walletClient.writeContract({ address: VAULT, abi: vaultAbi, functionName: 'prepareBorrow', args: [handle, storageHandle, handleProof, storageProof], gas: est + 200000n });
  await publicClient.waitForTransactionReceipt({ hash });
  const proof = await waitForGateway(handle);
  est = await publicClient.estimateContractGas({ address: VAULT, abi: vaultAbi, functionName: 'borrow', args: [USDC, handle, storageHandle, storageProof, proof, 2, 0, account.address], account });
  hash = await walletClient.writeContract({ address: VAULT, abi: vaultAbi, functionName: 'borrow', args: [USDC, handle, storageHandle, storageProof, proof, 2, 0, account.address], gas: est + 200000n });
  let rec = await publicClient.waitForTransactionReceipt({ hash });
  console.log('  borrow:', rec.status, '| gas:', rec.gasUsed.toString());
  if (rec.status === 'reverted') process.exit(1);

  console.log('2. approving vault to pull USDC, then repaying 5 USDC...');
  hash = await walletClient.writeContract({ address: USDC, abi: erc20Abi, functionName: 'approve', args: [VAULT, roundTrip] });
  await publicClient.waitForTransactionReceipt({ hash });
  est = await publicClient.estimateContractGas({ address: VAULT, abi: vaultAbi, functionName: 'repay', args: [USDC, roundTrip, 2, account.address], account });
  hash = await walletClient.writeContract({ address: VAULT, abi: vaultAbi, functionName: 'repay', args: [USDC, roundTrip, 2, account.address], gas: est + 200000n });
  rec = await publicClient.waitForTransactionReceipt({ hash });
  console.log('  repay:', rec.status, '| gas:', rec.gasUsed.toString());
  if (rec.status === 'reverted') process.exit(1);

  console.log('3. verifying debtOf after round-trip...');
  await new Promise(r => setTimeout(r, 3000));
  const debtAfter = await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'debtOf', args: [account.address] });
  console.log('  debt unique:', debtAfter.slice(2).slice(12, 14) === '01');
  const dec = await handleClient.decrypt(debtAfter);
  console.log('  owner decrypt debtOf:', dec.value.toString(), '(expected 15000000 = 15 USDC)');
  const salt = '0x' + randomBytes(32).toString('hex');
  const resp = await fetch('https://gateway-testnets.noxprotocol.dev/v0/public/' + debtAfter + '?salt=' + salt);
  console.log('  /v0/public on debtOf:', resp.status, '(403 = private)');
  console.log('  ETH:', Number(await publicClient.getBalance({ address: account.address })) / 1e18);
}

main().catch(e => { console.error(e); process.exit(1); });
