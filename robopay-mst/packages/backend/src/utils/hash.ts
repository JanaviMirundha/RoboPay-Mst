import { createHash } from "node:crypto";
import { AbiCoder, getAddress, keccak256 } from "ethers";
import { stableStringify } from "./stable-json.js";

export { stableStringify };

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function sha256Bytes32(value: string): `0x${string}` {
  return `0x${sha256Hex(value)}` as `0x${string}`;
}

export function sha256StableBytes32(value: unknown): `0x${string}` {
  return sha256Bytes32(stableStringify(value));
}

export function computeRentalDataHash(input: {
  orderId: string;
  robotId: string;
  service: string;
  durationMinutes: bigint | number | string;
  amountInr: bigint | number | string;
  customer: string;
  startTime: bigint | number | string;
  endTime: bigint | number | string;
}): `0x${string}` {
  const coder = AbiCoder.defaultAbiCoder();
  return keccak256(coder.encode(
    ["string", "string", "string", "uint256", "uint256", "address", "uint256", "uint256"],
    [
      input.orderId,
      input.robotId,
      input.service,
      BigInt(input.durationMinutes),
      BigInt(input.amountInr),
      getAddress(input.customer),
      BigInt(input.startTime),
      BigInt(input.endTime),
    ],
  )) as `0x${string}`;
}
