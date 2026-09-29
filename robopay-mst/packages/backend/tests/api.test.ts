import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { blockchainService } from "../src/services/blockchain.service.js";
import { prisma } from "../src/database.js";
import { healthRoutes } from "../src/routes/health.routes.js";
import { blockchainRoutes } from "../src/routes/blockchain.routes.js";
import { robotRoutes } from "../src/routes/robot.routes.js";
import { rentalRoutes } from "../src/routes/rental.routes.js";
import { verificationRoutes } from "../src/routes/verification.routes.js";
import { adminRoutes } from "../src/routes/admin.routes.js";
import { registerErrorHandler } from "../src/middleware/error-handler.js";
import { env } from "../src/config/env.js";

const ACTIVE_ADDRESS = env.ROBO_PAY_CONTRACT_ADDRESS;
const TEST_RENTAL = {
  orderId: "RP-TEST-API",
  robotId: "RF-01",
  service: "Human Following",
  durationMinutes: 1,
  amountInr: 2,
  amountPaidWei: "1000000000000000",
  customer: "0x1111111111111111111111111111111111111111",
  startTime: 1_790_640_000n,
  endTime: 1_790_640_600n,
  status: 0,
  statusLabel: "ACTIVE" as const,
  active: true,
  completed: false,
  refunded: false,
  rentalDataHash: `0x${"1".repeat(64)}`,
  activityHash: `0x${"0".repeat(64)}`,
  failureReasonHash: `0x${"0".repeat(64)}`,
  settledAt: 0n,
  escrowedAmountWei: "1000000000000000",
};

async function createTestApp() {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(healthRoutes, { prefix: "/api/v1" });
  await app.register(blockchainRoutes, { prefix: "/api/v1" });
  await app.register(robotRoutes, { prefix: "/api/v1" });
  await app.register(rentalRoutes, { prefix: "/api/v1" });
  await app.register(verificationRoutes, { prefix: "/api/v1" });
  await app.register(adminRoutes, { prefix: "/api/v1" });
  return app;
}

afterEach(() => vi.restoreAllMocks());

describe("RoboPay API routes", () => {
  it("returns a healthy response when MST and SQLite are available", async () => {
    vi.spyOn(blockchainService, "getCurrentBlock").mockResolvedValue(12345);
    vi.spyOn(blockchainService, "validateConnection").mockResolvedValue({
      network: "MST Testnet",
      chainId: 91562037,
      contract: ACTIVE_ADDRESS,
      owner: "0xa2f79Ec629674fFbC1814F93a89BfF06aDe01661",
      operatorAuthorized: false,
      capabilities: { settlement: true, refund: true, activityAnchor: true, rentalEnd: false },
    });
    vi.spyOn(prisma, "$queryRaw").mockResolvedValue([{ result: 1 }]);
    const app = await createTestApp();
    const response = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ success: true, data: { status: "healthy", chainId: 91562037, contract: ACTIVE_ADDRESS } });
    await app.close();
  });

  it("lists registered robots from blockchain state rather than static fixtures", async () => {
    vi.spyOn(blockchainService, "getRobotIds").mockResolvedValue(["RF-01"]);
    vi.spyOn(blockchainService, "getRobot").mockResolvedValue({
      robotId: "RF-01", name: "RoboFollow", service: "Human Following", robotOwner: "0xa2f79Ec629674fFbC1814F93a89BfF06aDe01661", status: 1, registered: true,
    });
    vi.spyOn(blockchainService, "getCurrentBlock").mockResolvedValue(12345);
    vi.spyOn(prisma.robotSnapshot, "upsert").mockResolvedValue({} as never);
    const app = await createTestApp();
    const response = await app.inject({ method: "GET", url: "/api/v1/robots" });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject([{ robotId: "RF-01", status: 1, statusLabel: "IN_USE" }]);
    await app.close();
  });

  it("returns active rental timing by matching on-chain robot and rental state", async () => {
    vi.spyOn(blockchainService, "getRobot").mockResolvedValue({
      robotId: "RF-01", name: "RoboFollow", service: "Human Following", robotOwner: "0xa2f79Ec629674fFbC1814F93a89BfF06aDe01661", status: 1, registered: true,
    });
    vi.spyOn(blockchainService, "getRentalOrderIds").mockResolvedValue([TEST_RENTAL.orderId]);
    vi.spyOn(blockchainService, "getRental").mockResolvedValue(TEST_RENTAL);
    const app = await createTestApp();
    const response = await app.inject({ method: "GET", url: "/api/v1/robots/RF-01/active-rental" });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      robotId: "RF-01",
      active: true,
      rental: { orderId: TEST_RENTAL.orderId, startTime: TEST_RENTAL.startTime.toString(), endTime: TEST_RENTAL.endTime.toString(), paymentStatus: "ESCROWED" },
    });
    await app.close();
  });

  it("returns INCONSISTENT_BLOCKCHAIN_STATE when IN_USE has no matching active rental", async () => {
    vi.spyOn(blockchainService, "getRobot").mockResolvedValue({
      robotId: "RF-01", name: "RoboFollow", service: "Human Following", robotOwner: "0xa2f79Ec629674fFbC1814F93a89BfF06aDe01661", status: 1, registered: true,
    });
    vi.spyOn(blockchainService, "getRentalOrderIds").mockResolvedValue([]);
    const app = await createTestApp();
    const response = await app.inject({ method: "GET", url: "/api/v1/robots/RF-01/active-rental" });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("INCONSISTENT_BLOCKCHAIN_STATE");
    await app.close();
  });

  it("returns on-chain active rental timing for an IN_USE robot", async () => {
    vi.spyOn(blockchainService, "getRobot").mockResolvedValue({
      robotId: "RF-01", name: "RoboFollow", service: "Human Following", robotOwner: "0xa2f79Ec629674fFbC1814F93a89BfF06aDe01661", status: 1, registered: true,
    });
    vi.spyOn(blockchainService, "getRentalOrderIds").mockResolvedValue([TEST_RENTAL.orderId]);
    vi.spyOn(blockchainService, "getRental").mockResolvedValue(TEST_RENTAL);
    const app = await createTestApp();
    const response = await app.inject({ method: "GET", url: "/api/v1/robots/RF-01/active-rental" });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      robotId: "RF-01",
      active: true,
      rental: { orderId: TEST_RENTAL.orderId, startTime: TEST_RENTAL.startTime.toString(), endTime: TEST_RENTAL.endTime.toString(), paymentStatus: "ESCROWED" },
    });
    await app.close();
  });

  it("reports inconsistent chain state instead of inventing timing for an IN_USE robot", async () => {
    vi.spyOn(blockchainService, "getRobot").mockResolvedValue({
      robotId: "RF-01", name: "RoboFollow", service: "Human Following", robotOwner: "0xa2f79Ec629674fFbC1814F93a89BfF06aDe01661", status: 1, registered: true,
    });
    vi.spyOn(blockchainService, "getRentalOrderIds").mockResolvedValue([]);
    const app = await createTestApp();
    const response = await app.inject({ method: "GET", url: "/api/v1/robots/RF-01/active-rental" });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("INCONSISTENT_BLOCKCHAIN_STATE");
    await app.close();
  });

  it("reads a canonical rental and reports escrow status from on-chain amount", async () => {
    vi.spyOn(blockchainService, "orderExists").mockResolvedValue(true);
    vi.spyOn(blockchainService, "getRental").mockResolvedValue(TEST_RENTAL);
    vi.spyOn(blockchainService, "getCurrentBlock").mockResolvedValue(12345);
    vi.spyOn(prisma.rentalSnapshot, "upsert").mockResolvedValue({} as never);
    const app = await createTestApp();
    const response = await app.inject({ method: "GET", url: "/api/v1/rentals/RP-TEST-API" });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ orderId: "RP-TEST-API", status: "ACTIVE", paymentStatus: "ESCROWED", escrowedAmountWei: TEST_RENTAL.amountPaidWei });
    await app.close();
  });

  it("rejects invalid addresses and missing rental records with stable error codes", async () => {
    const app = await createTestApp();
    const addressResponse = await app.inject({ method: "GET", url: "/api/v1/rentals/customer/not-an-address" });
    expect(addressResponse.statusCode).toBe(400);
    expect(addressResponse.json().error.code).toBe("INVALID_ADDRESS");
    vi.spyOn(blockchainService, "getRental").mockRejectedValue(new Error("Rental does not exist"));
    const rentalResponse = await app.inject({ method: "GET", url: "/api/v1/rentals/unknown" });
    expect(rentalResponse.statusCode).toBe(404);
    expect(rentalResponse.json().error.code).toBe("RENTAL_NOT_FOUND");
    await app.close();
  });

  it("blocks operator requests without an admin API key", async () => {
    const previousKey = env.ADMIN_API_KEY;
    env.ADMIN_API_KEY = "test-admin-key";
    const app = await createTestApp();
    const response = await app.inject({ method: "GET", url: "/api/v1/admin/overview" });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHORIZED");
    await app.close();
    env.ADMIN_API_KEY = previousKey;
  });
});
