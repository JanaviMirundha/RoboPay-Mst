import Fastify from "fastify";

import { env } from "./config/env.js";
import { registerErrorHandler } from "./middleware/error-handler.js";
import { healthRoutes } from "./routes/health.routes.js";
import { blockchainRoutes } from "./routes/blockchain.routes.js";
import { robotRoutes } from "./routes/robot.routes.js";
import { rentalRoutes } from "./routes/rental.routes.js";
import { verificationRoutes } from "./routes/verification.routes.js";
import { auditRoutes } from "./routes/audit.routes.js";
import { sessionRoutes } from "./routes/session.routes.js";
import { adminRoutes } from "./routes/admin.routes.js";

export async function buildApp() {
  const app = Fastify({ logger: true });
  registerErrorHandler(app);

  app.get("/", async () => ({ success: true, data: { service: "RoboPay backend" } }));

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

export async function startServer() {
  const app = await buildApp();
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  return app;
}
