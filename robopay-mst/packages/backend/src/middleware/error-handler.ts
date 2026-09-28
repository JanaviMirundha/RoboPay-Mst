import type { FastifyInstance } from "fastify";

import { AppError } from "../utils/errors.js";

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error: any, _request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
      return;
    }

    if (error && error.validation) {
      reply.status(400).send({
        success: false,
        error: {
          code: "INVALID_REQUEST",
          message: "Request validation failed.",
        },
      });
      return;
    }

    app.log.error(error);
    reply.status(500).send({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
      },
    });
  });
}
