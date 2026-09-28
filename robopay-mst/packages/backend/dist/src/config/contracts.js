import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const sharedContractsPath = path.resolve(currentDir, "../../../shared/src/contracts.ts");
function readDeployments() {
    const source = fs.readFileSync(sharedContractsPath, "utf8");
    const assignmentIndex = source.indexOf("export const deployments =");
    if (assignmentIndex === -1) {
        throw new Error(`Unable to parse RoboPay deployment metadata from ${sharedContractsPath}`);
    }
    const objectStart = source.indexOf("{", assignmentIndex);
    if (objectStart === -1) {
        throw new Error(`Unable to locate deployment object in ${sharedContractsPath}`);
    }
    let depth = 0;
    let inString = false;
    let quote = "";
    let escaped = false;
    for (let i = objectStart; i < source.length; i += 1) {
        const char = source[i];
        if (inString) {
            if (escaped) {
                escaped = false;
            }
            else if (char === "\\") {
                escaped = true;
            }
            else if (char === quote) {
                inString = false;
            }
            continue;
        }
        if (char === '"' || char === "'" || char === "`") {
            inString = true;
            quote = char;
            continue;
        }
        if (char === "{") {
            depth += 1;
        }
        else if (char === "}") {
            depth -= 1;
            if (depth === 0) {
                const objectLiteral = source.slice(objectStart, i + 1).trim();
                try {
                    return Function(`"use strict"; return (${objectLiteral});`)();
                }
                catch (error) {
                    throw new Error(`Invalid RoboPay deployment metadata in ${sharedContractsPath}: ${error.message}`);
                }
            }
        }
    }
    throw new Error(`Unable to find the end of the deployment object in ${sharedContractsPath}`);
}
export const deployments = readDeployments();
