import { keccak256, encodePacked, type Address } from "viem";
import { formatEther, formatUnits } from "viem";
import { ROBO_PAY_ADDRESS } from "@/lib/contract";

export function shortenAddress(value?: string) {
  if (!value) return "—";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function formatMstAmount(value: bigint | number | string | undefined) {
  if (value === undefined || value === null) return "—";
  const numeric = typeof value === "bigint" ? value : BigInt(value);
  return `${formatUnits(numeric, 18)} tMSTC`;
}

export function formatInrAmount(value: bigint | number | string | undefined) {
  if (value === undefined || value === null) return "—";
  const numeric = typeof value === "bigint" ? value : BigInt(value);
  return `₹${Number(numeric).toLocaleString()}`;
}

export function createOrderId() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `RP-${stamp}-${random}`;
}

export function formatRobotStatus(status: number | bigint) {
  if (Number(status) === 0) return "AVAILABLE";
  if (Number(status) === 1) return "IN_USE";
  return "UNKNOWN";
}

export function formatRentalStatus(active: boolean, completed: boolean) {
  if (completed) return "COMPLETED";
  if (active) return "ACTIVE";
  return "PENDING";
}

export function getNativeBalanceLabel(balance?: bigint) {
  if (balance === undefined) return "Balance unavailable";
  return `${formatEther(balance)} tMSTC`;
}

export function computeRentalDataHash(
  orderId: string,
  robotId: string,
  service: string,
  durationMinutes: number,
  amountInr: bigint,
  customer: Address,
  startTime: bigint,
  endTime: bigint,
) {
  return keccak256(
    encodePacked(
      ["string", "string", "string", "uint256", "uint256", "address", "uint256", "uint256"],
      [orderId, robotId, service, BigInt(durationMinutes), amountInr, customer, startTime, endTime],
    ),
  );
}

export function readOnlyErrorMessage(message: string | undefined) {
  if (!message) return "Something went wrong while reading blockchain data.";

  const normalized = message.toLowerCase();
  if (normalized.includes("user rejected")) return "Transaction was rejected by the wallet.";
  if (normalized.includes("insufficient funds")) return "Insufficient tMSTC balance for the required payment.";
  if (normalized.includes("wrong network") || normalized.includes("chain")) return "Please switch to MST Testnet to continue.";
  if (normalized.includes("order already exists")) return "This order ID already exists. A new order is being generated.";
  if (normalized.includes("robot is not available")) return "This robot is currently busy and cannot be rented.";
  if (normalized.includes("incorrect payment amount")) return "The payment amount did not match the blockchain requirement.";
  if (normalized.includes("incorrect inr package")) return "The selected package does not match the contract price.";
  if (normalized.includes("wallet not connected")) return "BridgeKey is not connected.";
  if (normalized.includes("not authorized")) return "This action is not allowed for the connected wallet.";
  return message;
}

export function isTruthyAddress(value: string | undefined) {
  return Boolean(value && value.startsWith("0x") && value.length > 10);
}

export const CONTRACT_ADDRESS = ROBO_PAY_ADDRESS;
