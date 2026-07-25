import { network } from "hardhat";
import { parseAbi, formatUnits, getContract, parseUnits } from "viem";
import { AaveV3Sepolia } from "@bgd-labs/aave-address-book";
import * as fs from "fs";
import * as path from "path";

const VAULT_ADDRESS = getDeployedVaultAddress() as `0x${string}`;

function getDeployedVaultAddress(): string {
  const deploymentsDir = path.join(process.cwd(), "ignition/deployments");
  const chains = fs.readdirSync(deploymentsDir);
  
  for (const chain of chains) {
    const deployedAddressesPath = path.join(deploymentsDir, chain, "deployed_addresses.json");
    if (fs.existsSync(deployedAddressesPath)) {
      const data = JSON.parse(fs.readFileSync(deployedAddressesPath, "utf8"));
      if (data["DeployModule#HydanVault"]) {
        return data["DeployModule#HydanVault"];
      }
    }
  }
  
  // Fallback to hardcoded if not found
  return "0x35DFa22be33993419362367635F9Ff397E8B2D1d";
}

const VAULT_ABI = parseAbi([
  "function deposit(uint256 assets, address receiver) external returns (euint256 shares)",
  "function previewDeposit(uint256 assets) external view returns (uint256)",
  "function totalShares() external view returns (uint256)",
  "function balanceOf(address account) external view returns (euint256)",
  "function totalAssets() external view returns (uint256)",
]);

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
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

  const usdc = getContract({
    address: usdcAddress,
    abi: parseAbi([
      "function approve(address spender, uint256 amount) external returns (bool)",
      "function balanceOf(address account) external view returns (uint256)",
      "function decimals() external view returns (uint8)",
      "function symbol() external view returns (string)",
      "function allowance(address owner, address spender) external view returns (uint256)",
    ]),
    client: { public: publicClient, wallet: account },
  });

  const vault = getContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    client: { public: publicClient, wallet: account },
  });

  const symbol = await usdc.read.symbol();
  const decimals = await usdc.read.decimals();
  console.log(`Token: ${symbol} (${decimals} decimals)`);

  // Deposit amount: 10 USDC (6 decimals)
  const amount = 10n * 10n ** BigInt(decimals);
  console.log(`Depositing: ${formatUnits(amount, decimals)} ${symbol}`);

  // Preview expected shares
  const expectedShares = await vault.read.previewDeposit([amount]);
  console.log(`Expected shares (from previewDeposit): ${expectedShares}`);

  // Check current allowance
  const allowance = await usdc.read.allowance([userAddress, VAULT_ADDRESS]);
  console.log(`Current allowance: ${formatUnits(allowance, decimals)} ${symbol}`);

  if (allowance < amount) {
    console.log("Approving vault to spend USDC...");
    const approveHash = await usdc.write.approve([VAULT_ADDRESS, amount]);
    console.log("Approve tx hash:", approveHash);
    const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log("Approved! Block:", approveReceipt.blockNumber);
  } else {
    console.log("Allowance already sufficient");
  }

  // Deposit via vault
  console.log("Calling deposit() on vault...");
  const depositHash = await vault.write.deposit([usdcAddress, amount, userAddress]);
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
    console.log(`Decrypted share balance: ${decrypted}`);
    console.log(`Expected shares (from previewDeposit): ${expectedShares}`);
    console.log(`Match: ${decrypted === expectedShares ? "YES" : "NO"}`);
  } catch (decryptError) {
    console.error("Decryption failed:", decryptError);
    console.log("Note: Decryption requires NoxCompute with wrapAsPublicHandle support (live network)");
  }

  // Also verify totalShares was updated
  const totalSharesAfter = await vault.read.totalShares();
  console.log(`Total shares after deposit: ${totalSharesAfter}`);

  console.log("Done!");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});