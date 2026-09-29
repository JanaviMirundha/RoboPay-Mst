import { Contract, JsonRpcProvider, Wallet, getAddress, type InterfaceAbi } from "ethers";
import { activeDeployment } from "../config/contracts.js";
import { env } from "../config/env.js";
import { ERRORS } from "../utils/errors.js";

const ABI: InterfaceAbi = activeDeployment.abi;
const ACTIVE_CONTRACT_ADDRESS = getAddress(activeDeployment.address);

export type OnChainRental = {
  orderId: string;
  robotId: string;
  service: string;
  durationMinutes: number;
  amountInr: number;
  amountPaidWei: string;
  customer: string;
  startTime: bigint;
  endTime: bigint;
  status: number;
  statusLabel: "ACTIVE" | "COMPLETED" | "REFUNDED" | "UNKNOWN";
  active: boolean;
  completed: boolean;
  refunded: boolean;
  rentalDataHash: string;
  activityHash: string;
  failureReasonHash: string;
  settledAt: bigint;
  escrowedAmountWei: string | null;
};

export class BlockchainService {
  readonly provider: JsonRpcProvider;
  readonly contract: Contract;

  constructor() {
    this.provider = new JsonRpcProvider(env.MST_RPC_URL);
    this.contract = new Contract(ACTIVE_CONTRACT_ADDRESS, ABI, this.provider);
  }

  get address() {
    return ACTIVE_CONTRACT_ADDRESS;
  }

  hasFunction(name: string) {
    try {
      return this.contract.interface.getFunction(name) !== null;
    } catch {
      return false;
    }
  }

  async validateConnection() {
    const network = await this.provider.getNetwork();
    if (Number(network.chainId) !== 91562037 || env.MST_CHAIN_ID !== 91562037) {
      throw ERRORS.WRONG_NETWORK(`Expected chain ID ${env.MST_CHAIN_ID}, got ${network.chainId}`);
    }
    if ((await this.provider.getCode(ACTIVE_CONTRACT_ADDRESS)) === "0x") {
      throw ERRORS.BLOCKCHAIN_ERROR("Contract address does not exist on MST Testnet");
    }
    const owner = this.hasFunction("owner") ? await this.getOwner() : null;
    let operatorAddress: string | null = null;
    if (env.ROBO_PAY_OPERATOR_PRIVATE_KEY) {
      operatorAddress = new Wallet(env.ROBO_PAY_OPERATOR_PRIVATE_KEY).address;
      if (!owner || operatorAddress.toLowerCase() !== owner.toLowerCase()) {
        throw ERRORS.OWNER_WALLET_MISMATCH("Configured operator key does not control the active contract.");
      }
    }
    return {
      network: "MST Testnet",
      chainId: Number(network.chainId),
      contract: ACTIVE_CONTRACT_ADDRESS,
      owner,
      operatorAuthorized: Boolean(operatorAddress && owner && operatorAddress.toLowerCase() === owner.toLowerCase()),
      capabilities: {
        settlement: this.hasFunction("settleRental"),
        refund: this.hasFunction("refundRental"),
        activityAnchor: this.hasFunction("recordActivityHash"),
        rentalEnd: this.hasFunction("endRental"),
      },
    };
  }

  async getOwner() {
    if (!this.hasFunction("owner")) throw ERRORS.ESCROW_NOT_SUPPORTED("Active contract does not expose owner().");
    return this.contract.owner();
  }

  async getRobot(robotId: string) {
    if (!this.hasFunction("getRobot")) throw ERRORS.BLOCKCHAIN_ERROR("Active contract does not expose getRobot().");
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

  async getRental(orderId: string) {
    if (!this.hasFunction("getRental")) throw ERRORS.BLOCKCHAIN_ERROR("Active contract does not expose getRental().");
    const data = await this.contract.getRental(orderId);
    const status = Number(data.status ?? data[9]);
    const statusLabel = status === 0 ? "ACTIVE" : status === 1 ? "COMPLETED" : status === 2 ? "REFUNDED" : "UNKNOWN";
    const escrowedAmountWei = this.hasFunction("escrowedAmount")
      ? (await this.contract.escrowedAmount(orderId)).toString()
      : null;
    return {
      orderId: String(data.orderId ?? data[0]),
      robotId: String(data.robotId ?? data[1]),
      service: String(data.service ?? data[2]),
      durationMinutes: Number(data.durationMinutes ?? data[3]),
      amountInr: Number(data.amountInr ?? data[4]),
      amountPaidWei: (data.amountPaidWei ?? data[5]).toString(),
      customer: String(data.customer ?? data[6]),
      startTime: BigInt(data.startTime ?? data[7]),
      endTime: BigInt(data.endTime ?? data[8]),
      status,
      statusLabel,
      active: status === 0,
      completed: status === 1,
      refunded: status === 2,
      rentalDataHash: String(data.rentalDataHash ?? data[10]),
      activityHash: String(data.activityHash ?? data[11]),
      failureReasonHash: String(data.failureReasonHash ?? data[12]),
      settledAt: BigInt(data.settledAt ?? data[13] ?? 0),
      escrowedAmountWei,
    } satisfies OnChainRental;
  }

  async getRobotIds() {
    return this.contract.getRobotIds();
  }

  async getRentalOrderIds() {
    return this.contract.getRentalOrderIds();
  }

  async requiredAmountInr(robotId: string, durationMinutes: number) {
    if (!this.hasFunction("requiredAmountInr")) throw ERRORS.BLOCKCHAIN_ERROR("Active contract does not expose requiredAmountInr().");
    return Number(await this.contract.requiredAmountInr(robotId, durationMinutes));
  }

  async requiredPayment(robotId: string, durationMinutes: number) {
    if (!this.hasFunction("requiredPayment")) throw ERRORS.BLOCKCHAIN_ERROR("Active contract does not expose requiredPayment().");
    return (await this.contract.requiredPayment(robotId, durationMinutes)).toString();
  }

  async verifyActivityHash(orderId: string, currentHash: string) {
    if (!this.hasFunction("verifyActivityHash")) throw ERRORS.BLOCKCHAIN_ERROR("Active contract does not expose verifyActivityHash().");
    return this.contract.verifyActivityHash(orderId, currentHash);
  }

  async verifyRentalDataHash(orderId: string, currentHash: string) {
    if (!this.hasFunction("verifyRentalDataHash")) throw ERRORS.BLOCKCHAIN_ERROR("Active contract does not expose verifyRentalDataHash().");
    return this.contract.verifyRentalDataHash(orderId, currentHash);
  }

  async orderExists(orderId: string) {
    if (!this.hasFunction("orderExists")) return this.hasFunction("getRental") ? this.contract.getRental(orderId).then(() => true, () => false) : false;
    return this.contract.orderExists(orderId);
  }

  async contractBalance() {
    return (await this.provider.getBalance(ACTIVE_CONTRACT_ADDRESS)).toString();
  }

  async getCurrentBlock() {
    return this.provider.getBlockNumber();
  }

  async getBlock(blockNumber: number) {
    return this.provider.getBlock(blockNumber);
  }

  async getTransaction(transactionHash: string) {
    return this.provider.getTransaction(transactionHash);
  }

  async getReceipt(transactionHash: string) {
    return this.provider.getTransactionReceipt(transactionHash);
  }

  async getLogs(fromBlock: number, toBlock: number) {
    return this.provider.getLogs({ address: ACTIVE_CONTRACT_ADDRESS, fromBlock, toBlock });
  }

  async requireOperatorOwner() {
    if (!env.ROBO_PAY_OPERATOR_PRIVATE_KEY) throw ERRORS.FORBIDDEN("Operator signer is not configured.");
    const signer = new Wallet(env.ROBO_PAY_OPERATOR_PRIVATE_KEY, this.provider);
    const owner = await this.getOwner();
    if (signer.address.toLowerCase() !== owner.toLowerCase()) throw ERRORS.OWNER_WALLET_MISMATCH();
    return signer;
  }

  hasOperatorSigner() {
    return Boolean(env.ROBO_PAY_OPERATOR_PRIVATE_KEY);
  }

  async operatorCall(
    functionName: "recordActivityHash" | "settleRental" | "refundRental",
    args: readonly unknown[],
    onSubmitted?: (transactionHash: string) => Promise<void>,
  ) {
    if (!this.hasFunction(functionName)) throw ERRORS.ESCROW_NOT_SUPPORTED(`Active contract ABI does not expose ${functionName}().`);
    const signer = await this.requireOperatorOwner();
    const data = this.contract.interface.encodeFunctionData(functionName, [...args]);
    const tx = await signer.sendTransaction({ to: ACTIVE_CONTRACT_ADDRESS, data });
    await onSubmitted?.(tx.hash);
    const receipt = await tx.wait(env.BLOCK_CONFIRMATIONS);
    if (!receipt || receipt.status !== 1) throw ERRORS.TRANSACTION_FAILED(`${functionName} transaction did not succeed.`);

    if (functionName === "settleRental") {
      const orderId = String(args[0]);
      const rental = await this.getRental(orderId);
      const owner = await this.getOwner();
      const recipient = this.hasFunction("paymentRecipient") ? await this.contract.paymentRecipient() as string : "";
      const payout = receipt.logs
        .filter((log) => log.address.toLowerCase() === ACTIVE_CONTRACT_ADDRESS.toLowerCase())
        .map((log) => this.contract.interface.parseLog(log))
        .find((event) => event?.name === "RentalSettled" && event.args[0] === orderId);
      if (
        !payout ||
        !recipient ||
        recipient.toLowerCase() !== owner.toLowerCase() ||
        String(payout.args[2]).toLowerCase() !== recipient.toLowerCase() ||
        BigInt(payout.args[3]) !== BigInt(rental.amountPaidWei) ||
        rental.status !== 1 ||
        rental.escrowedAmountWei !== "0"
      ) {
        throw ERRORS.TRANSACTION_NOT_VERIFIED("Settlement receipt did not prove the configured admin payout and finalized escrow state.");
      }
    }

    if (functionName === "refundRental") {
      const orderId = String(args[0]);
      const failureReasonHash = String(args[1]).toLowerCase();
      const rental = await this.getRental(orderId);
      const refund = receipt.logs
        .filter((log) => log.address.toLowerCase() === ACTIVE_CONTRACT_ADDRESS.toLowerCase())
        .map((log) => this.contract.interface.parseLog(log))
        .find((event) => event?.name === "RentalRefunded" && event.args[0] === orderId);
      if (
        !refund ||
        String(refund.args[2]).toLowerCase() !== rental.customer.toLowerCase() ||
        BigInt(refund.args[3]) !== BigInt(rental.amountPaidWei) ||
        String(refund.args[4]).toLowerCase() !== failureReasonHash ||
        rental.status !== 2 ||
        rental.escrowedAmountWei !== "0"
      ) {
        throw ERRORS.TRANSACTION_NOT_VERIFIED("Refund receipt did not prove the original customer payout and finalized escrow state.");
      }
    }

    return { transactionHash: receipt.hash, blockNumber: receipt.blockNumber };
  }
}

export const blockchainService = new BlockchainService();
