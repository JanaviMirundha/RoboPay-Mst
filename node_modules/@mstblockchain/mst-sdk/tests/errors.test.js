const { Client, Errors } = require('../src');
const assert = require('assert');

async function testErrors() {
    console.log("Testing Error Handling...");
    
    // 1. Test Wallet Initialization Error
    console.log("  - Testing WalletError...");
    try {
        new Client("http://localhost:8545", "invalid-key");
        assert.fail("Should have thrown WalletError");
    } catch (err) {
        assert(err instanceof Errors.WalletError, "Should be instance of WalletError");
        assert(err.code === "WALLET_ERROR", "Should have WALLET_ERROR code");
    }

    // 2. Test Input Validation Errors
    console.log("  - Testing TransactionError (Validation)...");
    const client = new Client("https://testnetrpc.mstblockchain.com", "0x3e31041395dc9d66f915dcb13e2cc8f9a5fc9a9f4f0980d1f2b915dee87e5684");
    try {
        await client.signer.sendNative(null, "1000");
        assert.fail("Should have thrown TransactionError for missing address");
    } catch (err) {
        assert(err instanceof Errors.TransactionError, "Should be TransactionError");
        assert(err.message.includes("Destination address"), "Message should mention destination");
    }

    // 3. Test Provider Errors (Invalid RPC)
    console.log("  - Testing ProviderError (Invalid RPC)...");
    const badClient = new Client("https://invalid-rpc-url-123.com");
    try {
        await badClient.provider.getBlockNumber();
        assert.fail("Should have thrown ProviderError");
    } catch (err) {
        assert(err instanceof Errors.ProviderError, "Should be ProviderError");
        assert(err.code === "PROVIDER_ERROR", "Code should be PROVIDER_ERROR");
    }

    console.log("Error tests completed.\n");
    process.exit(0);
}

if (require.main === module) {
    testErrors().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = testErrors;
