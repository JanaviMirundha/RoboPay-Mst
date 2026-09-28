import { JsonRpcProvider, Contract } from "ethers";
import { deployments } from "../config/contracts.js";
import { env } from "../config/env.js";
import { ERRORS } from "../utils/errors.js";
const ABI = deployments.testnet?.RoboPay?.abi ?? [];
export class BlockchainService {
    provider;
    contract;
    constructor() {
        this.provider = new JsonRpcProvider(env.MST_RPC_URL);
        this.contract = new Contract(env.ROBO_PAY_CONTRACT_ADDRESS, ABI, this.provider);
    }
    async validateConnection() {
        const network = await this.provider.getNetwork();
        if (Number(network.chainId) !== env.MST_CHAIN_ID) {
            throw ERRORS.WRONG_NETWORK(`Expected chain ID ${env.MST_CHAIN_ID}, got ${network.chainId}`);
        }
        if ((await this.provider.getCode(env.ROBO_PAY_CONTRACT_ADDRESS)) === "0x") {
            throw ERRORS.BLOCKCHAIN_ERROR("Contract address does not exist on MST Testnet");
        }
        return { network: "MST Testnet", chainId: Number(network.chainId), contract: env.ROBO_PAY_CONTRACT_ADDRESS };
    }
    async getOwner() {
        return this.contract.owner();
    }
    async getRobot(robotId) {
        const data = await this.contract.getRobot(robotId);
        return {
            robotId: data[0],
            name: data[1],
            service: data[2],
            robotOwner: data[3],
            status: Number(data[4]),
            registered: Boolean(data[5]),
        };
    }
    async getRental(orderId) {
        const data = await this.contract.getRental(orderId);
        return {
            orderId: data[0],
            robotId: data[1],
            service: data[2],
            durationMinutes: Number(data[3]),
            amountInr: Number(data[4]),
            amountPaidWei: data[5].toString(),
            customer: data[6],
            startTime: BigInt(data[7]),
            endTime: BigInt(data[8]),
            active: Boolean(data[9]),
            completed: Boolean(data[10]),
            activityHash: data[11],
            rentalDataHash: data[12],
        };
    }
    async getRobotIds() {
        return this.contract.getRobotIds();
    }
    async getRentalOrderIds() {
        return this.contract.getRentalOrderIds();
    }
    async requiredAmountInr(robotId, durationMinutes) {
        return Number(await this.contract.requiredAmountInr(robotId, durationMinutes));
    }
    async requiredPayment(robotId, durationMinutes) {
        return (await this.contract.requiredPayment(robotId, durationMinutes)).toString();
    }
    async verifyActivityHash(orderId, currentHash) {
        return this.contract.verifyActivityHash(orderId, currentHash);
    }
    async verifyRentalDataHash(orderId, currentHash) {
        return this.contract.verifyRentalDataHash(orderId, currentHash);
    }
    async orderExists(orderId) {
        return this.contract.orderExists(orderId);
    }
    async contractBalance() {
        return (await this.contract.contractBalance()).toString();
    }
    async getCurrentBlock() {
        return this.provider.getBlockNumber();
    }
}
export const blockchainService = new BlockchainService();
