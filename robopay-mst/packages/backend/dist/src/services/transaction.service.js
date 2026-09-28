import { Contract, JsonRpcProvider } from "ethers";
import { deployments } from "../config/contracts.js";
import { env } from "../config/env.js";
import { ERRORS } from "../utils/errors.js";
const ABI = deployments.testnet?.RoboPay?.abi ?? [];
export class TransactionService {
    provider;
    contract;
    constructor() {
        this.provider = new JsonRpcProvider(env.MST_RPC_URL);
        this.contract = new Contract(env.ROBO_PAY_CONTRACT_ADDRESS, ABI, this.provider);
    }
    async getReceipt(txHash) {
        const receipt = await this.provider.getTransactionReceipt(txHash);
        if (!receipt)
            throw ERRORS.TRANSACTION_NOT_FOUND(`Transaction ${txHash} not found`);
        return receipt;
    }
    async waitForReceipt(txHash) {
        const receipt = await this.provider.waitForTransaction(txHash, 1);
        if (!receipt)
            throw ERRORS.TRANSACTION_NOT_FOUND(`Transaction ${txHash} did not confirm`);
        return receipt;
    }
    async decodeRentalCreated(txHash) {
        const receipt = await this.getReceipt(txHash);
        const event = receipt.logs.find((log) => {
            try {
                const decoded = this.contract.interface.parseLog(log);
                return decoded !== null && decoded.name === "RentalCreated";
            }
            catch {
                return false;
            }
        });
        if (!event)
            throw ERRORS.TRANSACTION_NOT_VERIFIED("Missing RentalCreated event");
        const decoded = this.contract.interface.parseLog(event);
        if (!decoded)
            throw ERRORS.TRANSACTION_NOT_VERIFIED("Unable to decode RentalCreated event");
        return decoded.args;
    }
    async decodeRentalCompleted(txHash) {
        const receipt = await this.getReceipt(txHash);
        const event = receipt.logs.find((log) => {
            try {
                const decoded = this.contract.interface.parseLog(log);
                return decoded !== null && decoded.name === "RentalCompleted";
            }
            catch {
                return false;
            }
        });
        if (!event)
            throw ERRORS.TRANSACTION_NOT_VERIFIED("Missing RentalCompleted event");
        const decoded = this.contract.interface.parseLog(event);
        if (!decoded)
            throw ERRORS.TRANSACTION_NOT_VERIFIED("Unable to decode RentalCompleted event");
        return decoded.args;
    }
    async decodeActivityHashRecorded(txHash) {
        const receipt = await this.getReceipt(txHash);
        const event = receipt.logs.find((log) => {
            try {
                const decoded = this.contract.interface.parseLog(log);
                return decoded !== null && decoded.name === "ActivityHashRecorded";
            }
            catch {
                return false;
            }
        });
        if (!event)
            throw ERRORS.TRANSACTION_NOT_VERIFIED("Missing ActivityHashRecorded event");
        const decoded = this.contract.interface.parseLog(event);
        if (!decoded)
            throw ERRORS.TRANSACTION_NOT_VERIFIED("Unable to decode ActivityHashRecorded event");
        return decoded.args;
    }
}
export const transactionService = new TransactionService();
