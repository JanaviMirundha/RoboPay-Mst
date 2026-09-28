import { z } from "zod";
const orderIdParam = z.object({ orderId: z.string().min(1) });
export async function auditRoutes(app) {
    app.get("/audit/:orderId", async (request) => {
        const { orderId } = orderIdParam.parse(request.params);
        return {
            success: true,
            data: {
                orderId,
                events: [],
                summary: { totalEvents: 0, anchoredEvents: 0 },
            },
        };
    });
    app.get("/audit/:orderId/history", async (request) => {
        const { orderId } = orderIdParam.parse(request.params);
        return {
            success: true,
            data: {
                orderId,
                history: [],
            },
        };
    });
}
