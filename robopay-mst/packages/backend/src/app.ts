import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { env } from "./config/env.js";
import { prisma } from "./database.js";
import { registerErrorHandler } from "./middleware/error-handler.js";
import { auditRoutes } from "./routes/audit.routes.js";
import { blockchainRoutes } from "./routes/blockchain.routes.js";
import { healthRoutes } from "./routes/health.routes.js";
import { rentalRoutes } from "./routes/rental.routes.js";
import { robotRoutes } from "./routes/robot.routes.js";
import { sessionRoutes } from "./routes/session.routes.js";
import { verificationRoutes } from "./routes/verification.routes.js";
import { adminRoutes } from "./routes/admin.routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, trustProxy: false });
  app.decorate("prisma", prisma);

  await app.register(helmet);
  await app.register(cors, {
    origin: env.FRONTEND_ORIGINS,
    credentials: true,
  });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  registerErrorHandler(app);

  app.get("/", async () => ({ success: true, data: { service: "RoboPay MST backend", network: "MST Testnet" } }));
  await app.register(healthRoutes, { prefix: "/api/v1" });
  await app.register(blockchainRoutes, { prefix: "/api/v1" });
  await app.register(robotRoutes, { prefix: "/api/v1" });
  await app.register(rentalRoutes, { prefix: "/api/v1" });
  await app.register(verificationRoutes, { prefix: "/api/v1" });
  await app.register(auditRoutes, { prefix: "/api/v1" });
  await app.register(sessionRoutes, { prefix: "/api/v1" });
  await app.register(adminRoutes, { prefix: "/api/v1" });
  return app;
}