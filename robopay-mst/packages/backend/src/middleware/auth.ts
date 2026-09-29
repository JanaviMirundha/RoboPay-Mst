import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

import { env } from "../config/env.js";
import { ERRORS } from "../utils/errors.js";

export function requireApiKey(apiKeyName: "ADMIN_API_KEY" | "ROBOT_API_KEY") {
  return async function (request: FastifyRequest, _reply: FastifyReply) {
    const header = request.headers["x-api-key"];
    const key = Array.isArray(header) ? header[0] : header;
    const expected = env[apiKeyName];

    const suppliedBuffer = Buffer.from(key ?? "");
    const expectedBuffer = Buffer.from(expected ?? "");
    const valid = suppliedBuffer.length === expectedBuffer.length && suppliedBuffer.length > 0 && timingSafeEqual(suppliedBuffer, expectedBuffer);
    if (!valid) {
      throw ERRORS.UNAUTHORIZED("Missing or invalid API key");
    }
  };
}

export async function requireOwnerWalletValidation(_request: FastifyRequest, _reply: FastifyReply) {
  const { blockchainService } = await import("../services/blockchain.service.js");
  await blockchainService.requireOperatorOwner();
}
