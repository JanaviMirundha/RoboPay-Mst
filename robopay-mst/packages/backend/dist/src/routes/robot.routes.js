import { z } from "zod";
import { robotService } from "../services/robot.service.js";
const robotIdParam = z.object({ robotId: z.string().min(1) });
export async function robotRoutes(app) {
    app.get("/robots", async () => {
        const robots = await robotService.listRobots();
        return { success: true, data: robots };
    });
    app.get("/robots/:robotId", async (request) => {
        const { robotId } = robotIdParam.parse(request.params);
        const robot = await robotService.getRobot(robotId);
        return { success: true, data: robot };
    });
    app.get("/robots/:robotId/status", async (request) => {
        const { robotId } = robotIdParam.parse(request.params);
        const status = await robotService.getRobotStatus(robotId);
        return { success: true, data: status };
    });
    app.get("/robots/:robotId/active-rental", async (request) => {
        const { robotId } = robotIdParam.parse(request.params);
        return { success: true, data: await robotService.getActiveRental(robotId) };
    });
}
