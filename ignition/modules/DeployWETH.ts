import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { AaveV3Sepolia } from "@bgd-labs/aave-address-book";

const DeployWETHModule = buildModule("DeployWETHModule", (m) => {
  const asset = m.getParameter("asset", AaveV3Sepolia.ASSETS.WETH.UNDERLYING);
  const aavePoolAddressesProvider = m.getParameter(
    "aavePoolAddressesProvider",
    AaveV3Sepolia.POOL_ADDRESSES_PROVIDER
  );

  const hydanVault = m.contract("HydanVault", [asset, aavePoolAddressesProvider], {
    id: "HydanVaultWETH",
  });

  // Set aavePool on vault using PoolAddressesProvider.getPool()
  const poolAddressesProvider = m.contractAt("IPoolAddressesProvider", aavePoolAddressesProvider);
  const poolAddress = m.call(poolAddressesProvider, "getPool", [], {
    id: "GetPool",
  });
  m.call(hydanVault, "setAavePool", [poolAddress], {
    id: "SetAavePool",
    after: [hydanVault],
  });

  // Get aToken address from ProtocolDataProvider
  const dataProvider = m.contractAt("IProtocolDataProvider", AaveV3Sepolia.AAVE_PROTOCOL_DATA_PROVIDER);
  const [aTokenAddress] = m.call(dataProvider, "getReserveTokensAddresses", [asset], {
    id: "GetAToken",
    returnIndex: 0,
  });

  // Set aToken on vault
  m.call(hydanVault, "setAToken", [aTokenAddress], {
    id: "SetAToken",
    after: [hydanVault],
  });

  return { hydanVault, aToken: aTokenAddress };
});

export default DeployWETHModule;