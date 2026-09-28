const { ProviderError } = require("../utils/errors");
const { ethers } = require("ethers");

/**
 * Provider class for interacting with the blockchain.
 */
class Provider {
    constructor(rpcUrl) {
        this.rpcUrl = rpcUrl;
        this.ethersProvider = new ethers.JsonRpcProvider(rpcUrl);
    }

    async getBlockNumber() {
        try {
            return await this.ethersProvider.getBlockNumber();
        } catch (err) {
            throw new ProviderError(`Failed to fetch block number: ${err.message}`);
        }
    }

    async getBalance(address) {
        try {
            return await this.ethersProvider.getBalance(address);
        } catch (err) {
            throw new ProviderError(`Failed to fetch balance for ${address}: ${err.message}`);
        }
    }

    async getTransactionReceipt(hash) {
        try {
            return await this.ethersProvider.getTransactionReceipt(hash);
        } catch (err) {
            throw new ProviderError(`Failed to fetch receipt for ${hash}: ${err.message}`);
        }
    }

    async waitForTransaction(hash) {
        try {
            return await this.ethersProvider.waitForTransaction(hash);
        } catch (err) {
            throw new ProviderError(`Error while waiting for transaction ${hash}: ${err.message}`);
        }
    }

    /**
     * Estimates gas for a transaction.
     * @param {Object} transaction - The transaction object.
     * @returns {Promise<number>} The estimated gas amount.
     */
    async estimateGas(transaction) {
        try {
            const gas = await this.ethersProvider.estimateGas(transaction);
            return Number(gas);
        } catch (err) {
            throw new ProviderError(`Failed to estimate gas: ${err.message}`);
        }
    }
}

module.exports = Provider;
