import { PrismaClient } from "@prisma/client";

import { env } from "../config/env.js";
import { blockchainService } from "./blockchain.service.js";

const prisma = new PrismaClient();

export class EventIndexerService {
  async sync() {
    const currentBlock = await blockchainService.getCurrentBlock();
    const state = await prisma.syncState.findFirst();
    const fromBlock = state ? state.lastProcessedBlock + 1 : 0;

    if (fromBlock >= currentBlock) return { synced: 0, currentBlock };

    const latest = currentBlock;

    for (let blockNumber = fromBlock; blockNumber <= latest; blockNumber += env.BLOCK_BATCH_SIZE) {
      const end = Math.min(blockNumber + env.BLOCK_BATCH_SIZE - 1, latest);
      const logs = await blockchainService.provider.getLogs({
        fromBlock: blockNumber,
        toBlock: end,
        address: env.ROBO_PAY_CONTRACT_ADDRESS,
      });

      for (const log of logs) {
        const parsed = blockchainService.contract.interface.parseLog(log);
        if (!parsed) continue;

        await prisma.blockchainEvent.upsert({
          where: { txHash: log.transactionHash },
          update: {
            processed: true,
          },
          create: {
            txHash: log.transactionHash,
            blockNumber: Number(log.blockNumber),
            blockTimestamp: new Date(Number((await blockchainService.provider.getBlock(log.blockNumber ?? 0))?.timestamp ?? 0) * 1000),
            contractAddress: log.address,
            eventName: parsed.name,
            eventDataJson: JSON.stringify(parsed.args),
            processed: true,
          },
        });
      }
    }

    await prisma.syncState.upsert({
      where: { id: "blockchain" },
      update: { lastProcessedBlock: latest },
      create: { id: "blockchain", lastProcessedBlock: latest },
    });

    return { synced: latest - fromBlock + 1, currentBlock: latest };
  }
}

export const eventIndexerService = new EventIndexerService();
