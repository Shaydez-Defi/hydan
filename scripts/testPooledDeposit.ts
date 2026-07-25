import { network } from "hardhat";
import { parseAbi, formatUnits, getContract } from "viem";
import { AaveV3Sepolia } from "@bgd-labs/aave-address-book";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const artifactPath = path.join(__dirname, "../artifacts/contracts/HydanVault.sol/HydanVault.json");
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const VAULT_ABI = artifact.abi;

const VAULT_ADDRESS = "0x35DFa22be33993419362367635F9Ff397E8B2D1d" as const;

const ERC20_ABI = parseAbi([
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
]);

type AssetSymbol = "USDC" | "DAI";

function getAssetInfo(symbol: AssetSymbol) {
  switch (symbol) {
    case "USDC":
      return {
        address: AaveV3Sepolia.ASSETS.USDC.UNDERLYING,
        testAmount: 10n,
      };
    case "DAI":
      return {
        address: AaveV3Sepolia.ASSETS.DAI.UNDERLYING,
        testAmount: 10n,
      };
    default:
      throw new Error(`Unknown asset: ${symbol}`);
  }
}

async function main() {
  const assetSymbol = (process.env.ASSET || "USDC") as AssetSymbol;
  const assetInfo = getAssetInfo(assetSymbol);

  const { viem, nox } = await network.create({ network: "sepolia" });

  const publicClient = await viem.getPublicClient();
  const [account] = await viem.getWalletClients();

  const userAddress = account.account.address;
  console.log("Testing pooled deposit for:", userAddress);
  console.log("Vault:", VAULT_ADDRESS);
  console.log("Asset:", assetSymbol);

  const assetAddress = assetInfo.address;
  console.log(`${assetSymbol}:`, assetAddress);

  const vault = getContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    client: { public: publicClient, wallet: account },
  });

  const asset = getContract({
    address: assetAddress,
    abi: parseAbi([
      "function balanceOf(address account) external view returns (uint256)",
      "function decimals() external view returns (uint8)",
      "function symbol() external view returns (string)",
      "function approve(address spender, uint256 amount) external returns (bool)",
      "function allowance(address owner, address spender) external view returns (uint256)",
    ]),
    client: { public: publicClient, wallet: account },
  });

  const symbol = await asset.read.symbol();
  const decimals = await asset.read.decimals();
  console.log(`Token: ${symbol} (${decimals} decimals)`);

  // Deposit amount: use DEPOSIT_AMOUNT env var or default testAmount
  let depositAmount: bigint;
  const depositAmountEnv = process.env.DEPOSIT_AMOUNT;
  if (depositAmountEnv) {
    depositAmount = parseUnits(depositAmountEnv, decimals);
    console.log(`Using DEPOSIT_AMOUNT: ${depositAmountEnv} ${symbol}`);
  } else {
    depositAmount = assetInfo.testAmount * 10n ** BigInt(decimals);
    console.log(`Using default amount: ${formatUnits(depositAmount, decimals)} ${symbol}`);
  }

  // Preview expected shares
  const expectedShares = await vault.read.previewDeposit([depositAmount]);
  console.log(`Expected shares (from previewDeposit): ${expectedShares}`);

  // Check current allowance
  const allowance = await asset.read.allowance([userAddress, VAULT_ADDRESS]);
  console.log(`Current allowance: ${formatUnits(allowance, decimals)} ${symbol}`);

  if (allowance < depositAmount) {
    console.log(`Approving vault to spend ${symbol}...`);
    const approveHash = await asset.write.approve([VAULT_ADDRESS, depositAmount]);
    console.log("Approve tx hash:", approveHash);
    const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log("Approved! Block:", approveReceipt.blockNumber);
  } else {
    console.log("Allowance already sufficient");
  }

  // Deposit via vault
  console.log("Calling deposit() on vault...");
  const depositHash = await vault.write.deposit([assetAddress, depositAmount, userAddress]);
  console.log("Deposit tx hash:", depositHash);
  const depositReceipt = await publicClient.waitForTransactionReceipt({ hash: depositHash });
  console.log("Deposit confirmed! Block:", depositReceipt.blockNumber);

  // Read encrypted share balance
  const encryptedBalance = await vault.read.balanceOf([userAddress]);
  console.log(`Encrypted share balance (raw handle): ${encryptedBalance}`);

  // Decrypt the encrypted balance using Nox SDK
  console.log("Decrypting encrypted share balance using Nox SDK...");
  try {
    const decrypted = await nox.decrypt(encryptedBalance, account);
    console.log(`\nDecrypted shares: ${decrypted.value}`);
    console.log(`Expected shares: ${expectedShares}`);
    console.log(`Match: ${decrypted.value === expectedShares ? "YES" : "NO"}`);
  } catch (e) {
    console.log("\nNote: Could not decrypt balance (requires proper Nox network setup)");
    console.log("Error:", e);
  }

  // Verify totalShares was updated
  const totalSharesAfter = await vault.read.totalShares();
  console.log(`Total shares after deposit: ${totalSharesAfter}`);

  console.log("\nDone!");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});