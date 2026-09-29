import type { FastifyInstance } from "fastify";
import { z } from "zod";

const orderIdParam = z.object({ orderId: z.string().min(1).max(128) });

export async function auditRoutes(app: FastifyInstance) {
  app.get("/audit/:orderId", async (request) => {
    const { orderId } = orderIdParam.parse(request.params);
    const { auditService } = await import("../services/audit.service.js");
    return { success: true, data: await auditService.getAudit(orderId) };
  });

  app.get("/audit/:orderId/history", async (request) => {
    const { orderId } = orderIdParam.parse(request.params);
    const { auditService } = await import("../services/audit.service.js");
    return { success: true, data: await auditService.getAuditHistory(orderId) };
  });
}