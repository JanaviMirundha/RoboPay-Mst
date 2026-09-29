import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
    prisma: {
        robotSession: { findFirst: vi.fn(), update: vi.fn() },
        robotTelemetry: { findMany: vi.fn() },
        failureEvidence: { findMany: vi.fn() },
        activityAudit: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    },
    blockchain: { getRentalOrderIds: vi.fn(), getRental: vi.fn() },
    rental: { syncRental: vi.fn() },
    audit: { reconcilePendingOperatorTransaction: vi.fn(), anchorActivityHash: vi.fn(), settleRental: vi.fn(), refundRental: vi.fn() },
    sessionService: { advanceDemoSession: vi.fn() },
    determineSessionOutcome: vi.fn(),
    verifyFailureEvidence: vi.fn(),
}));
vi.mock("../src/database.js", () => ({ prisma: mocks.prisma }));
vi.mock("../src/services/blockchain.service.js", () => ({ blockchainService: mocks.blockchain }));
vi.mock("../src/services/rental.service.js", () => ({ rentalService: mocks.rental }));
vi.mock("../src/services/audit.service.js", () => ({ auditService: mocks.audit }));
vi.mock("../src/services/session.service.js", () => ({ sessionService: mocks.sessionService }));
vi.mock("../src/services/session-outcome.js", () => ({
    determineSessionOutcome: mocks.determineSessionOutcome,
    verifyFailureEvidence: mocks.verifyFailureEvidence,
}));
import { runExpiryCheck } from "../src/jobs/rental-expiry.job.js";
const rental = {
    orderId: "RP-EXPIRY-TEST",
    robotId: "RF-01",
    customer: "0x1111111111111111111111111111111111111111",
    startTime: 1n,
    endTime: 2n,
    active: true,
    activityHash: `0x${"0".repeat(64)}`,
};
const session = { id: "session-1", status: "COMPLETED" };
beforeEach(() => {
    vi.clearAllMocks();
    mocks.blockchain.getRentalOrderIds.mockResolvedValue([rental.orderId]);
    mocks.blockchain.getRental.mockResolvedValue(rental);
    mocks.rental.syncRental.mockResolvedValue({});
    mocks.audit.reconcilePendingOperatorTransaction.mockResolvedValue(false);
    mocks.audit.anchorActivityHash.mockResolvedValue({});
    mocks.audit.settleRental.mockResolvedValue({});
    mocks.audit.refundRental.mockResolvedValue({});
    mocks.sessionService.advanceDemoSession.mockResolvedValue(session);
    mocks.prisma.robotSession.findFirst.mockResolvedValue(session);
    mocks.prisma.robotSession.update.mockResolvedValue({ ...session, status: "SUCCESS" });
    mocks.prisma.robotTelemetry.findMany.mockResolvedValue([{ timestamp: new Date(), telemetryJson: "{}", telemetryHash: "0x01" }]);
    mocks.prisma.failureEvidence.findMany.mockResolvedValue([]);
    mocks.prisma.activityAudit.findFirst.mockResolvedValue(null);
    mocks.prisma.activityAudit.create.mockResolvedValue({ id: "audit-1" });
    mocks.prisma.activityAudit.update.mockResolvedValue({ id: "audit-1" });
    mocks.determineSessionOutcome.mockReturnValue("UNKNOWN");
    mocks.verifyFailureEvidence.mockReturnValue(false);
});
describe("rental expiry finalization", () => {
    it("anchors and settles only a verified SUCCESS after expiry", async () => {
        mocks.determineSessionOutcome.mockReturnValue("SUCCESS");
        await runExpiryCheck(() => undefined);
        expect(mocks.audit.anchorActivityHash).toHaveBeenCalledWith(rental.orderId);
        expect(mocks.audit.settleRental).toHaveBeenCalledWith(rental.orderId);
        expect(mocks.audit.refundRental).not.toHaveBeenCalled();
        expect(mocks.prisma.robotSession.update).toHaveBeenCalledWith({
            where: { id: session.id },
            data: { status: "SUCCESS" },
        });
    });
    it("anchors and refunds only a hash-verified FAILURE record", async () => {
        const evidence = { id: "failure-1", orderId: rental.orderId, robotId: rental.robotId, customerAddress: rental.customer, status: "VERIFIED_FAILURE" };
        mocks.determineSessionOutcome.mockReturnValue("FAILURE");
        mocks.blockchain.getRental.mockResolvedValue({ ...rental, endTime: BigInt(Math.floor(Date.now() / 1000) + 600) });
        mocks.prisma.robotSession.findFirst.mockResolvedValue({ ...session, status: "FAILED" });
        mocks.prisma.failureEvidence.findMany.mockResolvedValue([evidence]);
        mocks.verifyFailureEvidence.mockReturnValue(true);
        await runExpiryCheck(() => undefined);
        expect(mocks.audit.anchorActivityHash).toHaveBeenCalledWith(rental.orderId);
        expect(mocks.audit.refundRental).toHaveBeenCalledWith(rental.orderId, evidence.id);
        expect(mocks.audit.settleRental).not.toHaveBeenCalled();
    });
    it("leaves UNKNOWN rentals escrowed and active without settlement or refund", async () => {
        await runExpiryCheck(() => undefined);
        expect(mocks.audit.anchorActivityHash).not.toHaveBeenCalled();
        expect(mocks.audit.settleRental).not.toHaveBeenCalled();
        expect(mocks.audit.refundRental).not.toHaveBeenCalled();
        expect(mocks.prisma.activityAudit.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ eventType: "OUTCOME_REVIEW_REQUIRED", status: "DATA_UNAVAILABLE" }),
        }));
        expect(mocks.sessionService.advanceDemoSession).toHaveBeenCalledWith(rental);
    });
});
