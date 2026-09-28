import { eventIndexerService } from "../services/event-indexer.service.js";

export async function startBlockchainSyncJob() {
  const sync = async () => {
    try {
      await eventIndexerService.sync();
    } catch (error) {
      console.error("Blockchain sync failed", error);
    }
  };

  await sync();
  setInterval(sync, 5000);
}
