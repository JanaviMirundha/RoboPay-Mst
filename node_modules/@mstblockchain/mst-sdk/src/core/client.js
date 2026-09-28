const Provider = require("./provider");
const Signer = require("./signer");

/**
 * Main SDK Client Class
 */
class Client {
    constructor(rpcUrl, privateKey = null) {
        this.provider = new Provider(rpcUrl);
        if (privateKey) {
            this.signer = new Signer(privateKey, this.provider);
        }
    }

    /**
     * Creates a new Client instance with a random wallet.
     * @param {string} rpcUrl - The JSON-RPC URL.
     * @returns {Client} A new Client instance.
     */
    static createRandom(rpcUrl) {
        const client = new Client(rpcUrl);
        client.signer = Signer.createRandom(client.provider);
        return client;
    }
}

module.exports = Client;
