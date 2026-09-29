import { type Abi, type Address } from "viem";
import { deployments } from "robopay-mst-shared";
import { mstTestnet } from "@/lib/chains";

type DeploymentRecord = { address: Address; abi: Abi };
const testnetDeployments = deployments.testnet as Record<string, DeploymentRecord | undefined>;
const escrowDeployment = testnetDeployments.RoboPayEscrow;

export const IS_ROBO_PAY_ESCROW_DEPLOYED = Boolean(escrowDeployment);
export const ROBO_PAY_ADDRESS = escrowDeployment?.address ?? "0x0000000000000000000000000000000000000000";
export const ROBO_PAY_ABI: Abi = escrowDeployment?.abi ?? [];
export const MST_CHAIN_ID = mstTestnet.id;
export const CONTRACT_SCAN_URL = `https://testnet.mstscan.com/address/${ROBO_PAY_ADDRESS}`;

export const ROBOT_PACKAGES: Record<string, Array<{ durationMinutes: number; amountInr: number; amountWei: bigint }>> = {
  "RF-01": [
    { durationMinutes: 1, amountInr: 2, amountWei: BigInt(0) },
    { durationMinutes: 2, amountInr: 4, amountWei: BigInt(0) },
    { durationMinutes: 3, amountInr: 6, amountWei: BigInt(0) },
  ],
  "FC-01": [
    { durationMinutes: 1, amountInr: 2, amountWei: BigInt(0) },
    { durationMinutes: 2, amountInr: 4, amountWei: BigInt(0) },
    { durationMinutes: 3, amountInr: 6, amountWei: BigInt(0) },
  ],
  "ST-01": [
    { durationMinutes: 1, amountInr: 2, amountWei: BigInt(0) },
    { durationMinutes: 2, amountInr: 4, amountWei: BigInt(0) },
    { durationMinutes: 3, amountInr: 6, amountWei: BigInt(0) },
  ],
  "RC-01": [
    { durationMinutes: 1, amountInr: 2, amountWei: BigInt(0) },
    { durationMinutes: 2, amountInr: 4, amountWei: BigInt(0) },
    { durationMinutes: 3, amountInr: 6, amountWei: BigInt(0) },
  ],
};

export const defaultRobots = [
  { id: "RF-01", name: "RoboFollow", service: "Human Following" },
  { id: "FC-01", name: "RoboClean", service: "Floor Cleaning" },
  { id: "ST-01", name: "RoboTrolley", service: "Smart Shopping Trolley" },
  { id: "RC-01", name: "RoboCourier", service: "Autonomous Parcel Delivery" },
] as const;

export function getRobotConfig(robotId: string) {
  return defaultRobots.find((robot) => robot.id === robotId) ?? null;
}
