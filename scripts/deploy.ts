import { ethers } from "hardhat";
import { AaveV3Sepolia } from "@bgd-labs/aave-address-book";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH");

  const poolAddressesProvider = AaveV3Sepolia.POOL_ADDRESSES_PROVIDER;
  console.log("Aave V3 Sepolia PoolAddressesProvider:", poolAddressesProvider);

  const HydanVault = await ethers.getContractFactory("HydanVault");
  const vault = await HydanVault.deploy(poolAddressesProvider);
  await vault.waitForDeployment();

  const vaultAddress = await vault.getAddress();
  console.log("HydanVault deployed to:", vaultAddress);
  console.log("Owner:", await vault.owner());
  console.log("Aave Pool:", await vault.aavePool());
  console.log("Aave PoolAddressesProvider:", await vault.aavePoolAddressesProvider());

  console.log("\nDeployment complete!");
  console.log("Verify with:");
  console.log(`npx hardhat verify --network sepolia ${vaultAddress} ${poolAddressesProvider}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });