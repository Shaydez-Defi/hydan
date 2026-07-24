import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { AaveV3Sepolia } from "@bgd-labs/aave-address-book";

const DeployModule = buildModule("DeployModule", (m) => {
  const aavePoolAddressesProvider = m.getParameter(
    "aavePoolAddressesProvider",
    AaveV3Sepolia.POOL_ADDRESSES_PROVIDER
  );

  const hydanVault = m.contract("HydanVault", [aavePoolAddressesProvider], {
    id: "HydanVault",
  });

  const aavePool = m.call(hydanVault, "aavePool", [], {
    id: "AavePool",
  });

  return { hydanVault, aavePool };
});

export default DeployModule;