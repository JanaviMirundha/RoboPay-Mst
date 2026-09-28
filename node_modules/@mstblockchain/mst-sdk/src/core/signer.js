const { ethers } = require("ethers");
const { TransactionError, WalletError } = require("../utils/errors");

/**
 * Signer class for signing transactions.
 */
class Signer {
    constructor(privateKey, provider) {
        try {
            this.provider = provider;
            this.ethersWallet = new ethers.Wallet(privateKey, provider.ethersProvider);
            this.address = this.ethersWallet.address;
        } catch (err) {
            throw new WalletError(`Failed to initialize Wallet: ${err.message}`);
        }
    }

    /**
     * Creates a new random Signer attached to the given provider.
     * @param {Provider} provider - The provider instance.
     * @returns {Signer} A new Signer instance with a random private key.
     */
    static createRandom(provider) {
        const wallet = ethers.Wallet.createRandom();
        return new Signer(wallet.privateKey, provider);
    }

    /**
     * Returns the private key of the current wallet.
     * @returns {string} The private key.
     */
    getPrivateKey() {
        return this.ethersWallet.privateKey;
    }

    async sendTransaction(tx) {
        try {
            const response = await this.ethersWallet.sendTransaction(tx);
            return response.hash;
        } catch (err) {
            throw new TransactionError(`Transaction failed: ${err.message}`);
        }
    }

    async sendToken(tokenAddress, to, amount) {
        if (!to || !amount || !tokenAddress) {
            throw new TransactionError("tokenAddress, to, and amount are required for token transfers");
        }
        // ERC20 transfer(address,uint256) method ID: 0xa9059cbb
        const data = `0xa9059cbb${to.replace('0x', '').padStart(64, '0')}${BigInt(amount).toString(16).padStart(64, '0')}`;
        
        return await this.sendTransaction({
            to: tokenAddress,
            data: data,
            gasLimit: 60000
        });
    }

    async deploy(abi, bytecode, args = []) {
        try {
            const factory = new ethers.ContractFactory(abi, bytecode, this.ethersWallet);
            const contract = await factory.deploy(...args);
            return contract.deploymentTransaction().hash;
        } catch (err) {
            throw new TransactionError(`Deployment failed: ${err.message}`);
        }
    }

    async sendNative(to, amount) {
        if (!to || !amount) {
            throw new TransactionError("Destination address and amount are required");
        }
        return await this.sendTransaction({
            to: to,
            value: amount,
            gasLimit: 21000
        });
    }

    async getAddress() {
        return this.address;
    }

    /**
     * Estimates gas for a transaction based on the method and arguments.
     * @param {string} method - The action to perform ('sendNative', 'sendToken', 'deploy').
     * @param {any[]} args - The arguments for the specified method.
     * @returns {Promise<number>} The estimated gas amount.
     */
    async estimateGas(method, args) {
        try {
            let tx = {};
            if (method === "sendNative") {
                const [to, amount] = args;
                tx = { to, value: amount };
            } else if (method === "sendToken") {
                const [tokenAddress, to, amount] = args;
                const data = `0xa9059cbb${to.replace('0x', '').padStart(64, '0')}${BigInt(amount).toString(16).padStart(64, '0')}`;
                tx = { to: tokenAddress, data };
            } else if (method === "deploy") {
                const [abi, bytecode, constructorArgs = []] = args;
                const factory = new ethers.ContractFactory(abi, bytecode, this.ethersWallet);
                const deployTx = await factory.getDeployTransaction(...constructorArgs);
                tx = deployTx;
            } else {
                throw new Error(`Unsupported method for gas estimation: ${method}`);
            }

            const gas = await this.ethersWallet.estimateGas(tx);
            return Number(gas);
        } catch (err) {
            throw new TransactionError(`Gas estimation failed: ${err.message}`);
        }
    }
}

module.exports = Signer;
