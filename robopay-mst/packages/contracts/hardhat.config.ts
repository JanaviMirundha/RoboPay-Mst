import "@nomicfoundation/hardhat-toolbox";
import { HardhatUserConfig } from "hardhat/config";
import * as dotenv from "dotenv";

dotenv.config({ path: "../../.env.local" });

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const accounts = PRIVATE_KEY ? [PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },

  networks: {
    testnet: {
      url: "https://testnetrpc.mstblockchain.com",
      chainId: 91562037,
      accounts,
    },
  },

  etherscan: {
    apiKey: {
      testnet: process.env.MSTSCAN_API_KEY || "",
    },

    customChains: [
      {
        network: "testnet",
        chainId: 91562037,
        urls: {
          apiURL: "https://testnet.mstscan.com/api",
          browserURL: "https://testnet.mstscan.com",
        },
      },

    ],
  },
};

export default config;