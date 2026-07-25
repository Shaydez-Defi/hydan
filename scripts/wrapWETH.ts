import { network } from "hardhat";
import { parseAbi, formatUnits, getContract, parseEther } from "viem";
import { AaveV3Sepolia } from "@bgd-labs/aave-address-book";

const WETH_ABI = parseAbi([
  "function deposit() external payable",
  "function withdraw(uint256 amount) external",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
]);

async function main() {
  const { viem } = await network.create({ network: "sepolia" });

  const publicClient = await viem.getPublicClient();
  const [account] = await viem.getWalletClients();

  const userAddress = account.account.address;
  console.log("Wrapping ETH to WETH for:", userAddress);

  const weth = getContract({
    address: AaveV3Sepolia.ASSETS.WETH.UNDERLYING,
    abi: WETH_ABI,
    client: { public: publicClient, wallet: account },
  });

  const symbol = await weth.read.symbol();
  const decimals = await weth.read.decimals();
  console.log(`Token: ${symbol} (${decimals} decimals)`);
  console.log(`WETH: ${AaveV3Sepolia.ASSETS.WETH.UNDERLYING}`);

  const balanceBefore = await weth.read.balanceOf([userAddress]);
  console.log(`WETH balance before: ${formatUnits(balanceBefore, decimals)} ${symbol}`);

  // Check ETH balance
  const ethBalance = await publicClient.getBalance({ address: userAddress });
  console.log(`ETH balance: ${formatUnits(ethBalance, 18)} ETH`);

  // Wrap 0.01 ETH
  const amount = parseEther("0.01");
  console.log(`\nWrapping ${formatEther(amount)} ETH to WETH...`);

  try {
    const hash = await weth.write.deposit([], { value: amount });
    console.log("Tx hash:", hash);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log("Wrapped! Block:", receipt.blockNumber);
  } catch (error) {
    console.error("Wrap failed:", error);
  }

  const balanceAfter = await weth.read.balanceOf([userAddress]);
  console.log(`WETH balance after: ${formatUnits(balanceAfter, decimals)} ${symbol}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});