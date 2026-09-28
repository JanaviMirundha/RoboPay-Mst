import { z } from "zod";
import { verificationService } from "../services/verification.service.js";
const orderIdParam = z.object({ orderId: z.string().min(1) });
export async function verificationRoutes(app) {
    app.get("/verify/rental/:orderId", async (request) => {
        const { orderId } = orderIdParam.parse(request.params);
        const result = await verificationService.verifyRental(orderId);
        return { success: true, data: result };
    });
    app.get("/verify/activity/:orderId", async (request) => {
        const { orderId } = orderIdParam.parse(request.params);
        const result = await verificationService.verifyActivity(orderId);
        return { success: true, data: result };
    });
}
