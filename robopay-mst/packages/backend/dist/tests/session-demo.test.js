import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
    robotSession: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    robotTelemetry: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn() },
}));
vi.mock("../src/database.js", () => ({ prisma: { robotSession: mocks.robotSession, robotTelemetry: mocks.robotTelemetry } }));
vi.mock("../src/services/blockchain.service.js", () => ({ blockchainService: {} }));
import { env } from "../src/config/env.js";
import { SessionService } from "../src/services/session.service.js";
import { verifySuccessfulSession } from "../src/services/session-outcome.js";
const rental = {
    orderId: "RP-DEMO-SESSION",
    robotId: "RF-01",
    service: "Human Following",
    durationMinutes: 1,
    amountInr: 2,
    amountPaidWei: "1000000000000000",
    customer: "0x1111111111111111111111111111111111111111",
    startTime: 1800000000n,
    endTime: 1800000060n,
    status: 0,
    statusLabel: "ACTIVE",
    active: true,
    completed: false,
    refunded: false,
    rentalDataHash: `0x${"1".repeat(64)}`,
    activityHash: `0x${"0".repeat(64)}`,
    failureReasonHash: `0x${"0".repeat(64)}`,
    settledAt: 0n,
    escrowedAmountWei: "1000000000000000",
};
afterEach(() => {
    env.ROBO_PAY_DEMO_MODE = false;
    vi.clearAllMocks();
});
describe("explicit demo session initialization", () => {
    it("does not create a session unless demo mode is enabled", async () => {
        env.ROBO_PAY_DEMO_MODE = false;
        const service = new SessionService();
        await expect(service.ensureDemoSession(rental)).resolves.toBeNull();
        expect(mocks.robotSession.create).not.toHaveBeenCalled();
    });
    it("creates a visibly simulated RUNNING session anchored to the on-chain rental start", async () => {
        env.ROBO_PAY_DEMO_MODE = true;
        mocks.robotSession.findFirst.mockResolvedValue(null);
        mocks.robotSession.create.mockImplementation(async ({ data }) => data);
        const service = new SessionService();
        await expect(service.ensureDemoSession(rental)).resolves.toMatchObject({
            orderId: rental.orderId,
            robotId: rental.robotId,
            startedAt: new Date(Number(rental.startTime) * 1000),
            status: "RUNNING",
            auditStatus: "DEMO_SIMULATED",
        });
    });
    it("completes a demo session from canonical rental timing and hashes generated samples", async () => {
        env.ROBO_PAY_DEMO_MODE = true;
        const now = BigInt(Math.floor(Date.now() / 1000));
        const expiredRental = { ...rental, startTime: now - 70n, endTime: now - 10n };
        const runningSession = {
            id: "session-demo",
            orderId: expiredRental.orderId,
            robotId: expiredRental.robotId,
            startedAt: new Date(Number(expiredRental.startTime) * 1000),
            status: "RUNNING",
            auditStatus: "DEMO_SIMULATED",
        };
        const telemetryRows = [];
        mocks.robotSession.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(runningSession);
        mocks.robotSession.create.mockResolvedValue(runningSession);
        mocks.robotSession.update.mockImplementation(async ({ data }) => ({ ...runningSession, ...data }));
        mocks.robotTelemetry.findFirst.mockResolvedValue(null);
        mocks.robotTelemetry.create.mockImplementation(async ({ data }) => {
            telemetryRows.push(data);
            return data;
        });
        mocks.robotTelemetry.findMany.mockImplementation(async () => telemetryRows);
        const service = new SessionService();
        const completed = await service.advanceDemoSession(expiredRental);
        expect(completed).toMatchObject({ status: "COMPLETED", auditStatus: "DEMO_SIMULATED" });
        expect(telemetryRows).toHaveLength(2);
        expect(verifySuccessfulSession({
            session: completed,
            telemetry: telemetryRows,
            rentalStartTime: expiredRental.startTime,
            rentalEndTime: expiredRental.endTime,
            now: BigInt(Math.floor(Date.now() / 1000)),
            hasVerifiedFailure: false,
        })).toBe(true);
    });
});
