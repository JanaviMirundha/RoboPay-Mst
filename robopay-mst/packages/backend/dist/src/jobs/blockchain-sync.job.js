import { eventIndexerService } from "../services/event-indexer.service.js";
import { env } from "../config/env.js";
export async function startBlockchainSyncJob(log = console.error) {
    let running = false;
    const sync = async () => {
        if (running)
            return;
        running = true;
        try {
            const result = await eventIndexerService.sync();
            if (result.synced > 0)
                log(`Indexed ${result.synced} MST escrow events through block ${result.processedThrough}.`);
        }
        catch (error) {
            log("MST blockchain sync failed; checkpoint preserved for retry.", error);
        }
        finally {
            running = false;
        }
    };
    void sync();
    const timer = setInterval(() => void sync(), env.SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
}
