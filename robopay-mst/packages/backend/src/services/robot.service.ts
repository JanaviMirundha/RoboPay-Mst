import { getAddress } from "ethers";
import { prisma } from "../database.js";
import { blockchainService } from "./blockchain.service.js";
import { ERRORS } from "../utils/errors.js";

export type RobotStatusLabel = "AVAILABLE" | "IN_USE" | "UNKNOWN";

export class RobotService {
  async getRobot(robotId: string) {
    const robot = await blockchainService.getRobot(robotId);
    const statusLabel: RobotStatusLabel = robot.registered
      ? robot.status === 0 ? "AVAILABLE" : robot.status === 1 ? "IN_USE" : "UNKNOWN"
      : "UNKNOWN";
    const lastSyncedBlock = await blockchainService.getCurrentBlock();
    await prisma.robotSnapshot.upsert({
      where: { robotId },
      update: {
        name: robot.name,
        service: robot.service,
        ownerAddress: getAddress(robot.robotOwner),
        status: statusLabel,
        registered: robot.registered,
        lastSyncedBlock,
      },
      create: {
        robotId,
        name: robot.name,
        service: robot.service,
        ownerAddress: getAddress(robot.robotOwner),
        status: statusLabel,
        registered: robot.registered,
        lastSyncedBlock,
      },
    });
    return { ...robot, robotOwner: getAddress(robot.robotOwner), statusLabel, lastSyncedBlock };
  }

  async listRobots() {
    const robotIds = await blockchainService.getRobotIds() as string[];
    return Promise.all(robotIds.map((robotId) => this.getRobot(robotId)));
  }

  async syncRobot(robotId: string) {
    return this.getRobot(robotId);
  }

  async getRobotStatus(robotId: string) {
    const robot = await this.getRobot(robotId);
    return { robotId, status: robot.statusLabel, registered: robot.registered, blockNumber: robot.lastSyncedBlock };
  }

  async getActiveRental(robotId: string) {
    const robot = await blockchainService.getRobot(robotId);
    if (robot.status === 0) return { robotId, active: false, rental: null };
    if (robot.status !== 1) throw ERRORS.INCONSISTENT_BLOCKCHAIN_STATE(`Unexpected on-chain status ${robot.status} for ${robotId}.`);

    const orderIds = await blockchainService.getRentalOrderIds() as string[];
    const rentals = await Promise.all(orderIds.map((orderId) => blockchainService.getRental(orderId)));
    const matches = rentals.filter((rental) => rental.active && rental.robotId === robotId);
    if (matches.length !== 1) {
      throw ERRORS.INCONSISTENT_BLOCKCHAIN_STATE(`Robot ${robotId} is IN_USE on-chain, but ${matches.length} active matching rentals were found.`);
    }

    const rental = matches[0];
    return {
      robotId,
      active: true,
      rental: {
        orderId: rental.orderId,
        customer: getAddress(rental.customer),
        service: rental.service,
        durationMinutes: rental.durationMinutes,
        startTime: rental.startTime.toString(),
        endTime: rental.endTime.toString(),
        status: rental.statusLabel,
        paymentStatus: rental.escrowedAmountWei === rental.amountPaidWei ? "ESCROWED" : "UNKNOWN",
      },
    };
  }
}

export const robotService = new RobotService();