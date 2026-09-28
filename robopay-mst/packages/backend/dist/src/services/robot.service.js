import { blockchainService } from "./blockchain.service.js";
export const robotStatusMap = {
    0: "AVAILABLE",
    1: "IN_USE",
};
export class RobotService {
    async listRobots() {
        const robotIds = await blockchainService.getRobotIds();
        const robots = await Promise.all(robotIds.map((id) => this.getRobot(id)));
        return robots;
    }
    async getRobot(robotId) {
        const data = await blockchainService.getRobot(robotId);
        return {
            ...data,
            statusLabel: robotStatusMap[data.status] ?? "UNKNOWN",
        };
    }
    async syncRobot(robotId) {
        return this.getRobot(robotId);
    }
    async getRobotStatus(robotId) {
        const robot = await this.getRobot(robotId);
        return {
            robotId,
            status: robot.status,
            statusLabel: robot.statusLabel,
        };
    }
}
export const robotService = new RobotService();
