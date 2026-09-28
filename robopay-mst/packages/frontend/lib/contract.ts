import { type Abi } from "viem";
import { deployments } from "robopay-mst-shared";
import { mstTestnet } from "@/lib/chains";

export const ROBO_PAY_ADDRESS = ((deployments as Record<string, any>).testnet?.RoboPay?.address ?? "0xe4CA28050580918c252b53c181ff361B65C9f667") as `0x${string}`;
export const ROBO_PAY_ABI: Abi = ((deployments as Record<string, any>).testnet?.RoboPay?.abi ?? []) as Abi;
export const MST_CHAIN_ID = mstTestnet.id;
export const CONTRACT_SCAN_URL = `https://testnet.mstscan.com/address/${ROBO_PAY_ADDRESS}`;

export const ROBOT_PACKAGES: Record<string, Array<{ durationMinutes: number; amountInr: number; amountWei: bigint }>> = {
  "RF-01": [
    { durationMinutes: 10, amountInr: 20, amountWei: BigInt(0) },
    { durationMinutes: 20, amountInr: 40, amountWei: BigInt(0) },
    { durationMinutes: 30, amountInr: 60, amountWei: BigInt(0) },
  ],
  "FC-01": [{ durationMinutes: 10, amountInr: 20, amountWei: BigInt(0) }],
  "ST-01": [{ durationMinutes: 30, amountInr: 30, amountWei: BigInt(0) }],
};

export const defaultRobots = [
  { id: "RF-01", name: "RoboFollow", service: "Human Following" },
  { id: "FC-01", name: "RoboClean", service: "Floor Cleaning" },
  { id: "ST-01", name: "RoboTrolley", service: "Smart Shopping Trolley" },
] as const;

export function getRobotConfig(robotId: string) {
  return defaultRobots.find((robot) => robot.id === robotId) ?? null;
}
