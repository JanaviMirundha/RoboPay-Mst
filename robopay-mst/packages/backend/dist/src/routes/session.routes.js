import { z } from "zod";
import { sessionService } from "../services/session.service.js";
const startSessionBody = z.object({
    orderId: z.string().min(1),
    robotId: z.string().min(1),
});
const telemetryBody = z.object({
    orderId: z.string().min(1),
    telemetry: z.record(z.any()),
});
const orderIdParam = z.object({ orderId: z.string().min(1) });
export async function sessionRoutes(app) {
    app.post("/sessions/start", async (request) => {
        const body = startSessionBody.parse(request.body);
        const value = await sessionService.startSession(body.orderId, body.robotId);
        return { success: true, data: value };
    });
    app.get("/sessions/:orderId", async (request) => {
        const { orderId } = orderIdParam.parse(request.params);
        const session = await sessionService.getSession(orderId);
        return { success: true, data: session };
    });
    app.post("/sessions/:orderId/telemetry", async (request) => {
        const { orderId } = orderIdParam.parse(request.params);
        const body = telemetryBody.parse(request.body);
        const result = await sessionService.recordTelemetry(body.orderId, body.telemetry);
        return { success: true, data: result };
    });
    app.post("/sessions/:orderId/complete", async (request) => {
        const { orderId } = orderIdParam.parse(request.params);
        const session = await sessionService.completeSession(orderId);
        return { success: true, data: session };
    });
}
