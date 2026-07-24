import { network } from "hardhat";
import { parseAbi, formatUnits, getContract, parseUnits } from "viem";
import { AaveV3Sepolia } from "@bgd-labs/aave-address-book";

const VAULT_ADDRESS = "0xA01AF1AACC43573049cef74Dc6Af62c3ff92A84D" as const;

const VAULT_ABI = parseAbi([
  "function deposit(address asset, uint256 amount, uint16 referralCode) external",
]);

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function allowance(address owner, address spender) external view returns (uint256)",
]);

type AssetSymbol = "USDC" | "DAI";

function getAssetInfo(symbol: AssetSymbol) {
  switch (symbol) {
    case "USDC":
      return {
        address: AaveV3Sepolia.ASSETS.USDC.UNDERLYING,
        testAmount: 10n, // 10 USDC
      };
    case "DAI":
      return {
        address: AaveV3Sepolia.ASSETS.DAI.UNDERLYING,
        testAmount: 10n, // 10 DAI
      };
    default:
      throw new Error(`Unknown asset: ${symbol}`);
  }
}

function parseDepositAmount(amountStr: string, decimals: number): bigint {
  return parseUnits(amountStr, decimals);
}

async function main() {
  const assetSymbol = (process.env.ASSET || "USDC") as AssetSymbol;
  const assetInfo = getAssetInfo(assetSymbol);

  const { viem } = await network.create({ network: "sepolia" });

  const publicClient = await viem.getPublicClient();
  const [account] = await viem.getWalletClients();

  const userAddress = account.account.address;
  console.log("Testing deposit for:", userAddress);
  console.log("Vault:", VAULT_ADDRESS);
  console.log("Asset:", assetSymbol);

  const asset = getContract({
    address: assetInfo.address,
    abi: ERC20_ABI,
    client: { public: publicClient, wallet: account },
  });

  const vault = getContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    client: { public: publicClient, wallet: account },
  });

  const symbol = await asset.read.symbol();
  const decimals = await asset.read.decimals();
  console.log(`Token: ${symbol} (${decimals} decimals)`);

  // Use DEPOSIT_AMOUNT env var if set, otherwise use default testAmount
  let amount: bigint;
  const depositAmountEnv = process.env.DEPOSIT_AMOUNT;
  if (depositAmountEnv) {
    amount = parseDepositAmount(depositAmountEnv, decimals);
    console.log(`Using DEPOSIT_AMOUNT: ${depositAmountEnv} ${symbol}`);
  } else {
    amount = assetInfo.testAmount * 10n ** BigInt(decimals);
    console.log(`Using default amount: ${formatUnits(amount, decimals)} ${symbol}`);
  }

  // Check current allowance
  const allowance = await asset.read.allowance([userAddress, VAULT_ADDRESS]);
  console.log(`Current allowance: ${formatUnits(allowance, decimals)} ${symbol}`);

  if (allowance < amount) {
    console.log(`Approving vault to spend ${symbol}...`);
    const approveHash = await asset.write.approve([VAULT_ADDRESS, amount]);
    console.log("Approve tx hash:", approveHash);
    const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log("Approved! Block:", approveReceipt.blockNumber);
  } else {
    console.log("Allowance already sufficient");
  }

  // Deposit via vault
  console.log("Calling deposit() on vault...");
  const depositHash = await vault.write.deposit([assetInfo.address, amount, 0]);
  console.log("Deposit tx hash:", depositHash);
  const depositReceipt = await publicClient.waitForTransactionReceipt({ hash: depositHash });
  console.log("Deposit confirmed! Block:", depositReceipt.blockNumber);

  console.log("Done!");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});