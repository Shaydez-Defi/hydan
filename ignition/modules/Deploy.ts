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

  // Set aavePool on vault using PoolAddressesProvider.getPool()
  const poolFromProvider = m.call(
    m.contractAt("IPoolAddressesProvider", aavePoolAddressesProvider),
    "getPool",
    [],
    { id: "GetPool" }
  );
  m.call(hydanVault, "setAavePool", [poolFromProvider], {
    id: "SetAavePool",
    after: [hydanVault],
  });

  // Get aToken address from ProtocolDataProvider
  const dataProvider = m.contractAt("IProtocolDataProvider", AaveV3Sepolia.AAVE_PROTOCOL_DATA_PROVIDER);
  const [aTokenAddress] = m.call(dataProvider, "getReserveTokensAddresses", [asset], {
    id: "ATokenAddress",
  });

  // Set aToken on vault
  m.call(hydanVault, "setAToken", [aTokenAddress], {
    id: "SetAToken",
    after: [hydanVault],
  });

  return { hydanVault, aToken: aTokenAddress };
});

export default DeployModule;