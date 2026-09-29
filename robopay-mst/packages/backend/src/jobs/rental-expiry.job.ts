import { prisma } from "../database.js";
import { env } from "../config/env.js";
import { blockchainService } from "../services/blockchain.service.js";
import { rentalService } from "../services/rental.service.js";
import { auditService } from "../services/audit.service.js";
import { determineSessionOutcome, verifyFailureEvidence } from "../services/session-outcome.js";
import { sessionService } from "../services/session.service.js";

async function recordFinalizationState(orderId: string, robotId: string, eventType: "AUTO_SETTLEMENT" | "AUTO_REFUND", state: "SUBMITTING" | "RETRY_PENDING" | "CONFIRMED") {
  const existing = await prisma.activityAudit.findFirst({ where: { orderId, eventType } });
  const data = {
    payloadJson: JSON.stringify({ state }),
    timestamp: new Date(),
    blockchainAnchored: false,
    status: state,
  };
  if (existing) {
    await prisma.activityAudit.update({ where: { id: existing.id }, data });
    return;
  }
  await prisma.activityAudit.create({ data: { orderId, robotId, eventType, ...data } });
}

export async function runExpiryCheck(log: (message: string, error?: unknown) => void = console.error) {
  try {
    const orderIds = await blockchainService.getRentalOrderIds() as string[];
    for (const orderId of orderIds) {
      try {
        let rental = await blockchainService.getRental(orderId);
        await rentalService.syncRental(orderId);
        if (await auditService.reconcilePendingOperatorTransaction(orderId)) continue;
        rental = await blockchainService.getRental(orderId);
        await rentalService.syncRental(orderId);
        if (!rental.active) continue;

        let session = await prisma.robotSession.findFirst({ where: { orderId } });
        const failures = await prisma.failureEvidence.findMany({
          where: { orderId, status: "VERIFIED_FAILURE", robotId: rental.robotId },
          orderBy: { createdAt: "asc" },
        });
        const verifiedFailure = failures.find((item) => verifyFailureEvidence({
          evidence: item,
          orderId,
          robotId: rental.robotId,
          customerAddress: rental.customer,
          sessionStatus: session?.status,
        }));
        if (!verifiedFailure) {
          await sessionService.advanceDemoSession(rental);
          session = await prisma.robotSession.findFirst({ where: { orderId } });
        }
        const telemetry = session
          ? await prisma.robotTelemetry.findMany({ where: { sessionId: session.id }, orderBy: [{ timestamp: "asc" }, { id: "asc" }] })
          : [];
        const outcome = determineSessionOutcome({
          session,
          telemetry,
          rentalStartTime: rental.startTime,
          rentalEndTime: rental.endTime,
          now: BigInt(Math.floor(Date.now() / 1000)),
          verifiedFailure: Boolean(verifiedFailure),
        });
        if (outcome !== "FAILURE" && rental.endTime > BigInt(Math.floor(Date.now() / 1000))) continue;

        if (outcome === "SUCCESS") {
          await recordFinalizationState(orderId, rental.robotId, "AUTO_SETTLEMENT", "SUBMITTING");
          try {
            if (session && session.status !== "SUCCESS") await prisma.robotSession.update({ where: { id: session.id }, data: { status: "SUCCESS" } });
            if (/^0x0{64}$/i.test(rental.activityHash)) await auditService.anchorActivityHash(orderId);
            await auditService.settleRental(orderId);
            await recordFinalizationState(orderId, rental.robotId, "AUTO_SETTLEMENT", "CONFIRMED");
            log(`Rental ${orderId} settled after verified session SUCCESS and MST Testnet confirmation.`);
          } catch (error) {
            await recordFinalizationState(orderId, rental.robotId, "AUTO_SETTLEMENT", "RETRY_PENDING");
            log(`Settlement retry pending for rental ${orderId}; chain state will be re-read before retry.`, error);
          }
          continue;
        }

        if (outcome === "FAILURE" && verifiedFailure) {
          await recordFinalizationState(orderId, rental.robotId, "AUTO_REFUND", "SUBMITTING");
          try {
            if (/^0x0{64}$/i.test(rental.activityHash)) await auditService.anchorActivityHash(orderId);
            await auditService.refundRental(orderId, verifiedFailure.id);
            await recordFinalizationState(orderId, rental.robotId, "AUTO_REFUND", "CONFIRMED");
            log(`Rental ${orderId} refunded after verified robot FAILURE and MST Testnet confirmation.`);
          } catch (error) {
            await recordFinalizationState(orderId, rental.robotId, "AUTO_REFUND", "RETRY_PENDING");
            log(`Refund retry pending for rental ${orderId}; chain state will be re-read before retry.`, error);
          }
          continue;
        }

        const existing = await prisma.activityAudit.findFirst({ where: { orderId, eventType: "OUTCOME_REVIEW_REQUIRED" } });
        if (!existing) {
          await prisma.activityAudit.create({
            data: {
              orderId,
              robotId: rental.robotId,
              eventType: "OUTCOME_REVIEW_REQUIRED",
              payloadJson: JSON.stringify({ status: "UNKNOWN", reason: "Session evidence is missing, incomplete, inconsistent, or not verified." }),
              timestamp: new Date(),
              blockchainAnchored: false,
              status: "DATA_UNAVAILABLE",
            },
          });
        }
        log(`Expired rental ${orderId} remains ACTIVE and escrowed: outcome is UNKNOWN.`);
      } catch (error) {
        log(`Finalization for rental ${orderId} failed and will be retried after chain state is re-read.`, error);
      }
    }
  } catch (error) {
    log("Rental expiry review failed; no on-chain state was changed.", error);
  }
}

export async function startExpiryJob(log: (message: string, error?: unknown) => void = console.error) {
  let running = false;
  const check = async () => {
    if (running) return;
    running = true;
    try {
      await runExpiryCheck(log);
    } finally {
      running = false;
    }
  };

  void check();
  const timer = setInterval(() => void check(), env.EXPIRY_CHECK_INTERVAL_MS);
  return () => clearInterval(timer);
}