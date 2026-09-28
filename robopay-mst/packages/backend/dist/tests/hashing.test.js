import { describe, expect, it } from "vitest";
import { sha256Hex, stableStringify } from "../src/utils/hash.js";
describe("hash utilities", () => {
    it("produces stable serialization for equivalent objects", () => {
        const a = { b: 2, a: 1, nested: { z: 1, y: 2 } };
        const b = { a: 1, nested: { y: 2, z: 1 }, b: 2 };
        expect(stableStringify(a)).toBe(stableStringify(b));
    });
    it("changes hash when payload changes", () => {
        const first = sha256Hex(JSON.stringify({ orderId: "RP-1", robotId: "RF-01", battery: 80 }));
        const second = sha256Hex(JSON.stringify({ orderId: "RP-1", robotId: "RF-01", battery: 81 }));
        expect(first).not.toBe(second);
    });
});
