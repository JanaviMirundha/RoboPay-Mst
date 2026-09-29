import { prisma } from "../database.js";
import { blockchainService } from "./blockchain.service.js";
import { ERRORS } from "../utils/errors.js";
import { sha256StableBytes32, stableStringify } from "../utils/hash.js";
import { env } from "../config/env.js";
export class SessionService {
    async startSession(orderId, robotId) {
        const rental = await blockchainService.getRental(orderId);
        if (!rental.active)
            throw ERRORS.RENTAL_NOT_ACTIVE();
        if (rental.robotId !== robotId)
            throw ERRORS.INVALID_REQUEST("Robot ID does not match the on-chain rental.");
        const robot = await blockchainService.getRobot(robotId);
        if (robot.status !== 1)
            throw ERRORS.ROBOT_NOT_AVAILABLE("Robot is not IN_USE on MST Testnet.");
        const existing = await prisma.robotSession.findFirst({ where: { orderId } });
        if (existing) {
            if (["STARTING", "ACTIVE", "RUNNING"].includes(existing.status))
                return existing;
            throw ERRORS.INVALID_REQUEST("A terminal session already exists for this rental.");
        }
        return prisma.robotSession.create({
            data: { orderId, robotId, startedAt: new Date(), status: "STARTING", auditStatus: "NOT_ANCHORED" },
        });
    }
    async recordTelemetry(input) {
        const rental = await blockchainService.getRental(input.orderId);
        if (rental.robotId !== input.robotId)
            throw ERRORS.INVALID_REQUEST("Telemetry robot ID does not match the rental.");
        if (!rental.active)
            throw ERRORS.RENTAL_NOT_ACTIVE();
        const robot = await blockchainService.getRobot(input.robotId);
        if (robot.status !== 1)
            throw ERRORS.ROBOT_NOT_AVAILABLE("Robot is not IN_USE on MST Testnet.");
        const session = await prisma.robotSession.findFirst({ where: { orderId: input.orderId } });
        if (!session || !["STARTING", "ACTIVE", "RUNNING"].includes(session.status)) {
            throw ERRORS.INVALID_REQUEST("An active robot session must be started before telemetry is accepted.");
        }
        const telemetryJson = stableStringify(input.telemetry);
        const telemetryHash = sha256StableBytes32(input.telemetry);
        const saved = await prisma.robotTelemetry.create({
            data: {
                orderId: input.orderId,
                robotId: input.robotId,
                sessionId: session.id,
                timestamp: input.timestamp,
                telemetryJson,
                telemetryHash,
            },
        });
        const updatedSession = await prisma.robotSession.update({
            where: { id: session.id },
            data: { status: "ACTIVE" },
        });
        return { accepted: true, telemetryId: saved.id, telemetryHash, session: updatedSession };
    }
    async completeSession(orderId) {
        const session = await prisma.robotSession.findFirst({ where: { orderId } });
        if (!session)
            throw ERRORS.NOT_FOUND("Session not found.");
        if (!["STARTING", "ACTIVE", "RUNNING"].includes(session.status))
            throw ERRORS.INVALID_REQUEST("Session is already terminal.");
        const telemetry = await prisma.robotTelemetry.findMany({
            where: { sessionId: session.id },
            orderBy: [{ timestamp: "asc" }, { id: "asc" }],
        });
        if (telemetry.length === 0)
            throw ERRORS.DATA_UNAVAILABLE("Cannot complete a session with no robot telemetry.");
        const endedAt = new Date();
        const sessionData = {
            orderId,
            robotId: session.robotId,
            startedAt: session.startedAt?.toISOString() ?? null,
            endedAt: endedAt.toISOString(),
            telemetry: telemetry.map((record) => ({
                timestamp: record.timestamp.toISOString(),
                telemetry: JSON.parse(record.telemetryJson),
                telemetryHash: record.telemetryHash,
            })),
        };
        const sessionDataJson = stableStringify(sessionData);
        const activityHash = sha256StableBytes32(sessionData);
        return prisma.robotSession.update({
            where: { id: session.id },
            data: {
                endedAt,
                status: "COMPLETED",
                sessionDataJson,
                sessionDataHash: activityHash,
                activityHash,
                hashAnchored: false,
                auditStatus: session.auditStatus === "DEMO_SIMULATED" ? "DEMO_SIMULATED" : "NOT_ANCHORED",
            },
        });
    }
    async failSession(orderId, evidence) {
        const session = await prisma.robotSession.findFirst({ where: { orderId } });
        if (!session || !["STARTING", "ACTIVE", "RUNNING"].includes(session.status))
            throw ERRORS.RENTAL_NOT_ACTIVE();
        const rental = await blockchainService.getRental(orderId);
        if (!rental.active)
            throw ERRORS.RENTAL_NOT_ACTIVE();
        const telemetry = await prisma.robotTelemetry.findMany({
            where: { sessionId: session.id },
            orderBy: [{ timestamp: "asc" }, { id: "asc" }],
        });
        const endedAt = new Date();
        const evidenceJson = stableStringify(evidence.evidence);
        const evidenceHash = sha256StableBytes32({
            orderId,
            robotId: session.robotId,
            failureType: evidence.failureType,
            description: evidence.description,
            evidence: evidence.evidence,
        });
        const sessionData = {
            orderId,
            robotId: session.robotId,
            startedAt: session.startedAt?.toISOString() ?? null,
            endedAt: endedAt.toISOString(),
            telemetry: telemetry.map((record) => ({
                timestamp: record.timestamp.toISOString(),
                telemetry: JSON.parse(record.telemetryJson),
                telemetryHash: record.telemetryHash,
            })),
            failure: {
                failureType: evidence.failureType,
                description: evidence.description,
                evidence: JSON.parse(evidenceJson),
                evidenceHash,
            },
        };
        const sessionDataHash = sha256StableBytes32(sessionData);
        const report = await prisma.failureEvidence.create({
            data: {
                orderId,
                robotId: session.robotId,
                customerAddress: rental.customer,
                failureType: evidence.failureType,
                description: evidence.description,
                evidenceJson,
                evidenceHash,
                status: "VERIFIED_FAILURE",
            },
        });
        const failed = await prisma.robotSession.update({
            where: { id: session.id },
            data: {
                status: "FAILED",
                endedAt,
                sessionDataJson: stableStringify(sessionData),
                sessionDataHash,
                activityHash: sessionDataHash,
                hashAnchored: false,
                failureReportStatus: "VERIFIED_FAILURE",
                auditStatus: "NOT_ANCHORED",
            },
        });
        return { report, session: failed };
    }
    async reportFailure(orderId, customerAddress, evidence) {
        const rental = await blockchainService.getRental(orderId);
        if (rental.customer.toLowerCase() !== customerAddress.toLowerCase())
            throw ERRORS.FORBIDDEN("Failure report customer does not own this rental.");
        if (!rental.active)
            throw ERRORS.RENTAL_NOT_ACTIVE();
        const evidenceJson = stableStringify(evidence.evidence);
        const evidenceHash = sha256StableBytes32({ orderId, robotId: rental.robotId, ...evidence });
        const report = await prisma.failureEvidence.create({
            data: {
                orderId,
                robotId: rental.robotId,
                customerAddress: rental.customer,
                failureType: evidence.failureType,
                description: evidence.description,
                evidenceJson,
                evidenceHash,
                status: "REPORTED",
            },
        });
        return { reportId: report.id, evidenceHash: report.evidenceHash, status: report.status };
    }
    async getSession(orderId) {
        return prisma.robotSession.findFirst({ where: { orderId } });
    }
    async ensureDemoSession(rental) {
        if (!env.ROBO_PAY_DEMO_MODE || !rental.active)
            return null;
        const existing = await prisma.robotSession.findFirst({ where: { orderId: rental.orderId } });
        if (existing)
            return existing;
        return prisma.robotSession.create({
            data: {
                orderId: rental.orderId,
                robotId: rental.robotId,
                startedAt: new Date(Number(rental.startTime) * 1000),
                status: "RUNNING",
                auditStatus: "DEMO_SIMULATED",
            },
        });
    }
    async advanceDemoSession(rental) {
        if (!env.ROBO_PAY_DEMO_MODE || !rental.active)
            return null;
        const session = await this.ensureDemoSession(rental);
        if (!session || session.auditStatus !== "DEMO_SIMULATED" || !["RUNNING", "ACTIVE", "STARTING"].includes(session.status))
            return session;
        const appendSample = async (timestamp, telemetry) => {
            const telemetryJson = stableStringify(telemetry);
            const telemetryHash = sha256StableBytes32(telemetry);
            const exists = await prisma.robotTelemetry.findFirst({ where: { sessionId: session.id, telemetryHash } });
            if (exists)
                return;
            await prisma.robotTelemetry.create({
                data: {
                    orderId: rental.orderId,
                    robotId: rental.robotId,
                    sessionId: session.id,
                    timestamp,
                    telemetryJson,
                    telemetryHash,
                },
            });
        };
        const startTime = new Date(Number(rental.startTime) * 1000);
        const endTime = new Date(Number(rental.endTime) * 1000);
        await appendSample(startTime, {
            demoMode: true,
            source: "ROBO_PAY_DEMO_SIMULATION",
            rentalDataHash: rental.rentalDataHash,
            heartbeat: true,
            operationStatus: "RUNNING",
            criticalFault: false,
            emergencyStop: false,
            sample: "SESSION_START",
        });
        const now = Date.now();
        if (BigInt(Math.floor(now / 1000)) < rental.endTime) {
            const bucket = Math.floor(now / 10_000);
            await appendSample(new Date(now), {
                demoMode: true,
                source: "ROBO_PAY_DEMO_SIMULATION",
                rentalDataHash: rental.rentalDataHash,
                heartbeat: true,
                operationStatus: "RUNNING",
                criticalFault: false,
                emergencyStop: false,
                sample: `HEARTBEAT_${bucket}`,
            });
            return prisma.robotSession.update({ where: { id: session.id }, data: { status: "RUNNING" } });
        }
        await appendSample(new Date(now), {
            demoMode: true,
            source: "ROBO_PAY_DEMO_SIMULATION",
            rentalDataHash: rental.rentalDataHash,
            heartbeat: true,
            operationCompleted: true,
            operationStatus: "COMPLETED",
            criticalFault: false,
            emergencyStop: false,
            scheduledEndTime: endTime.toISOString(),
            sample: "SESSION_COMPLETED",
        });
        return this.completeSession(rental.orderId);
    }
    async getSessionHistory(orderId) {
        const session = await prisma.robotSession.findFirst({ where: { orderId } });
        if (!session)
            throw ERRORS.NOT_FOUND("Session not found.");
        const telemetry = await prisma.robotTelemetry.findMany({
            where: { sessionId: session.id },
            orderBy: [{ timestamp: "asc" }, { id: "asc" }],
        });
        return { session, telemetry };
    }
}
export const sessionService = new SessionService();
