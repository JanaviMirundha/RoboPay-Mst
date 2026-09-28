import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { rentalService } from "../services/rental.service.js";
import { transactionService } from "../services/transaction.service.js";
import { ERRORS } from "../utils/errors.js";

const rentalIdParam = z.object({ orderId: z.string().min(1) });
const customerParam = z.object({ address: z.string().regex(/^0x[a-fA-F0-9]{40}$/) });
const verifyTxBody = z.object({
  orderId: z.string().min(1),
  transactionHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  customerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

export async function rentalRoutes(app: FastifyInstance) {
  app.get("/rentals", async () => {
    const rentals = await rentalService.syncAllKnownRentals();
    return { success: true, data: rentals };
  });

  app.get("/rentals/:orderId", async (request) => {
    const { orderId } = rentalIdParam.parse(request.params);
    const rental = await rentalService.getRentalFromBlockchain(orderId);
    return { success: true, data: rental };
  });

  app.get("/rentals/:orderId/blockchain", async (request) => {
    const { orderId } = rentalIdParam.parse(request.params);
    const rental = await rentalService.getRentalFromBlockchain(orderId);
    return { success: true, data: rental };
  });

  app.get("/rentals/customer/:address", async (request) => {
    const { address } = customerParam.parse(request.params);
    return { success: true, data: { address } };
  });

  app.post("/rentals/verify-transaction", async (request, reply) => {
    const body = verifyTxBody.parse(request.body);
    const receipt = await transactionService.getReceipt(body.transactionHash);
    if (receipt.status !== 1) throw ERRORS.TRANSACTION_FAILED();

    const decoded = await transactionService.decodeRentalCreated(body.transactionHash);
    const orderId = decoded[0]?.toString();
    const robotId = decoded[1]?.toString();
    const customer = decoded[2]?.toString();

    if (body.orderId !== orderId) throw ERRORS.INVALID_ORDER("Order mismatch");
    if (body.customerAddress.toLowerCase() !== customer.toLowerCase()) throw ERRORS.INVALID_ADDRESS("Customer mismatch");

    return {
      success: true,
      data: {
        verified: true,
        orderId,
        transactionHash: body.transactionHash,
        robotId,
        customer,
        status: "ACTIVE",
      },
    };
  });
}
