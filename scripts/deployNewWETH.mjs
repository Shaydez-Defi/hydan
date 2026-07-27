import { createWalletClient, http, getContract, createPublicClient, parseAbi, encodeDeployData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const artifact = JSON.parse(readFileSync(join(__dirname, '../artifacts/contracts/HydanVault.sol/HydanVault.json'), 'utf8'));

const rpcUrl = process.env.SEPOLIA_RPC_URL;
const privateKey = process.env.SEPOLIA_PRIVATE_KEY;
const account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey : '0x' + privateKey);
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });
const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });

const WETH = '0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c';
const POOL_ADDRESSES_PROVIDER = '0x012bAC54348C0E635dCAc9D5FB99f06F24136C9A';
const POOL = '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951';
const DATA_PROVIDER = '0x3e9708d80f7B3e43118013075F7e95CE3AB31F31';

async function main() {
  // Deploy HydanVault
  console.log('Deploying HydanVault...');
  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args: [WETH, POOL_ADDRESSES_PROVIDER],
  });
  console.log('Deploy tx:', hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const vaultAddress = receipt.contractAddress;
  console.log('Vault deployed at:', vaultAddress);

  // Set Aave pool
  console.log('\nSetting Aave pool...');
  const vault = getContract({
    address: vaultAddress,
    abi: artifact.abi,
    client: { public: publicClient, wallet: walletClient },
  });
  let poolHash = await vault.write.setAavePool([POOL]);
  console.log('setAavePool tx:', poolHash);
  await publicClient.waitForTransactionReceipt({ hash: poolHash });
  console.log('Aave pool set!');

  // Get aToken address
  console.log('\nGetting aToken address...');
  const dataProvider = getContract({
    address: DATA_PROVIDER,
    abi: parseAbi([
      'function getReserveTokensAddresses(address asset) external view returns (address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress)',
    ]),
    client: { public: publicClient },
  });
  const [aTokenAddress] = await dataProvider.read.getReserveTokensAddresses([WETH]);
  console.log('aToken:', aTokenAddress);

  // Set aToken
  console.log('\nSetting aToken...');
  let aTokenHash = await vault.write.setAToken([aTokenAddress]);
  console.log('setAToken tx:', aTokenHash);
  await publicClient.waitForTransactionReceipt({ hash: aTokenHash });
  console.log('aToken set!');

  // Verify
  console.log('\n--- Vault Info ---');
  const asset = await vault.read.asset();
  console.log('Asset:', asset);
  const aavePool = await vault.read.aavePool();
  console.log('AavePool:', aavePool);
  const aToken = await vault.read.aToken();
  console.log('AToken:', aToken);
  const totalShares = await vault.read.totalShares();
  console.log('Total shares:', totalShares);
  const totalAssets = await vault.read.totalAssets();
  console.log('Total assets:', totalAssets);

  console.log('\nDone! Vault at:', vaultAddress);
}

main().catch(console.error);
