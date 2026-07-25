import { network } from 'hardhat';
import { parseAbi, formatUnits, getContract } from 'viem';
import { AaveV3Sepolia } from '@bgd-labs/aave-address-book';

const PROTOCOL_DATA_PROVIDER_ABI = parseAbi([
  'function getReserveData(address asset) external view returns (uint256 availableLiquidity, uint256 totalScaledVariableDebt, uint256 totalPrincipalStableDebt, uint256 totalLiquidity, uint256 totalATokenSupply, uint256 totalScaledATokenSupply, uint256 liquidityRate, uint256 variableBorrowRate, uint256 stableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex, uint256 lastUpdateTimestamp)',
  'function getReserveCaps(address asset) external view returns (uint256 borrowCap, uint256 supplyCap)',
]);

const ERC20_ABI = parseAbi([
  'function symbol() external view returns (string)',
  'function decimals() external view returns (uint8)',
]);

async function checkReserveCap(viem: any, assetName: string, assetAddress: string) {
  console.log(`\n=== ${assetName} (${assetAddress}) ===`);

  const dataProvider = getContract({
    address: AaveV3Sepolia.AAVE_PROTOCOL_DATA_PROVIDER,
    abi: PROTOCOL_DATA_PROVIDER_ABI,
    client: { public: await viem.getPublicClient() },
  });

  const [reserveData, [borrowCap, supplyCap]] = await Promise.all([
    dataProvider.read.getReserveData([assetAddress]),
    dataProvider.read.getReserveCaps([assetAddress]),
  ]);

  // totalATokenSupply is at index 4 in the ProtocolDataProvider's getReserveData return
  const totalATokenSupply = reserveData[4];

  const token = getContract({
    address: assetAddress,
    abi: ERC20_ABI,
    client: { public: await viem.getPublicClient() },
  });
  const symbol = await token.read.symbol();
  const decimals = await token.read.decimals();

  const supplyCapDisplay = supplyCap === 0n ? 'Unlimited (0)' : formatUnits(supplyCap, decimals);
  const aTokenSupplyDisplay = formatUnits(totalATokenSupply, decimals);

  let headroom: string;
  if (supplyCap === 0n) {
    headroom = 'Unlimited';
  } else if (supplyCap <= totalATokenSupply) {
    headroom = '0 (CAPPED)';
  } else {
    headroom = formatUnits(supplyCap - totalATokenSupply, decimals);
  }

  console.log(`aToken total supply: ${aTokenSupplyDisplay} ${symbol}`);
  console.log(`Supply cap:         ${supplyCapDisplay} ${symbol}`);
  console.log(`Borrow cap:         ${borrowCap === 0n ? 'Unlimited' : formatUnits(borrowCap, decimals)} ${symbol}`);
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
  // Use the network passed via CLI (--network) instead of hardcoding
  const { viem } = await network.create();

  const networkName = process.env.HARDHAT_NETWORK || 'unknown';
  console.log(`Checking Aave V3 Sepolia reserve caps (network: ${networkName})`);
  console.log('===============================================');

  // Iterate over all assets in AaveV3Sepolia.ASSETS
  const assets = Object.entries(AaveV3Sepolia.ASSETS) as [string, { UNDERLYING: string }][];

  const results: any[] = [];
  for (const [assetName, assetInfo] of assets) {
    const result = await checkReserveCap(viem, assetName, assetInfo.UNDERLYING);
    results.push({ assetName, ...result });
  }

  console.log('\n--- Summary ---');
  console.log('Asset | Symbol | Total Supply | Supply Cap | Borrow Cap | Headroom');
  console.log('------|--------|--------------|------------|------------|----------');
  for (const r of results) {
    const supplyStr = r.supplyCap === 0n ? '∞' : formatUnits(r.supplyCap, r.decimals);
    const borrowStr = r.borrowCap === 0n ? '∞' : formatUnits(r.borrowCap, r.decimals);
    const hrStr = r.headroom === 0n ? (r.supplyCap === 0n ? '∞' : '0 (CAPPED)') : formatUnits(r.headroom, r.decimals);
    console.log(
      `${r.assetName.padEnd(5)} | ${r.symbol.padEnd(6)} | ${formatUnits(r.aTokenSupply, r.decimals).padStart(12)} | ${supplyStr.padStart(10)} | ${borrowStr.padStart(10)} | ${hrStr}`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
