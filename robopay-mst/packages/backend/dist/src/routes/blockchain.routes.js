import { env } from "../config/env.js";
import { blockchainService } from "../services/blockchain.service.js";
export async function blockchainRoutes(app) {
    app.get("/blockchain/info", async () => {
        const status = await blockchainService.validateConnection();
        return { success: true, data: status };
    });
    app.get("/blockchain/status", async () => {
        const blockNumber = await blockchainService.getCurrentBlock();
        const contractBalance = await blockchainService.contractBalance();
        const owner = await blockchainService.getOwner();
        return {
            success: true,
            data: {
                chainId: env.MST_CHAIN_ID,
                contract: env.ROBO_PAY_CONTRACT_ADDRESS,
                blockNumber,
                contractBalance,
                owner,
            },
        };
    });
}
