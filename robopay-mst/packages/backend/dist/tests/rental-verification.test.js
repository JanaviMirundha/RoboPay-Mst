import { describe, expect, it } from "vitest";
import { AbiCoder, keccak256, getAddress } from "ethers";
import { computeRentalDataHash } from "../src/utils/hash.js";
import { activeDeployment } from "../src/config/contracts.js";
describe("active RoboPayEscrow rental hash reproduction", () => {
    it("matches the exact keccak256(abi.encode(...)) implementation in deployed Solidity", () => {
        const input = {
            orderId: "RP-20260929-TEST01",
            robotId: "RF-01",
            service: "Human Following",
            durationMinutes: 10n,
            amountInr: 20n,
            customer: "0x1111111111111111111111111111111111111111",
            startTime: 1790640000n,
            endTime: 1790640600n,
        };
        const types = ["string", "string", "string", "uint256", "uint256", "address", "uint256", "uint256"];
        const values = [input.orderId, input.robotId, input.service, input.durationMinutes, input.amountInr, getAddress(input.customer), input.startTime, input.endTime];
        const deployedSolidityHash = keccak256(AbiCoder.defaultAbiCoder().encode(types, values));
        const abi = activeDeployment.abi;
        expect(Array.isArray(abi) && abi.some((fragment) => typeof fragment === "object" && "name" in fragment && fragment.name === "getRental")).toBe(true);
        expect(computeRentalDataHash(input)).toBe(deployedSolidityHash);
        expect(computeRentalDataHash({ ...input, amountInr: 21n })).not.toBe(deployedSolidityHash);
    });
});
