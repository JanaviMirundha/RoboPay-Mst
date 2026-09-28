const { Client } = require('../src');
const { DEFAULT_RPC_URL } = require('../src/utils/constants');
const assert = require('assert');
const { abi, bytecode } = require('./abi.js');

async function testClient() {
    console.log("Testing Client Orchestration...");
    const pk = "ENTER YOUR PRIVATE KEY"; // Enter your own privateKey
    const client = new Client(DEFAULT_RPC_URL, pk);
    console.log(client);
    console.log(`Client Address: ${client.signer.address}`);
    assert(client.provider !== undefined, "Provider should be initialized");
    assert(client.signer !== undefined, "Signer should be initialized");

    // Test getPrivateKey
    console.log("Testing getPrivateKey...");
    const pkFromSigner = client.signer.getPrivateKey();
    assert(pkFromSigner === pk, "Private key should match the one provided");
    assert(pkFromSigner.startsWith("0x"), "Private key should start with 0x");
    console.log("getPrivateKey check passed.");

    // Test createRandom
    console.log("Testing createRandom...");
    const randomClient = Client.createRandom(DEFAULT_RPC_URL);
    assert(randomClient.signer !== undefined, "Random client should have a signer");
    assert(randomClient.signer.address !== undefined, "Random signer should have an address");
    assert(randomClient.signer.address !== client.signer.address, "Random address should be different");
    console.log(`Random Address Generated: ${randomClient.signer.address}`);
    console.log("createRandom check passed.");

    // Test estimateGas
    console.log("Testing estimateGas...");
    try {
        const gasLimit = await client.signer.estimateGas("sendNative", ["0x0Ed97d61F29E87b553e1EC52A2cBfA782Fa67464", "1000"]);
        console.log(`Estimated Gas (sendNative): ${gasLimit}`);
        assert(typeof gasLimit === 'number', "Gas limit should be a number");
    } catch (err) {
        console.log(`estimateGas check failed (expected if RPC is offline): ${err.message}`);
    }

    try {
        const blockNumber = await client.provider.getBlockNumber();
        console.log(`Current Block Number: ${blockNumber}`);
        assert(blockNumber !== undefined, "Block number should be fetched");
    } catch (err) {
        console.log(`Provider check failed: ${err.message}`);
    }

    try {
        const balance = await client.provider.getBalance(client.signer.address);
        console.log(`Balance: ${balance}`);
    } catch (err) {
        console.log(`Fetch failed (expected if RPC is offline): ${err.message}`);
    }

    // try {
    //     const txhash = await client.signer.deploy(abi, bytecode, [client.signer.address]);
    //     console.log(`Transaction Hash: ${txhash}`);

    //     console.log("Waiting for deployment...");
    //     const receipt = await client.provider.waitForTransaction(txhash);
    //     console.log(`Contract Deployed at: ${receipt.contractAddress}`);

    //     assert(receipt.contractAddress !== undefined, "Contract address should be in receipt");
    // } catch (err) {
    //     console.log(`Deployment failed (expected if RPC is offline): ${err.message}`);
    // }

    console.log("Client test completed.\n");

    try{
        const txHash = await client.signer.sendNative("0x0Ed97d61F29E87b553e1EC52A2cBfA782Fa67464", "1000000000000000000");
        console.log(`Transaction Hash: ${txHash}`);
    }catch(err){
        console.log(`Send Native failed (expected if RPC is offline): ${err.message}`);
    }
}

if (require.main === module) {
    testClient();
}

module.exports = testClient;
