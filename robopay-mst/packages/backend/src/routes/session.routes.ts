import type { FastifyInstance } from "fastify";
import { verifyMessage } from "ethers";
import { z } from "zod";
import { requireApiKey } from "../middleware/auth.js";
import { ERRORS } from "../utils/errors.js";
import { sessionService } from "../services/session.service.js";
import { blockchainService } from "../services/blockchain.service.js";
import { stableStringify } from "../utils/hash.js";

const orderIdParam = z.object({ orderId: z.string().min(1).max(128) });
const sessionStartBody = z.object({ orderId: z.string().min(1).max(128), robotId: z.string().min(1).max(64) });
const telemetryBody = z.object({
  robotId: z.string().min(1).max(64),
  timestamp: z.coerce.date(),
  telemetry: z.record(z.unknown()),
});
const failureBody = z.object({
  customerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
  failureType: z.enum(["ROBOT_OFFLINE", "HEARTBEAT_LOST", "MOTOR_FAILURE", "EMERGENCY_STOP", "SENSOR_FAILURE", "SESSION_INTERRUPTED", "HARDWARE_ERROR", "OTHER"]),
  description: z.string().min(1).max(2000),
  evidence: z.record(z.unknown()),
});
const robotFailureBody = z.object({
  failureType: failureBody.shape.failureType,
  description: failureBody.shape.description,
  evidence: failureBody.shape.evidence,
});

export async function sessionRoutes(app: FastifyInstance) {
  app.post("/sessions/start", { preHandler: requireApiKey("ROBOT_API_KEY") }, async (request) => {
    const body = sessionStartBody.parse(request.body);
    return { success: true, data: await sessionService.startSession(body.orderId, body.robotId) };
  });

  app.get("/sessions/:orderId", async (request) => {
    const { orderId } = orderIdParam.parse(request.params);
    return { success: true, data: await sessionService.getSessionHistory(orderId) };
  });

  app.post("/sessions/:orderId/telemetry", { preHandler: requireApiKey("ROBOT_API_KEY") }, async (request) => {
    const { orderId } = orderIdParam.parse(request.params);
    const body = telemetryBody.parse(request.body);
    return {
      success: true,
      data: await sessionService.recordTelemetry({ ...body, orderId }),
    };
  });

  app.post("/sessions/:orderId/complete", { preHandler: requireApiKey("ROBOT_API_KEY") }, async (request) => {
    const { orderId } = orderIdParam.parse(request.params);
    return { success: true, data: await sessionService.completeSession(orderId) };
  });

  app.post("/sessions/:orderId/report-failure", async (request) => {
    const { orderId } = orderIdParam.parse(request.params);
    const body = failureBody.parse(request.body);
    const rental = await blockchainService.getRental(orderId);
    if (rental.customer.toLowerCase() !== body.customerAddress.toLowerCase()) throw ERRORS.FORBIDDEN("Failure report customer does not own this rental.");
    if (!rental.active) throw ERRORS.RENTAL_NOT_ACTIVE();
    const signedReport = stableStringify({
      orderId,
      customerAddress: body.customerAddress.toLowerCase(),
      failureType: body.failureType,
      description: body.description,
      evidence: body.evidence,
    });
    let signer: string;
    try {
      signer = verifyMessage(`RoboPay failure report\n${signedReport}`, body.signature);
    } catch {
      throw ERRORS.INVALID_REQUEST("Failure report signature is invalid.");
    }
    if (signer.toLowerCase() !== rental.customer.toLowerCase()) throw ERRORS.FORBIDDEN("Failure report signature does not belong to the rental customer.");
    const result = await sessionService.reportFailure(orderId, body.customerAddress, body);
    return { success: true, data: result };
  });

  app.post("/sessions/:orderId/robot-failure", { preHandler: requireApiKey("ROBOT_API_KEY") }, async (request) => {
    const { orderId } = orderIdParam.parse(request.params);
    const body = robotFailureBody.parse(request.body);
    const result = await sessionService.failSession(orderId, body);
    return { success: true, data: { reportId: result.report.id, evidenceHash: result.report.evidenceHash, status: "VERIFIED_FAILURE" } };
  });
}