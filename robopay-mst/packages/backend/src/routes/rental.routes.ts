import type { FastifyInstance } from "fastify";
import { verifyMessage } from "ethers";
import { z } from "zod";

import { rentalService } from "../services/rental.service.js";
import { transactionService } from "../services/transaction.service.js";
import { sessionService } from "../services/session.service.js";
import { auditService } from "../services/audit.service.js";
import { stableStringify } from "../utils/hash.js";
import { normalizeAddress } from "../utils/addresses.js";
import { ERRORS } from "../utils/errors.js";

const rentalIdParam = z.object({ orderId: z.string().min(1) });
const customerParam = z.object({ address: z.string() });
const verifyTxBody = z.object({
  orderId: z.string().min(1),
  transactionHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  customerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});
const failureReportBody = z.object({
  customerAddress: z.string(),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
  failureType: z.enum(["ROBOT_OFFLINE", "HEARTBEAT_LOST", "MOTOR_FAILURE", "EMERGENCY_STOP", "SENSOR_FAILURE", "SESSION_INTERRUPTED", "HARDWARE_ERROR", "OTHER"]),
  description: z.string().min(1).max(2000),
  evidence: z.record(z.unknown()),
});

export async function rentalRoutes(app: FastifyInstance) {
  app.get("/rentals", async () => {
    const rentals = await rentalService.syncKnownRentals();
    return { success: true, data: rentals };
  });

  app.get("/rentals/:orderId", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request) => {
    const { orderId } = rentalIdParam.parse(request.params);
    const result = await rentalService.syncRental(orderId);
    return { success: true, data: result.rental };
  });

  app.get("/rentals/active", async () => ({ success: true, data: await rentalService.getActiveRentals() }));

  app.get("/rentals/history", async () => ({ success: true, data: await rentalService.syncKnownRentals() }));

  app.get("/rentals/customer/:address/history", async (request) => {
    const { address } = customerParam.parse(request.params);
    return { success: true, data: await rentalService.getCustomerRentals(address) };
  });

  app.get("/rentals/refunded", async () => ({ success: true, data: await rentalService.getRefundedRentals() }));

  app.get("/rentals/completed", async () => ({ success: true, data: await rentalService.getCompletedRentals() }));

  app.get("/rentals/:orderId/blockchain", async (request) => {
    const { orderId } = rentalIdParam.parse(request.params);
    const rental = await rentalService.getRental(orderId);
    return { success: true, data: rental };
  });

  app.get("/rentals/:orderId/outcome", async (request) => {
    const { orderId } = rentalIdParam.parse(request.params);
    return { success: true, data: await auditService.getFinalizationStatus(orderId) };
  });

  app.get("/rentals/customer/:address", async (request) => {
    const { address } = customerParam.parse(request.params);
    return { success: true, data: await rentalService.getCustomerRentals(normalizeAddress(address)) };
  });

  app.post("/rentals/verify-transaction", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = verifyTxBody.parse(request.body);
    body.customerAddress = normalizeAddress(body.customerAddress);
    const verified = await transactionService.verifyRentalTransaction(body);
    return reply.send({ success: true, data: verified });
  });

  app.post("/rentals/:orderId/report-failure", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request) => {
    const { orderId } = rentalIdParam.parse(request.params);
    const body = failureReportBody.parse(request.body);
    const customerAddress = normalizeAddress(body.customerAddress);
    const rental = await rentalService.getRental(orderId);
    if (!rental.active || rental.customer.toLowerCase() !== customerAddress.toLowerCase()) {
      throw ERRORS.FORBIDDEN("Only the active rental customer can submit a failure report.");
    }
    const signedPayload = stableStringify({
      orderId,
      customerAddress: customerAddress.toLowerCase(),
      failureType: body.failureType,
      description: body.description,
      evidence: body.evidence,
    });
    let signer: string;
    try {
      signer = verifyMessage(`RoboPay failure report\n${signedPayload}`, body.signature);
    } catch {
      throw ERRORS.INVALID_REQUEST("Failure report signature is invalid.");
    }
    if (signer.toLowerCase() !== customerAddress.toLowerCase()) throw ERRORS.FORBIDDEN("Failure report signature does not match the rental customer.");
    const result = await sessionService.reportFailure(orderId, customerAddress, body);
    return { success: true, data: result };
  });
}
