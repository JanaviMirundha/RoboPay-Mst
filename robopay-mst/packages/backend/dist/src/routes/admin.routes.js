import { z } from "zod";
import { env } from "../config/env.js";
import { blockchainService } from "../services/blockchain.service.js";
import { robotService } from "../services/robot.service.js";
const robotIdParam = z.object({ robotId: z.string().min(1) });
const orderIdParam = z.object({ orderId: z.string().min(1) });
export async function adminRoutes(app) {
    app.addHook("preHandler", async (request, reply) => {
        const isAdmin = request.headers["x-admin-key"] === env.ADMIN_API_KEY;
        if (!isAdmin) {
            reply.code(401).send({ success: false, error: { code: "UNAUTHORIZED", message: "Admin API key required." } });
            return;
        }
    });
    app.get("/admin/overview", async () => {
        const robots = await robotService.listRobots();
        const activeRentals = 0;
        const end = {
            success: true,
            data: {
                totalRobots: robots.length,
                availableRobots: robots.filter((r) => r.status === 0).length,
                robotsInUse: robots.filter((r) => r.status === 1).length,
                activeRentals,
                completedRentals: 0,
                totalRentals: 0,
                totalAuditedSessions: 0,
                verifiedAudits: 0,
                contractAddress: env.ROBO_PAY_CONTRACT_ADDRESS,
                chainId: env.MST_CHAIN_ID,
                latestBlock: await blockchainService.getCurrentBlock(),
            },
        };
        return end;
    });
    app.post("/admin/robots/:robotId/status", async (request) => {
        const { robotId } = robotIdParam.parse(request.params);
        return { success: true, data: { robotId, status: "AVAILABLE" } };
    });
    app.post("/admin/audit/:orderId/anchor", async (request) => {
        const { orderId } = orderIdParam.parse(request.params);
        return { success: true, data: { orderId, anchored: false } };
    });
    app.post("/admin/rentals/:orderId/complete", async (request) => {
        const { orderId } = orderIdParam.parse(request.params);
        return { success: true, data: { orderId, completed: false } };
    });
}
