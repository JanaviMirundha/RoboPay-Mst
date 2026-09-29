import { blockchainService } from "../services/blockchain.service.js";
export async function blockchainRoutes(app) {
    app.get("/blockchain/info", async () => {
        const status = await blockchainService.validateConnection();
        return { success: true, data: status };
    });
    app.get("/blockchain/status", async () => {
        const blockNumber = await blockchainService.getCurrentBlock();
        const contractBalance = await blockchainService.contractBalance();
        const owner = blockchainService.hasFunction("owner") ? await blockchainService.getOwner() : null;
        return {
            success: true,
            data: {
                chainId: 91562037,
                contract: blockchainService.address,
                blockNumber,
                contractBalanceWei: contractBalance,
                owner,
                capabilities: {
                    settlement: blockchainService.hasFunction("settleRental"),
                    refund: blockchainService.hasFunction("refundRental"),
                    activityAnchor: blockchainService.hasFunction("recordActivityHash"),
                    rentalEnd: blockchainService.hasFunction("endRental"),
                },
            },
        };
    });
}
