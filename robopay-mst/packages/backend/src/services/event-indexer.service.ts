import { Prisma } from "@prisma/client";
import { keccak256, toUtf8Bytes } from "ethers";
import { prisma } from "../database.js";
import { env } from "../config/env.js";
import { blockchainService } from "./blockchain.service.js";
import { rentalService } from "./rental.service.js";
import { robotService } from "./robot.service.js";

const INDEXED_EVENTS = new Set([
  "RobotRegistered",
  "RobotAvailabilityChanged",
  "RentalCreated",
  "ActivityHashRecorded",
  "RentalSettled",
  "RentalCompleted",
  "RentalRefunded",
]);

function getOrderId(args: Record<string, unknown> | readonly unknown[], indexedOrderIds: ReadonlyMap<string, string>) {
  if (Array.isArray(args) && typeof args[0] === "string") return args[0];
  const value = (args as Record<string, unknown>).orderId;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "hash" in value) {
    const hash = (value as { hash: string }).hash.toLowerCase();
    return indexedOrderIds.get(hash) ?? null;
  }
  return null;
}

export class EventIndexerService {
  private syncing = false;

  async sync() {
    if (this.syncing) return { synced: 0, reason: "SYNC_ALREADY_RUNNING" };
    this.syncing = true;
    try {
      const currentBlock = await blockchainService.getCurrentBlock();
      const latest = currentBlock - env.BLOCK_CONFIRMATIONS;
      if (latest < 0) return { synced: 0, currentBlock };

      let state = await prisma.syncState.findUnique({ where: { id: "blockchain" } });
      if (!state) {
        const initialBlock = env.SYNC_START_BLOCK ?? 0;
        const initialBlockData = initialBlock > 0 ? await blockchainService.getBlock(initialBlock) : null;
        state = await prisma.syncState.create({
          data: { id: "blockchain", lastProcessedBlock: Math.max(0, initialBlock - 1), lastProcessedHash: initialBlockData?.hash ?? null },
        });
      }

      if (state.lastProcessedBlock > 0 && state.lastProcessedHash) {
        const checkpointBlock = await blockchainService.getBlock(state.lastProcessedBlock);
        if (!checkpointBlock || checkpointBlock.hash !== state.lastProcessedHash) {
          const rewindBlock = Math.max(0, state.lastProcessedBlock - 1);
          const orphanedEvents = await prisma.blockchainEvent.findMany({
            where: { blockNumber: { gt: rewindBlock } },
            select: { txHash: true },
            distinct: ["txHash"],
          });
          await prisma.$transaction(async (transaction) => {
            await transaction.blockchainEvent.deleteMany({ where: { blockNumber: { gt: rewindBlock } } });
            if (orphanedEvents.length > 0) {
              await transaction.transactionRecord.deleteMany({ where: { txHash: { in: orphanedEvents.map((event) => event.txHash) } } });
            }
            await transaction.syncState.update({ where: { id: "blockchain" }, data: { lastProcessedBlock: rewindBlock, lastProcessedHash: null } });
          });
          const canonicalOrderIds = await blockchainService.getRentalOrderIds() as string[];
          await prisma.rentalSnapshot.deleteMany({ where: { orderId: { notIn: canonicalOrderIds } } });
          state = { ...state, lastProcessedBlock: rewindBlock, lastProcessedHash: null };
        }
      }

      let synced = 0;
      const knownOrderIds = await blockchainService.getRentalOrderIds() as string[];
      const indexedOrderIds = new Map(knownOrderIds.map((orderId) => [keccak256(toUtf8Bytes(orderId)).toLowerCase(), orderId]));
      for (let fromBlock = state.lastProcessedBlock + 1; fromBlock <= latest; fromBlock += env.BLOCK_BATCH_SIZE) {
        const toBlock = Math.min(fromBlock + env.BLOCK_BATCH_SIZE - 1, latest);
        const logs = await blockchainService.getLogs(fromBlock, toBlock);
        const blocks = new Map<number, Date>();

        for (const log of logs) {
          const parsed = blockchainService.contract.interface.parseLog(log);
          if (!parsed || !INDEXED_EVENTS.has(parsed.name)) continue;
          const blockNumber = log.blockNumber ?? fromBlock;
          let timestamp = blocks.get(blockNumber);
          if (!timestamp) {
            const block = await blockchainService.getBlock(blockNumber);
            timestamp = new Date(Number(block?.timestamp ?? 0) * 1000);
            blocks.set(blockNumber, timestamp);
          }
          const eventKey = `${log.transactionHash}:${log.index}`;
          const orderId = getOrderId(parsed.args, indexedOrderIds);
          await prisma.blockchainEvent.upsert({
            where: { eventKey },
            update: { processed: true },
            create: {
              txHash: log.transactionHash,
              logIndex: log.index,
              eventKey,
              blockNumber,
              blockHash: log.blockHash,
              blockTimestamp: timestamp,
              contractAddress: log.address,
              eventName: parsed.name,
              eventDataJson: JSON.stringify(parsed.args),
              processed: true,
            },
          });

          const transaction = await blockchainService.getTransaction(log.transactionHash);
          if (transaction) {
            const transactionType = parsed.name === "RentalCreated"
              ? "RENTAL"
              : parsed.name === "RentalSettled" || parsed.name === "RentalCompleted"
                ? "SETTLEMENT"
                : parsed.name === "RentalRefunded"
                  ? "REFUND"
                  : parsed.name === "ActivityHashRecorded"
                    ? "AUDIT"
                    : null;
            if (transactionType) {
              await prisma.transactionRecord.upsert({
                where: { txHash: log.transactionHash },
                update: { status: "CONFIRMED", blockNumber },
                create: {
                  txHash: log.transactionHash,
                  orderId,
                  type: transactionType,
                  fromAddress: transaction.from,
                  toAddress: transaction.to,
                  valueWei: transaction.value.toString(),
                  blockNumber,
                  status: "CONFIRMED",
                },
              });
            }
          }

          if (orderId && ["RentalCreated", "ActivityHashRecorded", "RentalSettled", "RentalCompleted", "RentalRefunded"].includes(parsed.name)) {
            try {
              await rentalService.syncRental(orderId, parsed.name === "RentalCreated" ? log.transactionHash : undefined);
            } catch (error) {
              if (!(error instanceof Error) || !/rental does not exist/i.test(error.message)) throw error;
            }
          }
          if (parsed.name === "RobotAvailabilityChanged") {
            const robotIdValue = parsed.args.robotId ?? parsed.args[0];
            if (typeof robotIdValue === "string") await robotService.syncRobot(robotIdValue);
          }
          synced += 1;
        }

        const checkpoint = await blockchainService.getBlock(toBlock);
        await prisma.syncState.upsert({
          where: { id: "blockchain" },
          update: { lastProcessedBlock: toBlock, lastProcessedHash: checkpoint?.hash ?? null },
          create: { id: "blockchain", lastProcessedBlock: toBlock, lastProcessedHash: checkpoint?.hash ?? null },
        });
      }

      return { synced, currentBlock, processedThrough: latest };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        throw new Error(`Database event sync failed (${error.code}).`);
      }
      throw error;
    } finally {
      this.syncing = false;
    }
  }
}

export const eventIndexerService = new EventIndexerService();