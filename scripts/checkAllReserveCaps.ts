import { createPublicClient, http, parseAbi, formatUnits, getContract } from "viem";
import { sepolia } from "viem/chains";
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

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3, baseDelay = 1000): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      if (i === retries - 1) throw error;
      if (error?.cause?.status === 429 || error?.metaMessages?.some((m: string) => m.includes('429'))) {
        const waitTime = baseDelay * Math.pow(2, i);
        console.log(`Rate limited, waiting ${waitTime}ms before retry...`);
        await delay(waitTime);
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries reached');
}

async function checkReserveCap(publicClient: any, assetName: string, assetAddress: string) {
  console.log(`\n=== ${assetName} (${assetAddress}) ===`);

  const pool = getContract({
    address: AaveV3Sepolia.POOL,
    abi: POOL_ABI,
    client: { public: publicClient },
  });

  const dataProvider = getContract({
    address: AaveV3Sepolia.AAVE_PROTOCOL_DATA_PROVIDER,
    abi: PROTOCOL_DATA_PROVIDER_ABI,
    client: { public: publicClient },
  });

  // Use retry wrapper to handle rate limits
  const reserveData = await withRetry(() => pool.read.getReserveData([assetAddress]));
  await delay(500);
  const [borrowCap, supplyCap] = await withRetry(() => dataProvider.read.getReserveCaps([assetAddress]));
  await delay(500);

  const totalATokenSupply = reserveData[4];

  const token = getContract({
    address: assetAddress,
    abi: ERC20_ABI,
    client: { public: publicClient },
  });
  const symbol = await withRetry(() => token.read.symbol());
  await delay(300);
  const decimals = await withRetry(() => token.read.decimals());
  await delay(300);

  const supplyCapDisplay = supplyCap === 0n ? "Unlimited (0)" : formatUnits(supplyCap, decimals);
  const aTokenSupplyDisplay = formatUnits(totalATokenSupply, decimals);
  const borrowCapDisplay = borrowCap === 0n ? "Unlimited" : formatUnits(borrowCap, decimals);

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
  console.log(`Borrow cap:         ${borrowCapDisplay} ${symbol}`);
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
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  if (!rpcUrl) {
    console.error("SEPOLIA_RPC_URL environment variable not set");
    process.exit(1);
  }

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });

  console.log("Checking Aave V3 Sepolia reserve caps (live)");
  console.log("==============================================");

  const assets = Object.entries(AaveV3Sepolia.ASSETS) as [string, { UNDERLYING: string }][];

  const results: any[] = [];
  for (const [assetName, assetInfo] of assets) {
    const result = await checkReserveCap(publicClient, assetName, assetInfo.UNDERLYING);
    results.push({ assetName, ...result });
  }

  console.log("\n--- Summary ---");
  for (const r of results) {
    const capStr = r.supplyCap === 0n ? "∞" : formatUnits(r.supplyCap, r.decimals);
    const hrStr = r.headroom === 0n ? (r.supplyCap === 0n ? "∞" : "0 (CAPPED)") : formatUnits(r.headroom, r.decimals);
    console.log(`${r.symbol}: ${formatUnits(r.aTokenSupply, r.decimals)} / ${capStr} (headroom: ${hrStr})`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});