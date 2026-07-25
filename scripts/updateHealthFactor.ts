import { network } from 'hardhat';
import { parseAbi, formatUnits, getContract, parseEther, formatEther } from 'viem';
import { AaveV3Sepolia } from '@bgd-labs/aave-address-book';
import { createViemHandleClient } from '@iexec-nox/handle';

async function main() {
  const { viem } = await network.create({ network: 'sepolia' });

  const publicClient = await viem.getPublicClient();
  const [account] = await viem.getWalletClients();

  const userAddress = account.account.address;
  console.log('Updating health factor for:', userAddress);

  // WETH vault address
  const VAULT_ADDRESS = '0x41FAd22279BE65872BBABa5C7B8F74C3ca0a5054' as const;
  console.log('Vault:', VAULT_ADDRESS);

  // WETH address
  const WETH_ADDRESS = '0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c' as const;

  // Create contract instances
  const vault = getContract({
    address: VAULT_ADDRESS,
    abi: parseAbi([
      'function updateHealthStatus(externalEuint256 encryptedHealthFactor, bytes calldata inputProof, uint256 threshold) external',
      'function healthStatus() external view returns (ebool)',
      'function aavePool() external view returns (address)',
    ]),
    client: { public: publicClient, wallet: account },
  });

  const pool = getContract({
    address: '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951', // Aave V3 Sepolia Pool
    abi: parseAbi([
      'function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
    ]),
    client: { public: publicClient },
  });

  const weth = getContract({
    address: AaveV3Sepolia.ASSETS.WETH.UNDERLYING,
    abi: parseAbi([
      'function balanceOf(address account) external view returns (uint256)',
      'function decimals() external view returns (uint8)',
      'function symbol() external view returns (string)',
    ]),
    client: { public: publicClient },
  });

  const symbol = await weth.read.symbol();
  const decimals = await weth.read.decimals();
  console.log(`Token: ${symbol} (${decimals} decimals)`);

  // Get vault's health factor from Aave
  const userAccountData = await pool.read.getUserAccountData([VAULT_ADDRESS]);
  const healthFactor = userAccountData[6]; // healthFactor is the 7th return value (0-indexed = index 6)
  console.log(`Vault health factor (ray precision): ${healthFactor}`);
  console.log(`Health factor (formatted): ${formatUnits(healthFactor, 27)}`); // ray precision = 1e27

  // Threshold: 1.0 in ray precision (1e27)
  const threshold = 1000000000000000000000000000n; // 1e27
  console.log(`Threshold (ray precision): ${threshold}`);

  // Check if health factor is above threshold (healthy) or below (at-risk)
  const isHealthy = healthFactor > threshold;
  console.log(`Healthy (plaintext): ${isHealthy}`);

  // Encrypt health factor using Nox SDK
  // Create handle client for encryption with only smartContractAddress (no gatewayUrl/subgraphUrl)
  const handleClient = await createViemHandleClient(
    account, // Use the actual wallet client
    {
      smartContractAddress: '0x24ef36ec5b626d7dcd09a98f3083c2758f0f77bf', // NoxCompute on Sepolia
    }
  );

  // Encrypt the health factor
  const encryptedHealthFactor = await handleClient.encryptInput(
    healthFactor,
    'uint256',
    VAULT_ADDRESS
  );
  console.log(`Encrypted health factor handle: ${encryptedHealthFactor.handle}`);
  console.log(`Input proof: ${encryptedHealthFactor.inputProof}`);

  // Submit to contract
  console.log('Submitting health factor to vault...');
  const hash = await vault.write.updateHealthStatus([
    encryptedHealthFactor.handle,
    encryptedHealthFactor.inputProof,
    1000000000000000000000000000n // threshold = 1e27 (1.0 in ray)
  ]);
  console.log('Tx hash:', hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log('Confirmed! Block:', receipt.blockNumber);

  // Read back the health status
  const healthStatus = await vault.read.healthStatus();
  console.log(`Health status (encrypted): ${healthStatus}`);

  // Decrypt the health status (publicly decryptable)
  try {
    const decrypted = await handleClient.decrypt(healthStatus);
    console.log(`Health status (decrypted): ${decrypted.value}`);
    console.log(`Expected: ${isHealthy}`);
  } catch (e) {
    console.log('Could not decrypt health status:', e);
  }

  console.log('\nDone!');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});