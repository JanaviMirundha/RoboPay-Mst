import { ethers } from "ethers";
import { blockchainService } from "./blockchain.service.js";
export class RentalService {
    async getRentalFromBlockchain(orderId) {
        const data = await blockchainService.getRental(orderId);
        return {
            ...data,
            status: data.completed ? "COMPLETED" : data.active ? "ACTIVE" : "UNKNOWN",
        };
    }
    async syncRental(orderId) {
        return this.getRentalFromBlockchain(orderId);
    }
    async syncAllKnownRentals() {
        const orderIds = await blockchainService.getRentalOrderIds();
        return Promise.all(orderIds.map((id) => this.getRentalFromBlockchain(id)));
    }
    async verifyRental(orderId) {
        const rental = await blockchainService.getRental(orderId);
        const computedHash = ethers.solidityPacked(["string", "string", "string", "uint256", "uint256", "address", "uint256", "uint256"], [
            orderId,
            rental.robotId,
            rental.service,
            rental.durationMinutes,
            rental.amountInr,
            rental.customer,
            Number(rental.startTime),
            Number(rental.endTime),
        ]);
        const digest = ethers.keccak256(ethers.toUtf8Bytes(computedHash));
        return {
            orderId,
            computedHash: digest,
            onChainHash: rental.rentalDataHash,
            verified: digest.toLowerCase() === rental.rentalDataHash.toLowerCase(),
        };
    }
}
export const rentalService = new RentalService();
