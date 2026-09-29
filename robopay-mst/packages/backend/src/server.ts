import { buildApp } from "./app.js";
import { pathToFileURL } from "node:url";
import { env } from "./config/env.js";
import { prisma } from "./database.js";
import { startBlockchainSyncJob } from "./jobs/blockchain-sync.job.js";
import { startExpiryJob } from "./jobs/rental-expiry.job.js";
import { blockchainService } from "./services/blockchain.service.js";

export async function startServer() {
  const app = await buildApp();
  const network = await blockchainService.validateConnection();
  if (network.chainId !== 91562037) throw new Error("Backend refuses to start outside MST Testnet.");
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  app.log.info({ network: "MST Testnet", chainId: 91562037, contract: blockchainService.address }, "Backend dependencies validated");
  if (!network.operatorAuthorized) {
    app.log.warn({ owner: network.owner }, "Read-only mode: operator signer is absent or unauthorized; privileged transactions will be unavailable.");
  }

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  const stopBlockchainSync = await startBlockchainSyncJob((message, error) => app.log.error({ err: error }, message));
  const stopExpiryJob = await startExpiryJob((message, error) => app.log.error({ err: error }, message));

  let closing: Promise<void> | undefined;
  const close = () => {
    if (!closing) {
      stopBlockchainSync();
      stopExpiryJob();
      closing = Promise.all([app.close(), prisma.$disconnect()]).then(() => undefined);
    }
    return closing;
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
  return { app, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch((error: unknown) => {
    console.error("RoboPay backend startup failed:", error instanceof Error ? error.message : "Unknown startup error");
    process.exitCode = 1;
  });
}