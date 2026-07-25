import { network } from 'hardhat';
import { parseAbi, formatUnits, getContract } from 'viem';
import { AaveV3Sepolia } from '@bgd-labs/aave-address-book';

const FAUCET_ABI = parseAbi(['function mint(address token, address to, uint256 amount) external']);

const ERC20_ABI = parseAbi([
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
]);

async function main() {
  const { viem } = await network.create({ network: 'sepolia' });

  const publicClient = await viem.getPublicClient();
  const [account] = await viem.getWalletClients();

  const userAddress = account.account.address;
  console.log('Minting GHO to:', userAddress);

  const faucet = getContract({
    address: AaveV3Sepolia.FAUCET,
    abi: FAUCET_ABI,
    client: { public: publicClient, wallet: account },
  });

  const gho = getContract({
    address: AaveV3Sepolia.ASSETS.GHO.UNDERLYING,
    abi: ERC20_ABI,
    client: { public: publicClient, wallet: account },
  });

  const symbol = await gho.read.symbol();
  const decimals = await gho.read.decimals();
  console.log(`Token: ${symbol} (${decimals} decimals)`);
  console.log(`Faucet: ${AaveV3Sepolia.FAUCET}`);
  console.log(`GHO: ${AaveV3Sepolia.ASSETS.GHO.UNDERLYING}`);

  const balanceBefore = await gho.read.balanceOf([userAddress]);
  console.log(`Balance before: ${formatUnits(balanceBefore, decimals)} ${symbol}`);

  const amount = 1000n * 10n ** BigInt(decimals); // 1000 GHO (18 decimals)
  console.log(`Minting ${formatUnits(amount, decimals)} ${symbol} via Faucet...`);

  try {
    const hash = await faucet.write.mint([AaveV3Sepolia.ASSETS.GHO.UNDERLYING, userAddress, amount]);
    console.log('Tx hash:', hash);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log('Minted! Block:', receipt.blockNumber);
  } catch (error) {
    console.error('Mint failed:', error);
  }

  const balanceAfter = await gho.read.balanceOf([userAddress]);
  console.log(`Balance after: ${formatUnits(balanceAfter, decimals)} ${symbol}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
