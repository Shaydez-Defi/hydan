import { network } from "hardhat";
import { parseAbi, formatUnits, getContract } from "viem";
import { AaveV3Sepolia } from "@bgd-labs/aave-address-book";

const POOL_CONFIGURATOR_ABI = parseAbi([
  "function getReserveConfiguration(address asset) external view returns (uint256 ltv, uint256 liquidationThreshold, uint256 liquidationBonus, uint256 reserveFactor, uint256 usageAsCollateralEnabled, uint256 borrowingEnabled, uint256 stableBorrowRateEnabled, uint256 isActive, uint256 isFrozen, uint256 supplyCap, uint256 borrowCap)",
  "function setSupplyCap(address asset, uint256 supplyCap) external",
]);

const ERC20_ABI = parseAbi([
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)",
]);

async function main() {
  const { viem, networkHelpers } = await network.create({ network: "hardhatSepolia" });

  console.log("Raising Aave V3 Sepolia supply caps on fork");
  console.log("============================================");

  const aclAdmin = AaveV3Sepolia.ACL_ADMIN;
  const publicClient = await viem.getPublicClient();

  // Impersonate ACL_ADMIN (owner of PoolConfigurator)
  await networkHelpers.impersonateAccount(aclAdmin);
  await networkHelpers.setBalance(aclAdmin, 100n * 10n ** 18n);
  const adminClient = await viem.getWalletClient(aclAdmin);

  const configurator = getContract({
    address: AaveV3Sepolia.POOL_CONFIGURATOR,
    abi: POOL_CONFIGURATOR_ABI,
    client: { public: publicClient, wallet: adminClient },
  });

  const assets = [
    { name: "USDC", address: AaveV3Sepolia.ASSETS.USDC.UNDERLYING, newCap: 100_000_000n * 10n ** 6n },
    { name: "DAI", address: AaveV3Sepolia.ASSETS.DAI.UNDERLYING, newCap: 100_000_000n * 10n ** 18n },
  ];

  for (const asset of assets) {
    console.log(`\n--- ${asset.name} ---`);
    console.log(`Asset: ${asset.address}`);

    // Check current cap
    const config = await configurator.read.getReserveConfiguration([asset.address]);
    const currentCap = config[10];

    const token = getContract({
      address: asset.address,
      abi: ERC20_ABI,
      client: { public: publicClient },
    });
    const symbol = await token.read.symbol();
    const decimals = await token.read.decimals();

    console.log(`Current supply cap: ${currentCap === 0n ? "Unlimited" : formatUnits(currentCap, decimals)} ${symbol}`);
    console.log(`Setting new cap:    ${formatUnits(asset.newCap, decimals)} ${symbol}`);

    if (currentCap !== 0n && currentCap >= asset.newCap) {
      console.log("Already at or above target cap, skipping");
      continue;
    }

    const hash = await configurator.write.setSupplyCap([asset.address, asset.newCap]);
    console.log(`Tx hash: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`Confirmed! Block: ${receipt.blockNumber}`);
  }

  await networkHelpers.stopImpersonatingAccount(aclAdmin);
  console.log("\nDone!");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});