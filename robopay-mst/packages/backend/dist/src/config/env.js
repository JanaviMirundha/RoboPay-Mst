import dotenv from "dotenv";
import path from "node:path";
import { z } from "zod";
import { activeDeployment } from "./contracts.js";
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const envSchema = z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().default(4000),
    MST_RPC_URL: z.string().url().default("https://testnetrpc.mstblockchain.com"),
    MST_CHAIN_ID: z.coerce.number().int().default(91562037).refine((chainId) => chainId === 91562037, {
        message: "Only MST Testnet (chain ID 91562037) is supported.",
    }),
    ROBO_PAY_CONTRACT_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
    ROBO_PAY_OPERATOR_PRIVATE_KEY: z.string().optional(),
    ROBO_PAY_DEMO_MODE: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
    DATABASE_URL: z.string().min(1).default("file:./dev.db"),
    ADMIN_API_KEY: z.string().optional(),
    ROBOT_API_KEY: z.string().optional(),
    FRONTEND_ORIGIN: z.string().default("http://localhost:3000"),
    BLOCK_CONFIRMATIONS: z.coerce.number().int().min(0).default(1),
    BLOCK_BATCH_SIZE: z.coerce.number().int().min(1).max(2000).default(100),
    SYNC_INTERVAL_MS: z.coerce.number().int().min(1000).default(5000),
    EXPIRY_CHECK_INTERVAL_MS: z.coerce.number().int().min(1000).default(10000),
    SYNC_START_BLOCK: z.coerce.number().int().min(0).optional(),
});
const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid backend environment:\n${issues}`);
}
if (parsed.data.ROBO_PAY_CONTRACT_ADDRESS &&
    parsed.data.ROBO_PAY_CONTRACT_ADDRESS.toLowerCase() !== activeDeployment.address.toLowerCase()) {
    throw new Error(`ROBO_PAY_CONTRACT_ADDRESS does not match the active RoboPayEscrow deployment ${activeDeployment.address}.`);
}
export const env = {
    ...parsed.data,
    ROBO_PAY_CONTRACT_ADDRESS: activeDeployment.address,
    FRONTEND_ORIGINS: parsed.data.FRONTEND_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean),
};
