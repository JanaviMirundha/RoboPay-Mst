import { createHash } from "node:crypto";
import { AbiCoder, getAddress, keccak256 } from "ethers";
import { stableStringify } from "./stable-json.js";
export { stableStringify };
export function sha256Hex(value) {
    return createHash("sha256").update(value, "utf8").digest("hex");
}
export function sha256Bytes32(value) {
    return `0x${sha256Hex(value)}`;
}
export function sha256StableBytes32(value) {
    return sha256Bytes32(stableStringify(value));
}
export function computeRentalDataHash(input) {
    const coder = AbiCoder.defaultAbiCoder();
    return keccak256(coder.encode(["string", "string", "string", "uint256", "uint256", "address", "uint256", "uint256"], [
        input.orderId,
        input.robotId,
        input.service,
        BigInt(input.durationMinutes),
        BigInt(input.amountInr),
        getAddress(input.customer),
        BigInt(input.startTime),
        BigInt(input.endTime),
    ]));
}
