import { ZodError } from "zod";
import { AppError } from "../utils/errors.js";
export function registerErrorHandler(app) {
    app.setErrorHandler((error, _request, reply) => {
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
        if (error instanceof ZodError || (typeof error === "object" && error !== null && "validation" in error)) {
            reply.status(400).send({
                success: false,
                error: {
                    code: "INVALID_REQUEST",
                    message: "Request validation failed.",
                },
            });
            return;
        }
        if (error instanceof Error && error.message.includes("Prisma")) {
            app.log.error({ message: error.message }, "Database operation failed");
            reply.status(500).send({ success: false, error: { code: "DATABASE_ERROR", message: "Database operation failed." } });
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
