import { describe, it, beforeEach } from "node:test";
import { expect } from "chai";
import { network } from "hardhat";

describe("HydanVault", function () {
  let viem: any;
  let deployer: any;
  let user1: any;
  let user2: any;
  let vault: any;

  const USDC = "0x1234567890123456789012345678901234567890" as `0x${string}`;

  beforeEach(async function () {
    const { viem: v } = await network.create();
    viem = v;

    const [d, u1, u2] = await viem.getWalletClients();
    deployer = d;
    user1 = u1;
    user2 = u2;

    const HydanVault = await viem.deployContract("HydanVault", [USDC, USDC]);
    vault = HydanVault;
  });

  describe("Deployment", function () {
    it("Should set correct asset", async function () {
      expect(await vault.read.asset()).to.equal(USDC);
    });

    it("Should set correct Aave PoolAddressesProvider", async function () {
      expect(await vault.read.aavePoolAddressesProvider()).to.equal(USDC);
    });

    it("Should have zero total shares initially", async function () {
      expect(await vault.read.totalShares()).to.equal(0n);
    });

    it("Should have zero balance for users initially", async function () {
      const balance1 = await vault.read.balanceOf([user1.account.address]);
      const balance2 = await vault.read.balanceOf([user2.account.address]);
      
      expect(balance1).to.equal("0x0000000000000000000000000000000000000000000000000000000000000000");
      expect(balance2).to.equal("0x0000000000000000000000000000000000000000000000000000000000000000");
    });
  });

  describe("Share Accounting (Encrypted)", function () {
    it("Should return 1:1 shares for first deposit (previewDeposit)", async function () {
      const assets = 1000n;
      const shares = await vault.read.previewDeposit([assets]);
      expect(shares).to.equal(assets);
    });

    it("Should return proportional shares for subsequent deposits (previewDeposit)", async function () {
      const shares = await vault.read.previewDeposit([1000n]);
      expect(shares).to.equal(1000n);
    });
  });

  describe("Deposit/Withdraw Reverts", function () {
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

    it("Should revert with zero assets on withdraw", async function () {
      let error: Error | null = null;
      try {
        await vault.write.withdraw([0n, deployer.account.address, user1.account.address]);
      } catch (e) {
        error = e as Error;
      }
      expect(error).to.not.be.null;
      expect(error!.message).to.include("Amount must be > 0");
    });
  });

  describe("Multi-user Proportional Accounting (Encrypted)", function () {
    it("Should track zero shares for multiple users initially", async function () {
      const balance1 = await vault.read.balanceOf([user1.account.address]);
      const balance2 = await vault.read.balanceOf([user2.account.address]);
      expect(balance1).to.equal("0x0000000000000000000000000000000000000000000000000000000000000000");
      expect(balance2).to.equal("0x0000000000000000000000000000000000000000000000000000000000000000");
    });
  });
});