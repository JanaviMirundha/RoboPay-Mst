import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
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
import { blockchainService } from "./services/blockchain.service.js";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function start() {
    const app = Fastify({ logger: true });
    await app.register(helmet);
    await app.register(cors, {
        origin: env.FRONTEND_ORIGIN ? [env.FRONTEND_ORIGIN] : true,
        credentials: true,
    });
    await app.register(rateLimit, {
        max: 100,
        timeWindow: "1 minute",
    });
    registerErrorHandler(app);
    app.get("/", async () => ({ success: true, data: { service: "RoboPay backend" } }));
    app.decorate("prisma", prisma);
    app.register(healthRoutes, { prefix: "/api/v1" });
    app.register(blockchainRoutes, { prefix: "/api/v1" });
    app.register(robotRoutes, { prefix: "/api/v1" });
    app.register(rentalRoutes, { prefix: "/api/v1" });
    app.register(verificationRoutes, { prefix: "/api/v1" });
    app.register(auditRoutes, { prefix: "/api/v1" });
    app.register(sessionRoutes, { prefix: "/api/v1" });
    app.register(adminRoutes, { prefix: "/api/v1" });
    try {
        await blockchainService.validateConnection();
        await prisma.$connect();
        app.log.info("Backend initialized");
    }
    catch (error) {
        app.log.error(error, "Initialization failed");
    }
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
}
start().catch((error) => {
    console.error(error);
    process.exit(1);
});
