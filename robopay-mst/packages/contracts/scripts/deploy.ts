import hre from "hardhat";
import { deployAll } from "../deploy.config";
import { writeDeploymentAddresses } from "./lib/writeDeployment";

async function main() {
  const network = hre.network.name;

  if (network !== "testnet" || hre.network.config.chainId !== 91562037) {
    throw new Error("RoboPayEscrow can only be deployed to MST Testnet (chain ID 91562037).");
  }
  if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY is required in the secure deployment environment.");
  }

  console.log(`\nDeploying to ${network}...\n`);

  const results = await deployAll(hre);

  const deployed: Record<
    string,
    { address: string; abi: unknown; constructorArguments: unknown[] }
  > = {};
  for (const [name, { address, constructorArguments }] of Object.entries(results)) {
    const artifact = await hre.artifacts.readArtifact(name);
    deployed[name] = { address, abi: artifact.abi, constructorArguments };
  }

  writeDeploymentAddresses(network, deployed);

  console.log("✓ Deployed:");
  for (const [name, { address }] of Object.entries(deployed)) {
    console.log(`  ${name}: ${address}`);
  }
  console.log(`\nAddresses + ABIs written to packages/shared/src/contracts.ts`);

  console.log("\nNext: npm run verify:testnet\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
