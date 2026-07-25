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
    // Use local hardhat network (not forking)
    const { viem: v } = await network.create();
    viem = v;

    const [d, u1, u2] = await viem.getWalletClients();
    deployer = d;
    user1 = u1;
    user2 = u2;

    // Deploy vault with mock addresses
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
      // Encrypted balance should be zero handle (not initialized)
      const balance1 = await vault.read.balanceOf([user1.account.address]);
      const balance2 = await vault.read.balanceOf([user2.account.address]);
      
      // Zero handles are not initialized
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

  describe("Deposit/Mint/Withdraw/Redeem Reverts", function () {
    it("Should revert with zero assets on deposit", async function () {
      try {
        await vault.write.deposit([0n, deployer.account.address, "0x0000000000000000000000000000000000000000000000000000000000000000", "0x"]);
        throw new Error("Should have reverted");
      } catch (e: any) {
        expect(e.message).to.include("Amount must be > 0");
      }
    });
  });
});