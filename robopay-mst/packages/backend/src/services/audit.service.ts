import { prisma } from "../database.js";
import { blockchainService } from "./blockchain.service.js";
import { rentalService } from "./rental.service.js";
import { sha256StableBytes32 } from "../utils/hash.js";
import { ERRORS } from "../utils/errors.js";
import { determineSessionOutcome, verifyFailureEvidence, verifySuccessfulSession } from "./session-outcome.js";
import { env } from "../config/env.js";

const ADMIN_ADDRESS = "0xa2f79Ec629674fFbC1814F93a89BfF06aDe01661";

export class AuditService {
  async reviewFailureEvidence(evidenceId: string, status: "INVESTIGATING" | "VERIFIED_FAILURE" | "REJECTED") {
    const evidence = await prisma.failureEvidence.findUnique({ where: { id: evidenceId } });
    if (!evidence) throw ERRORS.NOT_FOUND("Failure evidence not found.");
    if (status === "VERIFIED_FAILURE") {
      const rental = await blockchainService.getRental(evidence.orderId);
      const session = await prisma.robotSession.findFirst({ where: { orderId: evidence.orderId } });
      if (!rental.active || !verifyFailureEvidence({ evidence: { ...evidence, status: "VERIFIED_FAILURE" }, orderId: evidence.orderId, robotId: rental.robotId, customerAddress: rental.customer, sessionStatus: session?.status })) {
        throw ERRORS.REFUND_NOT_ALLOWED("Rental or failure evidence no longer qualifies for operator validation.");
      }
    }
    return prisma.failureEvidence.update({
      where: { id: evidenceId },
      data: { status, reviewedAt: new Date(), reviewedBy: await blockchainService.getOwner() },
    });
  }

  async getAudit(orderId: string) {
    const rental = await blockchainService.getRental(orderId);
    const session = await prisma.robotSession.findFirst({ where: { orderId } });
    const evidence = await prisma.failureEvidence.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } });
    const zeroHash = /^0x0{64}$/i;
    const activityStatus = zeroHash.test(rental.activityHash)
      ? "NOT_ANCHORED"
      : session?.sessionDataJson
        ? (await import("./verification.service.js")).verificationService.verifyActivity(orderId).then((value) => value.status)
        : "DATA_UNAVAILABLE";
    return {
      orderId,
      rentalStatus: rental.statusLabel,
      paymentStatus: rental.status === 0 ? "ESCROWED" : rental.status === 1 ? "SETTLED" : rental.status === 2 ? "REFUNDED" : "UNKNOWN",
      activityHash: rental.activityHash,
      activityStatus: await activityStatus,
      failureReasonHash: rental.failureReasonHash,
      failureEvidence: evidence.map((item) => ({ id: item.id, type: item.failureType, hash: item.evidenceHash, status: item.status, createdAt: item.createdAt.toISOString() })),
      session: session ? { id: session.id, status: session.status, startedAt: session.startedAt?.toISOString() ?? null, endedAt: session.endedAt?.toISOString() ?? null } : null,
    };
  }

  async getAuditHistory(orderId: string) {
    const [events, audits, evidence] = await Promise.all([
      prisma.blockchainEvent.findMany({ where: { eventDataJson: { contains: orderId } }, orderBy: { blockNumber: "asc" } }),
      prisma.activityAudit.findMany({ where: { orderId }, orderBy: { timestamp: "asc" } }),
      prisma.failureEvidence.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } }),
    ]);
    return { orderId, events, audits, evidence };
  }

  async anchorActivityHash(orderId: string) {
    if (!blockchainService.hasFunction("recordActivityHash")) throw ERRORS.ESCROW_NOT_SUPPORTED("Active contract ABI does not expose recordActivityHash().");
    const rental = await blockchainService.getRental(orderId);
    if (!rental.active) throw ERRORS.RENTAL_NOT_ACTIVE();
    const session = await prisma.robotSession.findFirst({ where: { orderId } });
    if (!session?.sessionDataJson) throw ERRORS.DATA_UNAVAILABLE("Session evidence is not available for anchoring.");
    const activityHash = sha256StableBytes32(JSON.parse(session.sessionDataJson) as unknown);
    if (!/^0x[0-9a-fA-F]{64}$/.test(activityHash) || /^0x0{64}$/i.test(activityHash)) throw ERRORS.INVALID_REQUEST("Invalid activity hash.");
    if (session.activityHash?.toLowerCase() !== activityHash.toLowerCase() || session.sessionDataHash?.toLowerCase() !== activityHash.toLowerCase()) {
      throw ERRORS.TRANSACTION_NOT_VERIFIED("Stored session hashes do not match deterministic session data.");
    }
    if (!/^0x0{64}$/i.test(rental.activityHash)) {
      if (rental.activityHash.toLowerCase() !== activityHash.toLowerCase()) throw ERRORS.TRANSACTION_NOT_VERIFIED("On-chain activity hash conflicts with the session evidence.");
      return { orderId, activityHash, anchorTxHash: session.anchorTxHash, status: "ANCHORED" };
    }
    const result = await blockchainService.operatorCall("recordActivityHash", [orderId, activityHash], async (transactionHash) => {
      await prisma.transactionRecord.upsert({
        where: { txHash: transactionHash },
        update: { status: "PENDING" },
        create: { txHash: transactionHash, orderId, type: "ACTIVITY_ANCHOR", fromAddress: await blockchainService.getOwner(), toAddress: blockchainService.address, valueWei: "0", status: "PENDING" },
      });
    });
    const refreshed = await blockchainService.getRental(orderId);
    if (refreshed.activityHash.toLowerCase() !== activityHash.toLowerCase()) throw ERRORS.TRANSACTION_NOT_VERIFIED("Activity hash transaction confirmed but rental state did not update.");
    await prisma.robotSession.update({ where: { id: session.id }, data: { activityHash, sessionDataHash: activityHash, hashAnchored: true, anchorTxHash: result.transactionHash, auditStatus: "ANCHORED" } });
    await prisma.transactionRecord.upsert({ where: { txHash: result.transactionHash }, update: { status: "CONFIRMED", blockNumber: result.blockNumber }, create: { txHash: result.transactionHash, orderId, type: "ACTIVITY_ANCHOR", fromAddress: await blockchainService.getOwner(), toAddress: blockchainService.address, valueWei: "0", blockNumber: result.blockNumber, status: "CONFIRMED" } });
    await prisma.activityAudit.create({ data: { orderId, robotId: rental.robotId, eventType: "ACTIVITY_HASH_RECORDED", payloadHash: activityHash, timestamp: new Date(), blockchainAnchored: true, anchorTxHash: result.transactionHash, status: "ANCHORED" } });
    await rentalService.syncRental(orderId);
    return { orderId, activityHash, anchorTxHash: result.transactionHash, blockNumber: result.blockNumber, status: "ANCHORED" };
  }

  async createFailureEvidence(orderId: string, input: { failureType: string; description: string; evidence: Record<string, unknown> }) {
    const rental = await blockchainService.getRental(orderId);
    if (!rental.active) throw ERRORS.RENTAL_NOT_ACTIVE();
    const evidenceHash = sha256StableBytes32({ orderId, robotId: rental.robotId, ...input });
    return prisma.failureEvidence.create({
      data: { orderId, robotId: rental.robotId, customerAddress: rental.customer, failureType: input.failureType, description: input.description, evidenceJson: JSON.stringify(input.evidence), evidenceHash, status: "REPORTED" },
    });
  }

  async settleRental(orderId: string) {
    if (!blockchainService.hasFunction("settleRental")) throw ERRORS.ESCROW_NOT_SUPPORTED();
    const rental = await blockchainService.getRental(orderId);
    if (rental.status !== 0) throw ERRORS.SETTLEMENT_NOT_ALLOWED("Rental is not ACTIVE.");
    if (BigInt(Math.floor(Date.now() / 1000)) < rental.endTime) throw ERRORS.SETTLEMENT_NOT_ALLOWED("Rental end time has not been reached.");
    const session = await prisma.robotSession.findFirst({ where: { orderId } });
    const telemetry = session ? await prisma.robotTelemetry.findMany({ where: { sessionId: session.id }, orderBy: [{ timestamp: "asc" }, { id: "asc" }] }) : [];
    const verifiedFailure = await prisma.failureEvidence.findFirst({ where: { orderId, status: "VERIFIED_FAILURE" } });
    if (!verifySuccessfulSession({
      session,
      telemetry,
      rentalStartTime: rental.startTime,
      rentalEndTime: rental.endTime,
      now: BigInt(Math.floor(Date.now() / 1000)),
      hasVerifiedFailure: Boolean(verifiedFailure),
    })) throw ERRORS.SETTLEMENT_NOT_ALLOWED("The robot session does not meet verified SUCCESS criteria.");
    if (/^0x0{64}$/i.test(rental.activityHash)) throw ERRORS.SETTLEMENT_NOT_ALLOWED("Activity hash has not been recorded on-chain.");
    const activity = await (await import("./verification.service.js")).verificationService.verifyActivity(orderId);
    if (activity.status !== "VERIFIED") throw ERRORS.SETTLEMENT_NOT_ALLOWED(`Activity data status is ${activity.status}.`);
    if (!rental.escrowedAmountWei || BigInt(rental.escrowedAmountWei) !== BigInt(rental.amountPaidWei)) throw ERRORS.SETTLEMENT_NOT_ALLOWED("Full rental amount is not present in escrow.");
    const paymentRecipient = blockchainService.hasFunction("paymentRecipient") ? String(await blockchainService.contract.paymentRecipient()) : "";
    if (paymentRecipient.toLowerCase() !== ADMIN_ADDRESS.toLowerCase()) throw ERRORS.SETTLEMENT_NOT_ALLOWED("The escrow payment recipient is not the configured Admin wallet.");

    const result = await blockchainService.operatorCall("settleRental", [orderId], async (transactionHash) => {
      await prisma.transactionRecord.upsert({
        where: { txHash: transactionHash },
        update: { status: "PENDING" },
        create: { txHash: transactionHash, orderId, type: "SETTLEMENT", fromAddress: blockchainService.address, toAddress: ADMIN_ADDRESS, valueWei: rental.amountPaidWei, status: "PENDING" },
      });
    });
    const refreshed = await blockchainService.getRental(orderId);
    const robot = await blockchainService.getRobot(rental.robotId);
    if (refreshed.status !== 1 || refreshed.escrowedAmountWei !== "0" || robot.status !== 0) {
      throw ERRORS.TRANSACTION_NOT_VERIFIED("Settlement receipt confirmed but admin payout or terminal chain state did not.");
    }
    const block = await blockchainService.getBlock(result.blockNumber);
    await prisma.transactionRecord.upsert({ where: { txHash: result.transactionHash }, update: { status: "CONFIRMED", blockNumber: result.blockNumber }, create: { txHash: result.transactionHash, orderId, type: "SETTLEMENT", fromAddress: blockchainService.address, toAddress: ADMIN_ADDRESS, valueWei: rental.amountPaidWei, blockNumber: result.blockNumber, status: "CONFIRMED" } });
    await prisma.rentalSnapshot.update({ where: { orderId }, data: { status: "COMPLETED", paymentStatus: "SETTLED", active: false, completed: true, settlementTxHash: result.transactionHash, settledAt: refreshed.settledAt, lastSyncedBlock: result.blockNumber } });
    return { orderId, status: "COMPLETED", paymentStatus: "SETTLED", transactionHash: result.transactionHash, blockNumber: result.blockNumber, timestamp: block?.timestamp ?? null, adminAddress: ADMIN_ADDRESS };
  }

  async refundRental(orderId: string, failureEvidenceId: string) {
    if (!blockchainService.hasFunction("refundRental")) throw ERRORS.ESCROW_NOT_SUPPORTED();
    const rental = await blockchainService.getRental(orderId);
    if (rental.status !== 0) throw ERRORS.REFUND_NOT_ALLOWED("Rental is not ACTIVE.");
    if (/^0x0{64}$/i.test(rental.activityHash)) throw ERRORS.REFUND_NOT_ALLOWED("The contract requires an activity hash before refund.");
    const evidence = await prisma.failureEvidence.findFirst({ where: { id: failureEvidenceId, orderId, status: "VERIFIED_FAILURE" } });
    if (!evidence || !/^0x[0-9a-fA-F]{64}$/.test(evidence.evidenceHash) || /^0x0{64}$/i.test(evidence.evidenceHash)) {
      throw ERRORS.REFUND_NOT_ALLOWED("Verified failure evidence is required.");
    }
    const session = await prisma.robotSession.findFirst({ where: { orderId } });
    if (!verifyFailureEvidence({ evidence, orderId, robotId: rental.robotId, customerAddress: rental.customer, sessionStatus: session?.status })) {
      throw ERRORS.REFUND_NOT_ALLOWED("Failure evidence has not been operator-validated.");
    }
    if (!rental.escrowedAmountWei || BigInt(rental.escrowedAmountWei) !== BigInt(rental.amountPaidWei)) throw ERRORS.REFUND_NOT_ALLOWED("Full rental amount is not present in escrow.");

    const result = await blockchainService.operatorCall("refundRental", [orderId, evidence.evidenceHash], async (transactionHash) => {
      await prisma.transactionRecord.upsert({
        where: { txHash: transactionHash },
        update: { status: "PENDING" },
        create: { txHash: transactionHash, orderId, type: "REFUND", fromAddress: blockchainService.address, toAddress: rental.customer, valueWei: rental.amountPaidWei, status: "PENDING" },
      });
    });
    const refreshed = await blockchainService.getRental(orderId);
    const robot = await blockchainService.getRobot(rental.robotId);
    if (refreshed.status !== 2 || refreshed.escrowedAmountWei !== "0" || robot.status !== 0 || refreshed.customer.toLowerCase() !== rental.customer.toLowerCase() || refreshed.failureReasonHash.toLowerCase() !== evidence.evidenceHash.toLowerCase()) {
      throw ERRORS.TRANSACTION_NOT_VERIFIED("Refund receipt confirmed but terminal state/evidence did not.");
    }
    await prisma.failureEvidence.update({ where: { id: evidence.id }, data: { status: "REFUNDED", refundTxHash: result.transactionHash, reviewedAt: new Date() } });
    await prisma.transactionRecord.upsert({ where: { txHash: result.transactionHash }, update: { status: "CONFIRMED", blockNumber: result.blockNumber }, create: { txHash: result.transactionHash, orderId, type: "REFUND", fromAddress: blockchainService.address, toAddress: rental.customer, valueWei: rental.amountPaidWei, blockNumber: result.blockNumber, status: "CONFIRMED" } });
    await prisma.rentalSnapshot.update({ where: { orderId }, data: { status: "REFUNDED", paymentStatus: "REFUNDED", active: false, completed: false, failureReasonHash: evidence.evidenceHash, refundTxHash: result.transactionHash, settledAt: refreshed.settledAt, lastSyncedBlock: result.blockNumber } });
    return { orderId, status: "REFUNDED", paymentStatus: "REFUNDED", customerAddress: rental.customer, amountWei: rental.amountPaidWei, failureReasonHash: evidence.evidenceHash, transactionHash: result.transactionHash, blockNumber: result.blockNumber };
  }

  async reconcilePendingOperatorTransaction(orderId: string) {
    const pending = await prisma.transactionRecord.findFirst({
      where: { orderId, status: "PENDING", type: { in: ["ACTIVITY_ANCHOR", "SETTLEMENT", "REFUND"] } },
      orderBy: { createdAt: "desc" },
    });
    if (!pending) return false;

    const receipt = await blockchainService.getReceipt(pending.txHash);
    if (!receipt) {
      const transaction = await blockchainService.getTransaction(pending.txHash);
      const stalePending = Date.now() - pending.createdAt.getTime() > Math.max(env.EXPIRY_CHECK_INTERVAL_MS * 12, 120_000);
      if (transaction || !stalePending) return true;
      await prisma.transactionRecord.update({ where: { txHash: pending.txHash }, data: { status: "FAILED" } });
      return false;
    }
    if (receipt.status === 0) {
      await prisma.transactionRecord.update({ where: { txHash: pending.txHash }, data: { status: "FAILED", blockNumber: receipt.blockNumber } });
      return false;
    }
    if (await blockchainService.getCurrentBlock() - receipt.blockNumber + 1 < env.BLOCK_CONFIRMATIONS) return true;

    const rental = await blockchainService.getRental(orderId);
    const parsedEvents = receipt.logs
      .filter((log) => log.address.toLowerCase() === blockchainService.address.toLowerCase())
      .map((log) => {
        try {
          return blockchainService.contract.interface.parseLog(log);
        } catch {
          return null;
        }
      });

    if (pending.type === "ACTIVITY_ANCHOR") {
      const session = await prisma.robotSession.findFirst({ where: { orderId } });
      if (!session?.sessionDataJson) return true;
      const computedHash = sha256StableBytes32(JSON.parse(session.sessionDataJson) as unknown);
      const event = parsedEvents.find((item) => item?.name === "ActivityHashRecorded" && item.args[0] === orderId);
      if (!event || computedHash.toLowerCase() !== rental.activityHash.toLowerCase() || String(event.args[2]).toLowerCase() !== computedHash.toLowerCase()) return true;
      await prisma.transactionRecord.update({ where: { txHash: pending.txHash }, data: { status: "CONFIRMED", blockNumber: receipt.blockNumber } });
      await prisma.robotSession.update({ where: { id: session.id }, data: { activityHash: computedHash, sessionDataHash: computedHash, hashAnchored: true, anchorTxHash: pending.txHash, auditStatus: "ANCHORED" } });
      return false;
    }

    const robot = await blockchainService.getRobot(rental.robotId);
    const amount = BigInt(rental.amountPaidWei);
    const block = await blockchainService.getBlock(receipt.blockNumber);
    if (pending.type === "SETTLEMENT") {
      const recipient = blockchainService.hasFunction("paymentRecipient") ? String(await blockchainService.contract.paymentRecipient()) : "";
      const event = parsedEvents.find((item) => item?.name === "RentalSettled" && item.args[0] === orderId);
      if (!event || rental.status !== 1 || rental.escrowedAmountWei !== "0" || robot.status !== 0 || recipient.toLowerCase() !== ADMIN_ADDRESS.toLowerCase() || String(event.args[2]).toLowerCase() !== recipient.toLowerCase() || BigInt(event.args[3]) !== amount) return true;
      await prisma.transactionRecord.update({ where: { txHash: pending.txHash }, data: { status: "CONFIRMED", blockNumber: receipt.blockNumber } });
      await prisma.rentalSnapshot.update({ where: { orderId }, data: { status: "COMPLETED", paymentStatus: "SETTLED", active: false, completed: true, settlementTxHash: pending.txHash, settledAt: rental.settledAt, lastSyncedBlock: receipt.blockNumber } });
      return true;
    }

    const event = parsedEvents.find((item) => item?.name === "RentalRefunded" && item.args[0] === orderId);
    if (!event || rental.status !== 2 || rental.escrowedAmountWei !== "0" || robot.status !== 0 || String(event.args[2]).toLowerCase() !== rental.customer.toLowerCase() || BigInt(event.args[3]) !== amount || String(event.args[4]).toLowerCase() !== rental.failureReasonHash.toLowerCase()) return true;
    await prisma.transactionRecord.update({ where: { txHash: pending.txHash }, data: { status: "CONFIRMED", blockNumber: receipt.blockNumber } });
    await prisma.rentalSnapshot.update({ where: { orderId }, data: { status: "REFUNDED", paymentStatus: "REFUNDED", active: false, completed: false, failureReasonHash: rental.failureReasonHash, refundTxHash: pending.txHash, settledAt: rental.settledAt, lastSyncedBlock: receipt.blockNumber } });
    return true;
  }

  async getFinalizationStatus(orderId: string) {
    if (!(await blockchainService.orderExists(orderId))) throw ERRORS.RENTAL_NOT_FOUND();
    const rental = await blockchainService.getRental(orderId);
    const [robot, session, snapshot, evidence, finalizationAudit] = await Promise.all([
      blockchainService.getRobot(rental.robotId),
      prisma.robotSession.findFirst({ where: { orderId } }),
      prisma.rentalSnapshot.findUnique({ where: { orderId } }),
      prisma.failureEvidence.findMany({ where: { orderId, status: "VERIFIED_FAILURE" }, orderBy: { createdAt: "asc" } }),
      prisma.activityAudit.findMany({ where: { orderId, eventType: { in: ["AUTO_SETTLEMENT", "AUTO_REFUND"] } }, orderBy: { timestamp: "desc" } }),
    ]);
    const now = BigInt(Math.floor(Date.now() / 1000));
    const telemetry = session ? await prisma.robotTelemetry.findMany({ where: { sessionId: session.id }, orderBy: [{ timestamp: "asc" }, { id: "asc" }] }) : [];
    const verifiedFailureEvidence = evidence.find((item) => verifyFailureEvidence({
      evidence: item,
      orderId,
      robotId: rental.robotId,
      customerAddress: rental.customer,
      sessionStatus: session?.status,
    })) ?? null;
    let demoMode = false;
    if (session?.sessionDataJson) {
      try {
        const sessionData = JSON.parse(session.sessionDataJson) as { telemetry?: Array<{ telemetry?: { demoMode?: unknown } }> };
        demoMode = sessionData.telemetry?.some((sample) => sample.telemetry?.demoMode === true) ?? false;
      } catch {
        demoMode = false;
      }
    } else {
      demoMode = session?.auditStatus === "DEMO_SIMULATED";
    }
    const sessionOutcome = determineSessionOutcome({
      session,
      telemetry,
      rentalStartTime: rental.startTime,
      rentalEndTime: rental.endTime,
      now,
      verifiedFailure: Boolean(verifiedFailureEvidence),
    });
    const latestSettlementState = finalizationAudit.find((item) => item.eventType === "AUTO_SETTLEMENT")?.status;
    const latestRefundState = finalizationAudit.find((item) => item.eventType === "AUTO_REFUND")?.status;

    let state: string;
    if (rental.status === 1) state = "COMPLETED";
    else if (rental.status === 2) state = "REFUNDED";
    else if (now < rental.endTime) state = "ACTIVE";
    else if (sessionOutcome === "SUCCESS") state = blockchainService.hasOperatorSigner() && latestSettlementState !== "RETRY_PENDING" ? "SETTLING" : "SETTLEMENT_RETRY_PENDING";
    else if (sessionOutcome === "FAILURE") state = blockchainService.hasOperatorSigner() && latestRefundState !== "RETRY_PENDING" ? "REFUNDING" : "REFUND_RETRY_PENDING";
    else if (session && ["STARTING", "ACTIVE"].includes(session.status)) state = "VERIFYING_SESSION";
    else state = "PENDING";

    return {
      orderId,
      state,
      sessionStatus: sessionOutcome,
      evidenceMode: demoMode ? "DEMO_SIMULATED" : session ? "ROBOT_SESSION" : "UNAVAILABLE",
      rentalStatus: rental.statusLabel,
      paymentStatus: rental.status === 1 ? "SETTLED" : rental.status === 2 ? "REFUNDED" : "ESCROWED",
      robotStatus: robot.status === 0 ? "AVAILABLE" : "IN_USE",
      settlementTxHash: rental.status === 1 ? snapshot?.settlementTxHash ?? null : null,
      refundTxHash: rental.status === 2 ? snapshot?.refundTxHash ?? null : null,
      activityHash: rental.activityHash,
      anchorTxHash: session?.anchorTxHash ?? null,
      failureReasonHash: rental.status === 2 ? rental.failureReasonHash : verifiedFailureEvidence?.evidenceHash ?? null,
      failureType: verifiedFailureEvidence?.failureType ?? null,
      adminAddress: ADMIN_ADDRESS,
      settledAt: rental.settledAt.toString(),
    };
  }
}

export const auditService = new AuditService();