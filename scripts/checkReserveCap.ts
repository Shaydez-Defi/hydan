import { network } from "hardhat";
import { parseAbi, formatUnits, getContract } from "viem";
import { AaveV3Sepolia } from "@bgd-labs/aave-address-book";

const POOL_ABI = parseAbi([
  "function getReserveData(address asset) external view returns (uint256 availableLiquidity, uint256 totalScaledVariableDebt, uint256 totalPrincipalStableDebt, uint256 totalLiquidity, uint256 totalATokenSupply, uint256 totalScaledATokenSupply, uint256 liquidityRate, uint256 variableBorrowRate, uint256 stableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex, uint256 lastUpdateTimestamp)",
]);

const PROTOCOL_DATA_PROVIDER_ABI = parseAbi([
  "function getReserveCaps(address asset) external view returns (uint256 borrowCap, uint256 supplyCap)",
]);

const ERC20_ABI = parseAbi([
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)",
]);

async function checkReserveCap(viem: any, assetName: string, assetAddress: string) {
  console.log(`\n=== ${assetName} (${assetAddress}) ===`);

  const pool = getContract({
    address: AaveV3Sepolia.POOL,
    abi: POOL_ABI,
    client: { public: await viem.getPublicClient() },
  });

  const dataProvider = getContract({
    address: AaveV3Sepolia.AAVE_PROTOCOL_DATA_PROVIDER,
    abi: PROTOCOL_DATA_PROVIDER_ABI,
    client: { public: await viem.getPublicClient() },
  });

  const [reserveData, [borrowCap, supplyCap]] = await Promise.all([
    pool.read.getReserveData([assetAddress]),
    dataProvider.read.getReserveCaps([assetAddress]),
  ]);

  const totalATokenSupply = reserveData[4];

  const token = getContract({
    address: assetAddress,
    abi: ERC20_ABI,
    client: { public: await viem.getPublicClient() },
  });
  const symbol = await token.read.symbol();
  const decimals = await token.read.decimals();

  const supplyCapDisplay = supplyCap === 0n ? "Unlimited (0)" : formatUnits(supplyCap, decimals);
  const aTokenSupplyDisplay = formatUnits(totalATokenSupply, decimals);

  let headroom: string;
  if (supplyCap === 0n) {
    headroom = "Unlimited";
  } else if (supplyCap <= totalATokenSupply) {
    headroom = "0 (CAPPED)";
  } else {
    headroom = formatUnits(supplyCap - totalATokenSupply, decimals);
  }

  console.log(`aToken total supply: ${aTokenSupplyDisplay} ${symbol}`);
  console.log(`Supply cap:         ${supplyCapDisplay} ${symbol}`);
  console.log(`Borrow cap:         ${borrowCap === 0n ? "Unlimited" : formatUnits(borrowCap, decimals)} ${symbol}`);
  console.log(`Headroom:           ${headroom} ${symbol}`);

  return {
    symbol,
    decimals,
    aTokenSupply: totalATokenSupply,
    supplyCap,
    borrowCap,
    headroom: supplyCap === 0n ? 0n : supplyCap - totalATokenSupply,
  };
}

async function main() {
  const { viem } = await network.create({ network: "hardhatSepolia" });

  console.log("Checking Aave V3 Sepolia reserve caps (on fork)");
  console.log("===============================================");

  const usdc = await checkReserveCap(viem, "USDC", AaveV3Sepolia.ASSETS.USDC.UNDERLYING);
  const dai = await checkReserveCap(viem, "DAI", AaveV3Sepolia.ASSETS.DAI.UNDERLYING);

  console.log("\n--- Summary ---");
  console.log(`${usdc.symbol}: ${formatUnits(usdc.aTokenSupply, usdc.decimals)} / ${usdc.supplyCap === 0n ? "∞" : formatUnits(usdc.supplyCap, usdc.decimals)} (headroom: ${usdc.headroom === 0n ? "∞" : formatUnits(usdc.headroom, usdc.decimals)})`);
  console.log(`${dai.symbol}: ${formatUnits(dai.aTokenSupply, dai.decimals)} / ${dai.supplyCap === 0n ? "∞" : formatUnits(dai.supplyCap, dai.decimals)} (headroom: ${dai.headroom === 0n ? "∞" : formatUnits(dai.headroom, dai.decimals)})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});