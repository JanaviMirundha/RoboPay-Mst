import { blockchainService } from "../services/blockchain.service.js";
import { prisma } from "../database.js";
export async function healthRoutes(app) {
    app.get("/health", async () => {
        let database = "connected";
        let blockchain = "connected";
        let blockNumber = null;
        try {
            blockNumber = await blockchainService.getCurrentBlock();
            await blockchainService.validateConnection();
        }
        catch {
            blockchain = "unavailable";
        }
        try {
            await prisma.$queryRaw `SELECT 1`;
        }
        catch {
            database = "unavailable";
        }
        const healthy = database === "connected" && blockchain === "connected";
        return {
            success: healthy,
            data: {
                status: healthy ? "healthy" : "degraded",
                network: "MST Testnet",
                chainId: 91562037,
                contract: blockchainService.address,
                database,
                blockchain,
                blockNumber,
            },
        };
    });
}
