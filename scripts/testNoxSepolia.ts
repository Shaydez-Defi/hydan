import { network } from 'hardhat';
import { parseAbi, formatUnits, getContract } from 'viem';
import { AaveV3Sepolia } from '@bgd-labs/aave-address-book';
import { createViemHandleClient } from '@iexec-nox/handle';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import the compiled HydanVault ABI from artifacts
const artifactPath = path.join(__dirname, '../artifacts/contracts/HydanVault.sol/HydanVault.json');
const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
const VAULT_ABI = artifact.abi;

async function main() {
  const { viem } = await network.create({ network: 'sepolia' });

  const publicClient = await viem.getPublicClient();
  const [account] = await viem.getWalletClients();

  const userAddress = account.account.address;
  console.log('Testing Nox encryption on Sepolia for:', userAddress);

  // WETH vault address
  const VAULT_ADDRESS = '0x41FAd22279BE65872BBABa5C7B8F74C3ca0a5054' as const;
  console.log('Vault:', VAULT_ADDRESS);

  // Test Nox encryption directly without Aave
  // Create handle client for encryption
  const handleClient = await createViemHandleClient(
    account, // Use the actual wallet client
    {
      smartContractAddress: '0x24ef36ec5b626d7dcd09a98f3083c2758f0f77bf', // NoxCompute on Sepolia
    }
  );

  // Test encryptInput with a simple value
  console.log('Testing encryptInput on Sepolia...');
  const testValue = 1000000000000000000n; // 1.0 in ray precision (1e18 for testing)
  const encrypted = await handleClient.encryptInput(
    testValue,
    'uint256',
    '0x41FAd22279BE65872BBABa5C7B8F74C3ca0a5054' // application contract
  );
  console.log(`✅ Encryption successful!`);
  console.log(`Handle: ${encrypted.handle}`);
  console.log(`Proof: ${encrypted.inputProof}`);

  // Try to decrypt
  try {
    const decrypted = await handleClient.decrypt(encrypted.handle);
    console.log(`✅ Decryption successful: ${decrypted.value}`);
  } catch (e) {
    console.log('Decryption failed (may need public decryption):', e);
  }

  console.log('\nDone! Nox Sepolia gateway is working.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});