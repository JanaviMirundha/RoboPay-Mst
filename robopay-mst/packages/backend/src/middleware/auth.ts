import type { FastifyReply, FastifyRequest } from "fastify";

import { env } from "../config/env.js";
import { ERRORS } from "../utils/errors.js";

export function requireApiKey(apiKeyName: "ADMIN_API_KEY" | "ROBOT_API_KEY") {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    const header = request.headers["x-api-key"];
    const key = Array.isArray(header) ? header[0] : header;
    const expected = env[apiKeyName];

    if (!expected || !key || key !== expected) {
      throw ERRORS.UNAUTHORIZED("Missing or invalid API key");
    }
  };
}

export async function requireOwnerWalletValidation(request: FastifyRequest, reply: FastifyReply) {
  const owner = request.headers["x-owner-wallet"];
  if (!owner || typeof owner !== "string") {
    throw ERRORS.FORBIDDEN("Missing owner wallet");
  }

  const { blockchainService } = await import("../services/blockchain.service.js");
  const contractOwner = await blockchainService.getOwner();

  if (owner.toLowerCase() !== contractOwner.toLowerCase()) {
    throw ERRORS.OWNER_WALLET_MISMATCH();
  }
}
