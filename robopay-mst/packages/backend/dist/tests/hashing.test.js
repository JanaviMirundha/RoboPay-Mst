import { describe, expect, it } from "vitest";
import { sha256Bytes32, sha256Hex, sha256StableBytes32, stableStringify } from "../src/utils/hash.js";
describe("hash utilities", () => {
    it("produces stable serialization for equivalent objects", () => {
        const a = { b: 2, a: 1, nested: { z: 1, y: 2 } };
        const b = { a: 1, nested: { y: 2, z: 1 }, b: 2 };
        expect(stableStringify(a)).toBe(stableStringify(b));
    });
    it("changes hash when payload changes", () => {
        const first = sha256StableBytes32({ orderId: "RP-1", robotId: "RF-01", battery: 80 });
        const second = sha256StableBytes32({ orderId: "RP-1", robotId: "RF-01", battery: 81 });
        expect(first).not.toBe(second);
    });
    it("produces the same 32-byte SHA-256 for canonical-equivalent objects", () => {
        const first = sha256StableBytes32({ a: 1, nested: { x: true, y: "v" } });
        const second = sha256StableBytes32({ nested: { y: "v", x: true }, a: 1 });
        expect(first).toBe(second);
        expect(sha256Hex(stableStringify({ a: 1, nested: { x: true, y: "v" } }))).toBe(first.slice(2));
        expect(sha256Bytes32("test")).toMatch(/^0x[a-f0-9]{64}$/);
    });
});
