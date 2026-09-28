import { PrismaClient } from "@prisma/client";

import { blockchainService } from "../services/blockchain.service.js";

const prisma = new PrismaClient();

export async function startExpiryJob() {
  const check = async () => {
    try {
      const rentals = await prisma.rentalSnapshot.findMany({ where: { active: true } });
      for (const rental of rentals) {
        const chainRental = await blockchainService.getRental(rental.orderId);
        if (!chainRental.active || chainRental.completed) continue;
        const now = BigInt(Math.floor(Date.now() / 1000));
        if (now >= chainRental.endTime) {
          // owner wallet logic is expected to be implemented in admin route; expiry job remains a hook.
        }
      }
    } catch (error) {
      console.error("Expiry job failed", error);
    }
  };

  await check();
  setInterval(check, 10000);
}
