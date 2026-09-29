export class AppError extends Error {
    code;
    statusCode;
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = "AppError";
        this.code = code;
        this.statusCode = statusCode;
    }
}
export const ERRORS = {
    NOT_FOUND: (message = "Resource not found") => new AppError("NOT_FOUND", message, 404),
    INVALID_REQUEST: (message = "Invalid request") => new AppError("INVALID_REQUEST", message, 400),
    INVALID_ADDRESS: (message = "Invalid wallet address") => new AppError("INVALID_ADDRESS", message, 400),
    INVALID_ORDER: (message = "Invalid order") => new AppError("INVALID_ORDER", message, 400),
    ROBOT_NOT_AVAILABLE: (message = "Robot is not available") => new AppError("ROBOT_NOT_AVAILABLE", message, 409),
    INCONSISTENT_BLOCKCHAIN_STATE: (message = "Robot and rental state disagree on MST Testnet") => new AppError("INCONSISTENT_BLOCKCHAIN_STATE", message, 409),
    RENTAL_NOT_FOUND: (message = "Rental not found") => new AppError("RENTAL_NOT_FOUND", message, 404),
    RENTAL_NOT_ACTIVE: (message = "Rental is not active") => new AppError("RENTAL_NOT_ACTIVE", message, 409),
    WRONG_NETWORK: (message = "Wrong blockchain network") => new AppError("WRONG_NETWORK", message, 400),
    TRANSACTION_FAILED: (message = "Transaction failed") => new AppError("TRANSACTION_FAILED", message, 400),
    TRANSACTION_NOT_FOUND: (message = "Transaction not found") => new AppError("TRANSACTION_NOT_FOUND", message, 404),
    TRANSACTION_NOT_VERIFIED: (message = "Transaction was not verified") => new AppError("TRANSACTION_NOT_VERIFIED", message, 400),
    HASH_MISMATCH: (message = "Hash mismatch") => new AppError("HASH_MISMATCH", message, 409),
    UNAUTHORIZED: (message = "Unauthorized") => new AppError("UNAUTHORIZED", message, 401),
    FORBIDDEN: (message = "Forbidden") => new AppError("FORBIDDEN", message, 403),
    BLOCKCHAIN_ERROR: (message = "Blockchain error") => new AppError("BLOCKCHAIN_ERROR", message, 502),
    DATABASE_ERROR: (message = "Database error") => new AppError("DATABASE_ERROR", message, 500),
    OWNER_WALLET_MISMATCH: (message = "Owner wallet does not match configured wallet") => new AppError("OWNER_WALLET_MISMATCH", message, 500),
    ESCROW_NOT_SUPPORTED: (message = "The active contract does not support this escrow operation") => new AppError("ESCROW_NOT_SUPPORTED", message, 501),
    SETTLEMENT_NOT_ALLOWED: (message = "Settlement conditions are not satisfied") => new AppError("SETTLEMENT_NOT_ALLOWED", message, 409),
    REFUND_NOT_ALLOWED: (message = "Refund conditions are not satisfied") => new AppError("REFUND_NOT_ALLOWED", message, 409),
    DATA_UNAVAILABLE: (message = "Required off-chain data is unavailable") => new AppError("DATA_UNAVAILABLE", message, 503),
};
