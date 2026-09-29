import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const sharedContractsPath = [
    path.resolve(process.cwd(), "../shared/src/contracts.js"),
    path.resolve(process.cwd(), "packages/shared/src/contracts.js"),
].find(existsSync);
if (!sharedContractsPath) {
    throw new Error("Cannot locate generated packages/shared/src/contracts.js deployment metadata.");
}
const requireFromHere = createRequire(import.meta.url);
const { deployments } = requireFromHere(sharedContractsPath);
const selectedDeployment = deployments.testnet?.RoboPayEscrow;
if (!selectedDeployment) {
    throw new Error("The generated testnet deployment metadata does not contain RoboPayEscrow.");
}
const activeDeployment = selectedDeployment;
export { deployments, activeDeployment };
