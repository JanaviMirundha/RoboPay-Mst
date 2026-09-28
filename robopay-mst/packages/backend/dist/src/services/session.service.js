import { PrismaClient } from "@prisma/client";
import { blockchainService } from "./blockchain.service.js";
import { ERRORS } from "../utils/errors.js";
import { sha256Hex } from "../utils/hash.js";
const prisma = new PrismaClient();
export class SessionService {
    async startSession(orderId, robotId) {
        const rental = await blockchainService.getRental(orderId);
        if (!rental)
            throw ERRORS.RENTAL_NOT_FOUND();
        if (!rental.active)
            throw ERRORS.RENTAL_NOT_ACTIVE();
        if (rental.robotId !== robotId)
            throw ERRORS.INVALID_REQUEST("Robot mismatch for order");
        let session = await prisma.robotSession.findFirst({ where: { orderId } });
        if (!session) {
            session = await prisma.robotSession.create({
                data: {
                    orderId,
                    robotId,
                    startedAt: new Date(Number(rental.startTime) * 1000),
                    status: "ACTIVE",
                    sessionDataJson: JSON.stringify({ orderId, robotId, startedAt: new Date(Number(rental.startTime) * 1000).toISOString() }),
                },
            });
        }
        return session;
    }
    async recordTelemetry(orderId, telemetry) {
        const rental = await blockchainService.getRental(orderId);
        if (!rental)
            throw ERRORS.RENTAL_NOT_FOUND();
        const payload = { orderId, robotId: rental.robotId, ...telemetry };
        const telemetryHash = sha256Hex(JSON.stringify(payload));
        const saved = await prisma.robotTelemetry.create({
            data: {
                robotId: rental.robotId,
                orderId,
                timestamp: new Date(),
                telemetryJson: JSON.stringify(payload),
                telemetryHash,
            },
        });
        return { telemetryHash, saved };
    }
    async getSession(orderId) {
        return prisma.robotSession.findFirst({ where: { orderId } });
    }
    async getSessionTelemetry(orderId) {
        return prisma.robotTelemetry.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } });
    }
    async completeSession(orderId) {
        const session = await prisma.robotSession.findFirst({ where: { orderId } });
        if (!session)
            throw ERRORS.NOT_FOUND("Session not found");
        return prisma.robotSession.update({
            where: { id: session.id },
            data: {
                endedAt: new Date(),
                status: "COMPLETED",
            },
        });
    }
}
export const sessionService = new SessionService();
