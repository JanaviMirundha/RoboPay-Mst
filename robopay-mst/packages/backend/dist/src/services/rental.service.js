import { getAddress } from "ethers";
import { prisma } from "../database.js";
import { blockchainService } from "./blockchain.service.js";
import { computeRentalDataHash } from "../utils/hash.js";
import { ERRORS } from "../utils/errors.js";
function paymentStatus(rental) {
    if (rental.status === 1)
        return "SETTLED";
    if (rental.status === 2)
        return "REFUNDED";
    if (rental.status === 0 && rental.escrowedAmountWei === rental.amountPaidWei)
        return "ESCROWED";
    return "UNKNOWN";
}
export function serializeRental(rental) {
    return {
        ...rental,
        status: rental.statusLabel,
        statusCode: rental.status,
        customer: getAddress(rental.customer),
        paymentStatus: paymentStatus(rental),
        startTime: rental.startTime.toString(),
        endTime: rental.endTime.toString(),
        settledAt: rental.settledAt.toString(),
    };
}
export class RentalService {
    async getRental(orderId) {
        if (!(await blockchainService.orderExists(orderId)))
            throw ERRORS.RENTAL_NOT_FOUND();
        return blockchainService.getRental(orderId);
    }
    async syncRental(orderId, creationTxHash) {
        const rental = await this.getRental(orderId);
        const lastSyncedBlock = await blockchainService.getCurrentBlock();
        const snapshot = await prisma.rentalSnapshot.upsert({
            where: { orderId },
            update: {
                robotId: rental.robotId,
                customerAddress: getAddress(rental.customer),
                service: rental.service,
                durationMinutes: rental.durationMinutes,
                amountInr: rental.amountInr,
                amountPaidWei: rental.amountPaidWei,
                startTime: rental.startTime,
                endTime: rental.endTime,
                active: rental.active,
                completed: rental.completed,
                status: rental.statusLabel,
                paymentStatus: paymentStatus(rental),
                rentalDataHash: rental.rentalDataHash,
                activityHash: rental.activityHash,
                failureReasonHash: rental.failureReasonHash,
                settledAt: rental.settledAt,
                ...(creationTxHash ? { creationTxHash } : {}),
                lastSyncedBlock,
            },
            create: {
                orderId,
                robotId: rental.robotId,
                customerAddress: getAddress(rental.customer),
                service: rental.service,
                durationMinutes: rental.durationMinutes,
                amountInr: rental.amountInr,
                amountPaidWei: rental.amountPaidWei,
                startTime: rental.startTime,
                endTime: rental.endTime,
                active: rental.active,
                completed: rental.completed,
                status: rental.statusLabel,
                paymentStatus: paymentStatus(rental),
                rentalDataHash: rental.rentalDataHash,
                activityHash: rental.activityHash,
                failureReasonHash: rental.failureReasonHash,
                settledAt: rental.settledAt,
                creationTxHash: creationTxHash ?? null,
                lastSyncedBlock,
            },
        });
        return { rental: serializeRental(rental), snapshot };
    }
    async verifyRental(orderId) {
        const rental = await this.getRental(orderId);
        const computedRentalDataHash = computeRentalDataHash({
            orderId: rental.orderId,
            robotId: rental.robotId,
            service: rental.service,
            durationMinutes: rental.durationMinutes,
            amountInr: rental.amountInr,
            customer: rental.customer,
            startTime: rental.startTime,
            endTime: rental.endTime,
        });
        const contractHashValid = await blockchainService.verifyRentalDataHash(orderId, computedRentalDataHash);
        const rentalDataVerified = contractHashValid && computedRentalDataHash.toLowerCase() === rental.rentalDataHash.toLowerCase();
        await prisma.verificationRecord.create({
            data: {
                orderId,
                verificationType: "RENTAL_DATA",
                computedHash: computedRentalDataHash,
                storedHash: rental.rentalDataHash,
                verified: rentalDataVerified,
            },
        });
        return {
            rental: serializeRental(rental),
            ...serializeRental(rental),
            computedRentalDataHash,
            rentalDataVerified,
            transactionLinks: await prisma.rentalSnapshot.findUnique({
                where: { orderId },
                select: { creationTxHash: true, settlementTxHash: true, refundTxHash: true },
            }).then((snapshot) => ({
                creation: snapshot?.creationTxHash ?? null,
                settlement: snapshot?.settlementTxHash ?? null,
                refund: snapshot?.refundTxHash ?? null,
            })),
        };
    }
    async syncKnownRentals() {
        const orderIds = await blockchainService.getRentalOrderIds();
        return Promise.all(orderIds.map(async (orderId) => (await this.syncRental(orderId)).rental));
    }
    async getCustomerRentals(address) {
        const normalized = getAddress(address).toLowerCase();
        return (await this.syncKnownRentals()).filter((rental) => rental.customer.toLowerCase() === normalized);
    }
    async getActiveRentals() {
        return (await this.syncKnownRentals()).filter((rental) => rental.statusLabel === "ACTIVE");
    }
    async getCompletedRentals() {
        return (await this.syncKnownRentals()).filter((rental) => rental.statusLabel === "COMPLETED");
    }
    async getRefundedRentals() {
        return (await this.syncKnownRentals()).filter((rental) => rental.statusLabel === "REFUNDED");
    }
}
export const rentalService = new RentalService();
