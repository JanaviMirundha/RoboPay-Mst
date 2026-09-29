import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { verificationService } from "../services/verification.service.js";

const orderIdParam = z.object({ orderId: z.string().min(1) });

export async function verificationRoutes(app: FastifyInstance) {
  app.get("/verify/rental/:orderId", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request) => {
    const { orderId } = orderIdParam.parse(request.params);
    const result = await verificationService.verifyRental(orderId);
    return { success: true, data: result };
  });

  app.get("/verify/activity/:orderId", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request) => {
    const { orderId } = orderIdParam.parse(request.params);
    const result = await verificationService.verifyActivity(orderId);
    return { success: true, data: result };
  });
}
