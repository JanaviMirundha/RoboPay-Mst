import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

dotenv.config({ path: ".env.local" });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  MST_RPC_URL: z.string().url(),
  MST_CHAIN_ID: z.coerce.number().int().positive(),
  ROBO_PAY_CONTRACT_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  ROBO_PAY_OWNER_PRIVATE_KEY: z.string().optional(),
  DATABASE_URL: z.string().min(1),
  ADMIN_API_KEY: z.string().optional(),
  ROBOT_API_KEY: z.string().optional(),
  FRONTEND_ORIGIN: z.string().url().optional(),
  BLOCK_CONFIRMATIONS: z.coerce.number().default(1),
  BLOCK_BATCH_SIZE: z.coerce.number().default(100),
  SYNC_INTERVAL_MS: z.coerce.number().default(5000),
  EXPIRY_CHECK_INTERVAL_MS: z.coerce.number().default(10000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n");
  throw new Error(`Invalid backend environment:\n${issues}`);
}

export const env = parsed.data;
