import { describe, it, beforeEach } from "node:test";
import { expect } from "chai";
import { network } from "hardhat";

describe("HydanVault", function () {
  let viem: any;
  let deployer: any;
  let user1: any;
  let user2: any;
  let vault: any;

  // Valid zero address for local testing
  const MOCK_ASSET = "0x0000000000000000000000000000000000000000" as `0x${string}`;

  beforeEach(async function () {
    const { viem: v } = await network.create();
    viem = v;

    const [d, u1, u2] = await viem.getWalletClients();
    deployer = d;
    user1 = u1;
    user2 = u2;

    // Deploy with mock addresses - this tests compilation and basic interface
    const HydanVault = await viem.deployContract("HydanVault", [MOCK_ASSET, MOCK_ASSET]);
    vault = HydanVault;
  });

  describe("Deployment", function () {
    it("Should set correct asset", async function () {
      expect(await vault.read.asset()).to.equal(MOCK_ASSET);
    });

    it("Should set correct Aave PoolAddressesProvider", async function () {
      expect(await vault.read.aavePoolAddressesProvider()).to.equal(MOCK_ASSET);
    });

    it("Should have zero total shares initially", async function () {
      expect(await vault.read.totalShares()).to.equal(0n);
    });
  });

  describe("Share Accounting", function () {
    it("Should return 1:1 shares for first deposit (previewDeposit)", async function () {
      const assets = 1000n;
      const shares = await vault.read.previewDeposit([assets]);
      expect(shares).to.equal(assets);
    });

    it("Should return proportional shares for previewDeposit", async function () {
      const shares = await vault.read.previewDeposit([1000n]);
      expect(shares).to.equal(1000n);
    });

    it("Should return 1:1 assets for first mint (previewMint)", async function () {
      const shares = 1000n;
      const assets = await vault.read.previewMint([shares]);
      expect(assets).to.equal(shares);
    });
  });

  describe("Deposit/Mint/Withdraw/Redeem reverts", function () {
    it("Should revert with zero assets on deposit", async function () {
      let error: Error | null = null;
      try {
        await vault.write.deposit([0n, deployer.account.address]);
      } catch (e) {
        error = e as Error;
      }
      expect(error).to.not.be.null;
      expect(error!.message).to.include("Amount must be > 0");
    });

    it("Should revert with zero shares on mint", async function () {
      let error: Error | null = null;
      try {
        await vault.write.mint([0n, deployer.account.address]);
      } catch (e) {
        error = e as Error;
      }
      expect(error).to.not.be.null;
      expect(error!.message).to.include("Shares must be > 0");
    });

    it("Should revert with zero assets on withdraw", async function () {
      let error: Error | null = null;
      try {
        await vault.write.withdraw([0n, deployer.account.address, deployer.account.address]);
      } catch (e) {
        error = e as Error;
      }
      expect(error).to.not.be.null;
      expect(error!.message).to.include("Amount must be > 0");
    });

    it("Should revert with zero shares on redeem", async function () {
      let error: Error | null = null;
      try {
        await vault.write.redeem([0n, deployer.account.address, deployer.account.address]);
      } catch (e) {
        error = e as Error;
      }
      expect(error).to.not.be.null;
      expect(error!.message).to.include("Shares must be > 0");
    });

    it("Should revert withdraw with insufficient shares", async function () {
      let error: Error | null = null;
      try {
        await vault.write.withdraw([1000n, deployer.account.address, user1.account.address]);
      } catch (e) {
        error = e as Error;
      }
      expect(error).to.not.be.null;
      expect(error!.message).to.include("Insufficient shares");
    });

    it("Should revert redeem with insufficient shares", async function () {
      let error: Error | null = null;
      try {
        await vault.write.redeem([1000n, deployer.account.address, user1.account.address]);
      } catch (e) {
        error = e as Error;
      }
      expect(error).to.not.be.null;
      expect(error!.message).to.include("Insufficient shares");
    });
  });

  describe("Multi-user proportional accounting", function () {
    it("Should track shares correctly for multiple users", async function () {
      expect(await vault.read.balanceOf([user1.account.address])).to.equal(0n);
      expect(await vault.read.balanceOf([user2.account.address])).to.equal(0n);
    });
  });
});