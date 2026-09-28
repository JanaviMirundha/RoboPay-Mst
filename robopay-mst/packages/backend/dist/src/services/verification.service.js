import { ethers } from "ethers";
import { blockchainService } from "./blockchain.service.js";
import { sha256Hex } from "../utils/hash.js";
export class VerificationService {
    async verifyActivity(orderId) {
        const rental = await blockchainService.getRental(orderId);
        const session = await (await import("./session.service.js")).sessionService.getSession(orderId);
        if (!session?.sessionDataJson) {
            return { verified: false, computedHash: null, onChainHash: rental.activityHash, orderId, transactionHash: session?.anchorTxHash ?? null };
        }
        const computedHash = sha256Hex(session.sessionDataJson);
        const verified = computedHash.toLowerCase() === rental.activityHash.toLowerCase();
        return {
            verified,
            computedHash,
            onChainHash: rental.activityHash,
            orderId,
            transactionHash: session.anchorTxHash,
        };
    }
    async verifyRental(orderId) {
        const rental = await blockchainService.getRental(orderId);
        const computed = ethers.solidityPacked(["string", "string", "string", "uint256", "uint256", "address", "uint256", "uint256"], [
            orderId,
            rental.robotId,
            rental.service,
            rental.durationMinutes,
            rental.amountInr,
            rental.customer,
            Number(rental.startTime),
            Number(rental.endTime),
        ]);
        const computedHash = ethers.keccak256(ethers.toUtf8Bytes(computed));
        const verified = computedHash.toLowerCase() === rental.rentalDataHash.toLowerCase();
        return {
            verified,
            computedHash,
            onChainHash: rental.rentalDataHash,
            orderId,
        };
    }
}
export const verificationService = new VerificationService();
