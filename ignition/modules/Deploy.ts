import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { AaveV3Sepolia } from "@bgd-labs/aave-address-book";

const DeployModule = buildModule("DeployModule", (m) => {
  const asset = m.getParameter("asset", AaveV3Sepolia.ASSETS.USDC.UNDERLYING);
  const aavePoolAddressesProvider = m.getParameter(
    "aavePoolAddressesProvider",
    AaveV3Sepolia.POOL_ADDRESSES_PROVIDER
  );

  const hydanVault = m.contract("HydanVault", [asset, aavePoolAddressesProvider], {
    id: "HydanVault",
  });

  // Get pool address from PoolAddressesProvider.getPool() (view function)
  const poolAddressesProvider = m.contractAt("IPoolAddressesProvider", aavePoolAddressesProvider);
  const poolAddress = m.staticCall(poolAddressesProvider, "getPool", [], 0, {
    id: "GetPool",
  });
  m.call(hydanVault, "setAavePool", [poolAddress], {
    id: "SetAavePool",
    after: [hydanVault],
  });

  // Get aToken address from ProtocolDataProvider.getReserveTokensAddresses() (view function, returns tuple)
  const dataProvider = m.contractAt("IProtocolDataProvider", AaveV3Sepolia.AAVE_PROTOCOL_DATA_PROVIDER);
  const aTokenAddress = m.staticCall(dataProvider, "getReserveTokensAddresses", [asset], 0, {
    id: "GetAToken",
  });
  m.call(hydanVault, "setAToken", [aTokenAddress], {
    id: "SetAToken",
    after: [hydanVault],
  });

  return { hydanVault, aToken: aTokenAddress };
});

export default DeployModule;