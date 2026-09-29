import { describe, expect, it } from "vitest";
import { Interface } from "ethers";
import { keccak256, toUtf8Bytes } from "ethers";
import { activeDeployment } from "../src/config/contracts.js";
describe("active escrow event ABI", () => {
    it("decodes RentalCreated with indexed order/robot/customer fields", () => {
        const contractInterface = new Interface(activeDeployment.abi);
        const encoded = contractInterface.encodeEventLog("RentalCreated", [
            "RP-EVENT-1",
            "RF-01",
            "0x1111111111111111111111111111111111111111",
            10n,
            20n,
            10000000000000000n,
            1790640000n,
            1790640600n,
            `0x${"1".repeat(64)}`,
        ]);
        const parsed = contractInterface.parseLog(encoded);
        expect(parsed?.name).toBe("RentalCreated");
        expect(parsed?.args.orderId.hash).toBe(keccak256(toUtf8Bytes("RP-EVENT-1")));
        expect(parsed?.args.robotId.hash).toBe(keccak256(toUtf8Bytes("RF-01")));
        expect(parsed?.args.customer).toBe("0x1111111111111111111111111111111111111111");
    });
    it("does not advertise unsupported legacy completion entrypoints", () => {
        const contractInterface = new Interface(activeDeployment.abi);
        expect(() => contractInterface.getFunction("settleRental")).not.toThrow();
        expect(() => contractInterface.getFunction("refundRental")).not.toThrow();
        expect(contractInterface.getFunction("endRental")).toBeNull();
    });
});
