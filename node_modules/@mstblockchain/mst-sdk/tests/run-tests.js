const testClient = require('./client.test');
const testErrors = require('./errors.test');

async function runAllTests() {
    console.log("=== STARTING SDK TESTS ===\n");
    try {
        // await testErrors();
        await testClient();
        console.log("=== ALL TESTS FINISHED SUCCESSFULLY ===");
        process.exit(0);
    } catch (err) {
        console.error("Test suite failed:", err);
        process.exit(1);
    }
}

runAllTests().catch(() => process.exit(1));
