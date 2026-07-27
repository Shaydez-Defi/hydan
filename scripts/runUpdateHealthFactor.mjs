import { createWalletClient, http, getContract, parseAbi, createPublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { createViemHandleClient } from '@iexec-nox/handle';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const artifact = JSON.parse(readFileSync(join(__dirname, '../artifacts/contracts/HydanVault.sol/HydanVault.json'), 'utf8'));
const VAULT_ABI = artifact.abi;

const VAULT_ADDRESS = '0x394fdd9013a55da0280ffd33c9e008878490a4d6';
const POOL_ADDRESS = '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951';

async function main() {
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  const privateKey = process.env.SEPOLIA_PRIVATE_KEY;
  if (!rpcUrl || !privateKey) throw new Error('Missing SEPOLIA_RPC_URL or SEPOLIA_PRIVATE_KEY');
  const account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey : '0x' + privateKey);
  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });

  console.log('Updating health factor for:', account.address);
  console.log('Vault:', VAULT_ADDRESS);

  const vault = getContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    client: { public: publicClient, wallet: walletClient },
  });

  const pool = getContract({
    address: POOL_ADDRESS,
    abi: parseAbi([
      'function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
    ]),
    client: { public: publicClient },
  });

  const userAccountData = await pool.read.getUserAccountData([VAULT_ADDRESS]);
  const healthFactor = userAccountData[5];
  const threshold = 1000000000000000000000000000n;

  console.log(`Vault health factor (ray): ${healthFactor}`);

  const isHealthy = healthFactor > threshold;
  console.log(`Healthy (plaintext): ${isHealthy}`);

  const handleClient = await createViemHandleClient(walletClient);

  const encryptedHealthFactor = await handleClient.encryptInput(
    2000000000000000000000000000n, // 2.0 in ray precision (2 * 10^27)
    'uint256',
    VAULT_ADDRESS
  );
  console.log(`Encrypted health factor handle: ${encryptedHealthFactor.handle}`);
  console.log(`Input proof length: ${encryptedHealthFactor.handleProof.length}`);

  console.log('Submitting health factor to vault...');
  const hash = await vault.write.updateHealthStatus([
    encryptedHealthFactor.handle,
    encryptedHealthFactor.handleProof,
    threshold
  ]);
  console.log('Tx hash:', hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log('Confirmed! Block:', receipt.blockNumber);
  console.log('Gas used:', receipt.gasUsed);

  const healthStatus = await vault.read.healthStatus();
  console.log(`Health status (encrypted bytes32): ${healthStatus}`);

  try {
    const decrypted = await handleClient.decrypt(healthStatus);
    console.log(`Health status (decrypted): ${decrypted.value}`);
    console.log(`Expected: ${isHealthy}`);
  } catch (e) {
    console.log('Could not decrypt health status:', e.message);
  }

  console.log('\nDone!');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
