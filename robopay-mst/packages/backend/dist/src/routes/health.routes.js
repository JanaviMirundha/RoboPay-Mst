import { env } from "../config/env.js";
import { blockchainService } from "../services/blockchain.service.js";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
export async function healthRoutes(app) {
    app.get("/health", async () => {
        try {
            const block = await blockchainService.getCurrentBlock();
            const network = await blockchainService.validateConnection();
            await prisma.$queryRaw `SELECT 1`;
            return {
                success: true,
                data: {
                    status: "healthy",
                    network: "MST Testnet",
                    chainId: env.MST_CHAIN_ID,
                    contract: env.ROBO_PAY_CONTRACT_ADDRESS,
                    database: "connected",
                    blockchain: "connected",
                    blockNumber: block,
                },
            };
        }
        catch (error) {
            return {
                success: false,
                data: {
                    status: "degraded",
                    network: "MST Testnet",
                    chainId: env.MST_CHAIN_ID,
                    contract: env.ROBO_PAY_CONTRACT_ADDRESS,
                    database: "unavailable",
                    blockchain: "unavailable",
                },
            };
        }
    });
}
