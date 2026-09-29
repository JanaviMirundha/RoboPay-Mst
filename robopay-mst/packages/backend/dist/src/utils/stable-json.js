export function stableStringify(value) {
    const seen = new Set();
    const serialize = (entry) => {
        if (entry === null)
            return "null";
        if (entry instanceof Date)
            return JSON.stringify(entry.toISOString());
        if (typeof entry === "string" || typeof entry === "boolean")
            return JSON.stringify(entry);
        if (typeof entry === "number") {
            if (!Number.isFinite(entry))
                throw new TypeError("Non-finite numbers are not supported in stable JSON.");
            return JSON.stringify(entry);
        }
        if (typeof entry === "bigint")
            return JSON.stringify(entry.toString());
        if (typeof entry !== "object")
            throw new TypeError("Unsupported value in stable JSON.");
        if (seen.has(entry))
            throw new TypeError("Circular references are not supported in stable JSON.");
        seen.add(entry);
        try {
            if (Array.isArray(entry))
                return `[${entry.map((item) => serialize(item)).join(",")}]`;
            const record = entry;
            const fields = Object.keys(record)
                .sort()
                .filter((key) => record[key] !== undefined)
                .map((key) => `${JSON.stringify(key)}:${serialize(record[key])}`);
            return `{${fields.join(",")}}`;
        }
        finally {
            seen.delete(entry);
        }
    };
    return serialize(value);
}
