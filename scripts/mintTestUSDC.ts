import { network } from "hardhat";
import { parseAbi, formatUnits } from "viem";

const USDC_ADDRESS = "0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8";
const USDC_ABI = parseAbi([
  "function mint(address to, uint256 amount) external",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
]);

async function main() {
  const { viem } = await network.create({
    network: "sepolia",
  });

  const publicClient = await viem.getPublicClient();
  const [account] = await viem.getWalletClients();
  console.log("Minting to:", account.account.address);

  const usdc = await viem.getContractAt(USDC_ABI, USDC_ADDRESS);
  const symbol = await usdc.read.symbol();
  const decimals = await usdc.read.decimals();
  console.log(`Token: ${symbol} (${decimals} decimals)`);

  const balanceBefore = await usdc.read.balanceOf([account.account.address]);
  console.log(`Balance before: ${formatUnits(balanceBefore, decimals)} ${symbol}`);

  const amount = 1000n * 10n ** BigInt(decimals);
  console.log(`Attempting to mint ${formatUnits(amount, decimals)} ${symbol}...`);

  try {
    const hash = await usdc.write.mint([account.account.address, amount]);
    console.log("Tx hash:", hash);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log("Minted! Block:", receipt.blockNumber);
  } catch (error) {
    console.error("Mint failed:", error);
    console.log("This USDC contract likely doesn't have a public mint function.");
    console.log("Use a USDC faucet instead: https://faucet.circle.com/ or https://sepoliafaucet.com/");
  }

  const balanceAfter = await usdc.read.balanceOf([account.account.address]);
  console.log(`Balance after: ${formatUnits(balanceAfter, decimals)} ${symbol}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});