import { expect } from "chai";
import { ethers } from "hardhat";
import { AaveV3Sepolia } from "@bgd-labs/aave-address-book";

describe("HydanVault", function () {
  let vault: any;
  let deployer: any;

  beforeEach(async function () {
    [deployer] = await ethers.getSigners();

    const HydanVault = await ethers.getContractFactory("HydanVault");
    vault = await HydanVault.deploy(AaveV3Sepolia.POOL_ADDRESSES_PROVIDER);
    await vault.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set correct owner", async function () {
      expect(await vault.owner()).to.equal(deployer.address);
    });

    it("Should set correct Aave PoolAddressesProvider", async function () {
      expect(await vault.aavePoolAddressesProvider()).to.equal(AaveV3Sepolia.POOL_ADDRESSES_PROVIDER);
    });

    it("Should resolve correct Aave Pool address", async function () {
      const pool = await vault.aavePool();
      expect(pool).to.equal(AaveV3Sepolia.POOL);
      expect(pool).to.not.equal(ethers.ZeroAddress);
    });
  });

  describe("Deposit", function () {
    it("Should revert with zero amount", async function () {
      await expect(vault.deposit(ethers.ZeroAddress, 0, 0)).to.be.revertedWithCustomError(vault, "AmountMustBeGreaterThanZero");
    });
  });

  describe("Withdraw", function () {
    it("Should revert with zero amount", async function () {
      await expect(vault.withdraw(ethers.ZeroAddress, 0)).to.be.revertedWithCustomError(vault, "AmountMustBeGreaterThanZero");
    });
  });

  describe("Emergency Withdraw", function () {
    it("Should revert when called by non-owner", async function () {
      const [, nonOwner] = await ethers.getSigners();
      await expect(vault.connect(nonOwner).emergencyWithdraw(ethers.ZeroAddress, nonOwner.address, 1))
        .to.be.revertedWithCustomError(vault, "NotOwner");
    });
  });
});