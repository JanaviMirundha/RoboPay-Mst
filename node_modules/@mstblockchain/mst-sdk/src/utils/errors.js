/**
 * Custom Error Classes for the SDK
 */
class SDKBaseError extends Error {
    constructor(message, code = "INTERNAL_ERROR") {
        super(message);
        this.name = this.constructor.name;
        this.code = code;
    }
}

class ProviderError extends SDKBaseError {
    constructor(message) {
        super(message, "PROVIDER_ERROR");
    }
}

class TransactionError extends SDKBaseError {
    constructor(message) {
        super(message, "TRANSACTION_ERROR");
    }
}

class WalletError extends SDKBaseError {
    constructor(message) {
        super(message, "WALLET_ERROR");
    }
}

module.exports = {
    SDKBaseError,
    ProviderError,
    TransactionError,
    WalletError
};
