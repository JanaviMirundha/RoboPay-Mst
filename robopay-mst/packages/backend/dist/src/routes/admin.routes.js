import { z } from "zod";
import { requireApiKey, requireOwnerWalletValidation } from "../middleware/auth.js";
import { blockchainService } from "../services/blockchain.service.js";
import { auditService } from "../services/audit.service.js";
import { rentalService } from "../services/rental.service.js";
const orderIdParam = z.object({ orderId: z.string().min(1).max(128) });
const evidenceIdParam = z.object({ evidenceId: z.string().min(1) });
export async function adminRoutes(app) {
    app.addHook("preHandler", requireApiKey("ADMIN_API_KEY"));
    app.addHook("preHandler", requireOwnerWalletValidation);
    app.get("/admin/overview", async () => {
        const [robots, rentals, blockNumber, contractBalance] = await Promise.all([
            Promise.all((await blockchainService.getRobotIds()).map((robotId) => blockchainService.getRobot(robotId))),
            rentalService.syncKnownRentals(),
            blockchainService.getCurrentBlock(),
            blockchainService.contractBalance(),
        ]);
        return {
            success: true,
            data: {
                totalRobots: robots.length,
                availableRobots: robots.filter((robot) => robot.status === 0).length,
                robotsInUse: robots.filter((robot) => robot.status === 1).length,
                activeRentals: rentals.filter((rental) => rental.statusLabel === "ACTIVE").length,
                completedRentals: rentals.filter((rental) => rental.statusLabel === "COMPLETED").length,
                refundedRentals: rentals.filter((rental) => rental.statusLabel === "REFUNDED").length,
                totalRentals: rentals.length,
                contractAddress: blockchainService.address,
                contractBalanceWei: contractBalance,
                chainId: 91562037,
                latestBlock: blockNumber,
            },
        };
    });
    app.post("/admin/audit/:orderId/anchor", async (request) => {
        const { orderId } = orderIdParam.parse(request.params);
        return { success: true, data: await auditService.anchorActivityHash(orderId) };
    });
    app.post("/admin/failure-evidence/:evidenceId/review", async (request) => {
        const { evidenceId } = evidenceIdParam.parse(request.params);
        const body = z.object({ status: z.enum(["INVESTIGATING", "VERIFIED_FAILURE", "REJECTED"]) }).parse(request.body);
        return { success: true, data: await auditService.reviewFailureEvidence(evidenceId, body.status) };
    });
    app.post("/admin/rentals/:orderId/settle", async (request) => {
        const { orderId } = orderIdParam.parse(request.params);
        return { success: true, data: await auditService.settleRental(orderId) };
    });
    app.post("/admin/rentals/:orderId/refund", async (request) => {
        const { orderId } = orderIdParam.parse(request.params);
        const body = z.object({ evidenceId: z.string().min(1) }).parse(request.body);
        return { success: true, data: await auditService.refundRental(orderId, body.evidenceId) };
    });
}
