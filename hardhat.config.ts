import hardhatToolboxViemPlugin from '@nomicfoundation/hardhat-toolbox-viem';
import noxPlugin from '@iexec-nox/nox-hardhat-plugin';
import { defineConfig, configVariable } from 'hardhat/config';

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin, noxPlugin],
  solidity: {
    profiles: {
      default: {
        version: '0.8.35',
        settings: {
          viaIR: true,
          optimizer: { enabled: true, runs: 200 },
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: 'edr-simulated',
      chainType: 'l1',
    },
    hardhatOp: {
      type: 'edr-simulated',
      chainType: 'op',
    },
    hardhatSepolia: {
      type: 'edr-simulated',
      chainType: 'l1',
      forking: {
        url: configVariable('SEPOLIA_RPC_URL'),
      },
    },
    sepolia: {
      type: 'http',
      chainType: 'l1',
      url: configVariable('SEPOLIA_RPC_URL'),
      accounts: [configVariable('SEPOLIA_PRIVATE_KEY')],
    },
  },
  ignition: {
    requiredConfirmations: 2,
  },
});
