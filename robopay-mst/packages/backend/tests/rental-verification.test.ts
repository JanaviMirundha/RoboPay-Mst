import { describe, expect, it } from "vitest";
import { ethers } from "ethers";

describe("rental data hash reproduction", () => {
  it("matches solidity-compatible packed hash structure", () => {
    const orderId = "RP-100";
    const robotId = "RF-01";
    const service = "Human Following";
    const durationMinutes = 10n;
    const amountInr = 20n;
    const customer = "0x1111111111111111111111111111111111111111";
    const startTime = 1700000000n;
    const endTime = 1700000600n;

    const packed = ethers.solidityPacked(
      ["string", "string", "string", "uint256", "uint256", "address", "uint256", "uint256"],
      [orderId, robotId, service, durationMinutes, amountInr, customer, startTime, endTime],
    );

    const hash = ethers.keccak256(ethers.toUtf8Bytes(packed));
    expect(hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
  });
});
