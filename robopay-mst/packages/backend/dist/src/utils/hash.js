import { createHash } from "node:crypto";
export function stableStringify(value) {
    if (value === null || value === undefined)
        return "null";
    if (typeof value === "bigint")
        return value.toString();
    if (typeof value === "string")
        return JSON.stringify(value);
    if (typeof value === "number" || typeof value === "boolean")
        return String(value);
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    }
    if (typeof value === "object") {
        const sorted = Object.keys(value)
            .sort()
            .reduce((acc, key) => {
            acc[key] = value[key];
            return acc;
        }, {});
        return `{${Object.entries(sorted)
            .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value);
}
export function sha256Hex(value) {
    return createHash("sha256").update(value, "utf8").digest("hex");
}
export function sha256Bytes32(value) {
    return `0x${sha256Hex(value).padStart(64, "0")}`;
}
