import { network } from "hardhat";
import { parseAbi, formatUnits, getContract } from "viem";
import { AaveV3Sepolia } from "@bgd-labs/aave-address-book";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import the compiled HydanVault ABI from artifacts
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

async function main() {
  const { viem, nox } = await network.create({ network: "sepolia" });

  const publicClient = await viem.getPublicClient();
  const [account] = await viem.getWalletClients();

  const userAddress = account.account.address;
  console.log("Testing pooled deposit for:", userAddress);
  console.log("Vault:", VAULT_ADDRESS);
  console.log("Asset: USDC");

  const usdcAddress = AaveV3Sepolia.ASSETS.USDC.UNDERLYING;
  console.log("USDC:", usdcAddress);

  const vault = getContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    client: { public: publicClient, wallet: account },
  });

  const usdc = getContract({
    address: usdcAddress,
    abi: parseAbi([
      "function balanceOf(address account) external view returns (uint256)",
      "function decimals() external view returns (uint8)",
      "function symbol() external view returns (string)",
      "function approve(address spender, uint256 amount) external returns (bool)",
      "function allowance(address owner, address spender) external view returns (uint256)",
    ]),
    client: { public: publicClient, wallet: account },
  });

  const symbol = await usdc.read.symbol();
  const decimals = await usdc.read.decimals();
  console.log(`Token: ${symbol} (${decimals} decimals)`);

  // Check initial balance
  const balanceBefore = await usdc.read.balanceOf([userAddress]);
  console.log(`USDC balance before: ${formatUnits(balanceBefore, decimals)} ${symbol}`);

  // Check current totalShares
  const totalSharesBefore = await vault.read.totalShares();
  console.log(`Total shares before: ${totalSharesBefore}`);

  // Check current encrypted balance
  const encryptedBalanceBefore = await vault.read.balanceOf([userAddress]);
  console.log(`Encrypted balance before: ${encryptedBalanceBefore}`);

  // Deposit 10 USDC
  const depositAmount = 10n * 10n ** BigInt(decimals);
  console.log(`\nDepositing ${formatUnits(depositAmount, decimals)} ${symbol}...`);

  // Approve vault to spend USDC
  const allowance = await usdc.read.allowance([userAddress, VAULT_ADDRESS]);
  if (allowance < depositAmount) {
    console.log("Approving vault to spend USDC...");
    const approveHash = await usdc.write.approve([VAULT_ADDRESS, depositAmount]);
    console.log("Approve tx hash:", approveHash);
    const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log("Approved! Block:", approveReceipt.blockNumber);
  }

  // Deposit
  const depositHash = await vault.write.deposit([depositAmount, userAddress]);
  console.log("Deposit tx hash:", depositHash);
  const depositReceipt = await publicClient.waitForTransactionReceipt({ hash: depositHash });
  console.log("Deposit confirmed! Block:", depositReceipt.blockNumber);

  // Check new totalShares
  const totalSharesAfter = await vault.read.totalShares();
  console.log(`Total shares after: ${totalSharesAfter}`);

  // Check new encrypted balance
  const encryptedBalanceAfter = await vault.read.balanceOf([userAddress]);
  console.log(`Encrypted balance after: ${encryptedBalanceAfter}`);

  // Check USDC balance after
  const balanceAfter = await usdc.read.balanceOf([userAddress]);
  console.log(`USDC balance after: ${formatUnits(balanceAfter, decimals)} ${symbol}`);

  // Verify the encrypted balance matches expected shares
  const expectedShares = await vault.read.previewDeposit([depositAmount]);
  console.log(`\nExpected shares from previewDeposit: ${expectedShares}`);

  // Try to decrypt the encrypted balance
  try {
    // nox.decrypt signs EIP-712 authorization for the user
    const decrypted = await nox.decrypt(encryptedBalanceAfter, account);
    console.log(`\nDecrypted shares: ${decrypted.value}`);
    console.log(`Expected shares: ${expectedShares}`);
    if (decrypted.value === expectedShares) {
      console.log("✅ Decrypted balance matches expected shares!");
    } else {
      console.log("❌ Decrypted balance does NOT match expected shares");
    }
  } catch (e) {
    console.log("\nNote: Could not decrypt balance (requires proper Nox network setup)");
    console.log("Error:", e);
  }

  console.log("\nDone!");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});