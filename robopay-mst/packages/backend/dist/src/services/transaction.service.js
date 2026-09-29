import { getAddress } from "ethers";
import { blockchainService } from "./blockchain.service.js";
import { prisma } from "../database.js";
import { env } from "../config/env.js";
import { ERRORS } from "../utils/errors.js";
import { sessionService } from "./session.service.js";
export class TransactionService {
    async verifyRentalTransaction(input) {
        const network = await blockchainService.provider.getNetwork();
        if (Number(network.chainId) !== 91562037 || env.MST_CHAIN_ID !== 91562037)
            throw ERRORS.WRONG_NETWORK();
        const [transaction, receipt] = await Promise.all([
            blockchainService.getTransaction(input.transactionHash),
            blockchainService.getReceipt(input.transactionHash),
        ]);
        if (!transaction || !receipt)
            throw ERRORS.TRANSACTION_NOT_FOUND();
        if (receipt.status !== 1)
            throw ERRORS.TRANSACTION_FAILED();
        const currentBlock = await blockchainService.getCurrentBlock();
        if (currentBlock - receipt.blockNumber + 1 < env.BLOCK_CONFIRMATIONS) {
            throw ERRORS.TRANSACTION_NOT_VERIFIED("Rental transaction has not reached the configured confirmation depth.");
        }
        if (!transaction.to || getAddress(transaction.to) !== getAddress(blockchainService.address)) {
            throw ERRORS.TRANSACTION_NOT_VERIFIED("Transaction destination is not the active RoboPayEscrow contract.");
        }
        if (getAddress(transaction.from) !== getAddress(input.customerAddress)) {
            throw ERRORS.INVALID_ADDRESS("Transaction sender does not match the submitted customer address.");
        }
        let parsedTransaction;
        try {
            parsedTransaction = blockchainService.contract.interface.parseTransaction({
                data: transaction.data,
                value: transaction.value,
            });
        }
        catch {
            throw ERRORS.TRANSACTION_NOT_VERIFIED("Unable to decode transaction input with the active RoboPayEscrow ABI.");
        }
        if (!parsedTransaction || parsedTransaction.name !== "rentRobot") {
            throw ERRORS.TRANSACTION_NOT_VERIFIED("Transaction does not call rentRobot().");
        }
        const orderId = String(parsedTransaction.args.orderId ?? parsedTransaction.args[0]);
        if (orderId !== input.orderId)
            throw ERRORS.INVALID_ORDER("Submitted order ID does not match transaction calldata.");
        const rentalEventLog = receipt.logs.find((log) => {
            if (getAddress(log.address) !== getAddress(blockchainService.address))
                return false;
            try {
                return blockchainService.contract.interface.parseLog(log)?.name === "RentalCreated";
            }
            catch {
                return false;
            }
        });
        if (!rentalEventLog)
            throw ERRORS.TRANSACTION_NOT_VERIFIED("Successful receipt has no active-contract RentalCreated event.");
        const rentalEvent = blockchainService.contract.interface.parseLog(rentalEventLog);
        if (!rentalEvent)
            throw ERRORS.TRANSACTION_NOT_VERIFIED("Unable to decode RentalCreated event.");
        const rental = await blockchainService.getRental(orderId);
        const eventArgs = rentalEvent.args;
        const eventOrderId = String(eventArgs.orderId ?? eventArgs[0]);
        const eventRobotId = String(eventArgs.robotId ?? eventArgs[1]);
        const eventCustomer = getAddress(String(eventArgs.customer ?? eventArgs[2]));
        const calldataRobotId = String(parsedTransaction.args.robotId ?? parsedTransaction.args[1]);
        if (eventOrderId !== orderId ||
            eventRobotId !== calldataRobotId ||
            getAddress(rental.customer) !== getAddress(input.customerAddress) ||
            getAddress(rental.customer) !== eventCustomer ||
            rental.robotId !== calldataRobotId ||
            transaction.value.toString() !== rental.amountPaidWei) {
            throw ERRORS.TRANSACTION_NOT_VERIFIED("RentalCreated event, calldata, payment value, and canonical rental state disagree.");
        }
        if (rental.escrowedAmountWei === null) {
            throw ERRORS.ESCROW_NOT_SUPPORTED("Active contract ABI does not expose per-rental escrowedAmount().");
        }
        if (rental.status === 0 && rental.escrowedAmountWei !== rental.amountPaidWei) {
            throw ERRORS.TRANSACTION_NOT_VERIFIED("The active rental does not have its full amount held in escrow.");
        }
        const paymentStatus = rental.status === 0
            ? "ESCROWED"
            : rental.status === 1
                ? "SETTLED"
                : rental.status === 2
                    ? "REFUNDED"
                    : "UNKNOWN";
        const block = await blockchainService.getBlock(receipt.blockNumber);
        await prisma.$transaction([
            prisma.rentalSnapshot.upsert({
                where: { orderId },
                update: {
                    robotId: rental.robotId,
                    customerAddress: getAddress(rental.customer),
                    service: rental.service,
                    durationMinutes: rental.durationMinutes,
                    amountInr: rental.amountInr,
                    amountPaidWei: rental.amountPaidWei,
                    startTime: rental.startTime,
                    endTime: rental.endTime,
                    active: rental.active,
                    completed: rental.completed,
                    status: rental.statusLabel,
                    paymentStatus,
                    rentalDataHash: rental.rentalDataHash,
                    activityHash: rental.activityHash,
                    failureReasonHash: rental.failureReasonHash,
                    settledAt: rental.settledAt,
                    creationTxHash: receipt.hash,
                    lastSyncedBlock: receipt.blockNumber,
                    lastSyncedBlockHash: receipt.blockHash,
                },
                create: {
                    orderId,
                    robotId: rental.robotId,
                    customerAddress: getAddress(rental.customer),
                    service: rental.service,
                    durationMinutes: rental.durationMinutes,
                    amountInr: rental.amountInr,
                    amountPaidWei: rental.amountPaidWei,
                    startTime: rental.startTime,
                    endTime: rental.endTime,
                    active: rental.active,
                    completed: rental.completed,
                    status: rental.statusLabel,
                    paymentStatus,
                    rentalDataHash: rental.rentalDataHash,
                    activityHash: rental.activityHash,
                    failureReasonHash: rental.failureReasonHash,
                    settledAt: rental.settledAt,
                    creationTxHash: receipt.hash,
                    lastSyncedBlock: receipt.blockNumber,
                    lastSyncedBlockHash: receipt.blockHash,
                },
            }),
            prisma.transactionRecord.upsert({
                where: { txHash: receipt.hash },
                update: { orderId, type: "RENTAL", fromAddress: getAddress(transaction.from), toAddress: getAddress(transaction.to), valueWei: transaction.value.toString(), blockNumber: receipt.blockNumber, status: "CONFIRMED" },
                create: { txHash: receipt.hash, orderId, type: "RENTAL", fromAddress: getAddress(transaction.from), toAddress: getAddress(transaction.to), valueWei: transaction.value.toString(), blockNumber: receipt.blockNumber, status: "CONFIRMED" },
            }),
            prisma.blockchainEvent.upsert({
                where: { eventKey: `${receipt.hash}:${rentalEventLog.index}` },
                update: { processed: true },
                create: {
                    txHash: receipt.hash,
                    logIndex: rentalEventLog.index,
                    eventKey: `${receipt.hash}:${rentalEventLog.index}`,
                    blockNumber: receipt.blockNumber,
                    blockHash: receipt.blockHash,
                    blockTimestamp: new Date(Number(block?.timestamp ?? 0) * 1000),
                    contractAddress: blockchainService.address,
                    eventName: rentalEvent.name,
                    eventDataJson: JSON.stringify({ orderId, robotId: rental.robotId, customer: rental.customer, amountPaidWei: rental.amountPaidWei }),
                    processed: true,
                },
            }),
        ]);
        await sessionService.ensureDemoSession(rental);
        return {
            verified: true,
            orderId,
            transactionHash: receipt.hash,
            robotId: rental.robotId,
            customerAddress: getAddress(rental.customer),
            status: rental.statusLabel,
            paymentStatus,
            amountPaidWei: rental.amountPaidWei,
            escrowedAmountWei: rental.escrowedAmountWei,
            blockNumber: receipt.blockNumber,
            blockTimestamp: Number(block?.timestamp ?? 0),
        };
    }
}
export const transactionService = new TransactionService();
