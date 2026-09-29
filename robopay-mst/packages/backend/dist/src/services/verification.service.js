import { prisma } from "../database.js";
import { blockchainService } from "./blockchain.service.js";
import { rentalService } from "./rental.service.js";
import { sha256StableBytes32 } from "../utils/hash.js";
export class VerificationService {
    async verifyActivity(orderId) {
        if (!(await blockchainService.orderExists(orderId)))
            throw (await import("../utils/errors.js")).ERRORS.RENTAL_NOT_FOUND();
        const rental = await blockchainService.getRental(orderId);
        const zeroHash = /^0x0{64}$/i;
        if (zeroHash.test(rental.activityHash)) {
            return { orderId, status: "NOT_ANCHORED", verified: false, computedHash: null, onChainHash: rental.activityHash };
        }
        const session = await prisma.robotSession.findFirst({ where: { orderId } });
        if (!session?.sessionDataJson) {
            return { orderId, status: "DATA_UNAVAILABLE", verified: false, computedHash: null, onChainHash: rental.activityHash, transactionHash: session?.anchorTxHash ?? null };
        }
        const computedHash = sha256StableBytes32(JSON.parse(session.sessionDataJson));
        const matches = computedHash.toLowerCase() === rental.activityHash.toLowerCase();
        const status = matches ? "VERIFIED" : "HASH_MISMATCH";
        await prisma.verificationRecord.create({
            data: { orderId, verificationType: "ACTIVITY", computedHash, storedHash: rental.activityHash, verified: matches, transactionHash: session.anchorTxHash },
        });
        await prisma.robotSession.update({ where: { id: session.id }, data: { auditStatus: status } });
        return { orderId, status, verified: matches, computedHash, onChainHash: rental.activityHash, transactionHash: session.anchorTxHash };
    }
    async verifyRental(orderId) {
        const result = await rentalService.verifyRental(orderId);
        const activity = await this.verifyActivity(orderId);
        return {
            ...result,
            activityHash: result.activityHash,
            activityStatus: activity.status,
            paymentStatus: result.paymentStatus,
        };
    }
}
export const verificationService = new VerificationService();
