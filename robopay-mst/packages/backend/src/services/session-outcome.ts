import { sha256StableBytes32 } from "../utils/hash.js";

type TelemetryRecord = {
  timestamp: Date;
  telemetryJson: string;
  telemetryHash: string;
};

type CompletedSession = {
  orderId: string;
  robotId: string;
  status: string;
  startedAt: Date | null;
  endedAt: Date | null;
  sessionDataJson: string | null;
  sessionDataHash: string | null;
  activityHash: string | null;
};

export type FailureEvidenceRecord = {
  orderId: string;
  robotId: string;
  customerAddress: string | null;
  failureType: string;
  description: string;
  evidenceJson: string;
  evidenceHash: string;
  status: string;
};

export type SessionOutcome = "SUCCESS" | "FAILURE" | "UNKNOWN";

export function verifyFailureEvidence(input: {
  evidence: FailureEvidenceRecord | null;
  orderId: string;
  robotId: string;
  customerAddress: string;
  sessionStatus: string | undefined;
}): boolean {
  const { evidence, orderId, robotId, customerAddress, sessionStatus } = input;
  if (!evidence || evidence.status !== "VERIFIED_FAILURE" || sessionStatus !== "FAILED") return false;
  if (evidence.orderId !== orderId || evidence.robotId !== robotId || evidence.customerAddress?.toLowerCase() !== customerAddress.toLowerCase()) return false;
  if (!/^0x[0-9a-fA-F]{64}$/.test(evidence.evidenceHash) || /^0x0{64}$/i.test(evidence.evidenceHash)) return false;
  try {
    const computedHash = sha256StableBytes32({
      orderId,
      robotId,
      failureType: evidence.failureType,
      description: evidence.description,
      evidence: JSON.parse(evidence.evidenceJson) as unknown,
    });
    return computedHash.toLowerCase() === evidence.evidenceHash.toLowerCase();
  } catch {
    return false;
  }
}

export function verifySuccessfulSession(input: {
  session: CompletedSession | null;
  telemetry: TelemetryRecord[];
  rentalStartTime: bigint;
  rentalEndTime: bigint;
  now: bigint;
  hasVerifiedFailure: boolean;
}): boolean {
  const { session, telemetry, rentalStartTime, rentalEndTime, now, hasVerifiedFailure } = input;
  if (!session || !["COMPLETED", "SUCCESS"].includes(session.status) || hasVerifiedFailure || now < rentalEndTime) return false;
  if (!session.startedAt || !session.endedAt || !session.sessionDataJson || !session.sessionDataHash || !session.activityHash) return false;

  const startedAt = BigInt(Math.floor(session.startedAt.getTime() / 1000));
  const endedAt = BigInt(Math.floor(session.endedAt.getTime() / 1000));
  if (startedAt < rentalStartTime || startedAt >= rentalEndTime || endedAt < rentalEndTime) return false;
  if (telemetry.length < 2) return false;

  let heartbeatCount = 0;
  let operationCompleted = false;
  let lastHeartbeat = 0n;
  const samples: Array<{ timestamp: string; telemetry: unknown; telemetryHash: string }> = [];

  try {
    for (const record of telemetry) {
      const payload = JSON.parse(record.telemetryJson) as Record<string, unknown>;
      const calculatedHash = sha256StableBytes32(payload);
      if (calculatedHash.toLowerCase() !== record.telemetryHash.toLowerCase()) return false;
      const faultSignals = ["criticalFault", "emergencyStop", "eStop", "motorFailure", "sensorFailure", "robotOffline", "heartbeatLost", "criticalHardwareError", "sessionInterrupted"];
      if (faultSignals.some((signal) => payload[signal] === true)) return false;
      const sampleTime = BigInt(Math.floor(record.timestamp.getTime() / 1000));
      if (sampleTime < startedAt || sampleTime > endedAt) return false;
      if (payload.heartbeat === true || payload.eventType === "HEARTBEAT") {
        heartbeatCount += 1;
        if (sampleTime > lastHeartbeat) lastHeartbeat = sampleTime;
      }
      if (payload.operationCompleted === true || payload.operationStatus === "COMPLETED") operationCompleted = true;
      samples.push({ timestamp: record.timestamp.toISOString(), telemetry: payload, telemetryHash: record.telemetryHash });
    }

    const sessionData = {
      orderId: session.orderId,
      robotId: session.robotId,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt.toISOString(),
      telemetry: samples,
    };
    const computedHash = sha256StableBytes32(sessionData);
    const storedSessionData = JSON.parse(session.sessionDataJson) as unknown;
    if (sha256StableBytes32(storedSessionData).toLowerCase() !== computedHash.toLowerCase()) return false;
    if (session.sessionDataHash.toLowerCase() !== computedHash.toLowerCase()) return false;
    if (session.activityHash.toLowerCase() !== computedHash.toLowerCase()) return false;
  } catch {
    return false;
  }

  return heartbeatCount >= 2 && lastHeartbeat >= rentalEndTime && operationCompleted;
}

export function determineSessionOutcome(input: {
  session: CompletedSession | null;
  telemetry: TelemetryRecord[];
  rentalStartTime: bigint;
  rentalEndTime: bigint;
  now: bigint;
  verifiedFailure: boolean;
}): SessionOutcome {
  if (input.verifiedFailure && input.session?.status === "FAILED") return "FAILURE";
  if (input.now < input.rentalEndTime) return "UNKNOWN";
  return verifySuccessfulSession({ ...input, hasVerifiedFailure: input.verifiedFailure }) ? "SUCCESS" : "UNKNOWN";
}
