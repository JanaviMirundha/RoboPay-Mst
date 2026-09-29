import { describe, expect, it } from "vitest";
import { determineSessionOutcome, verifyFailureEvidence, verifySuccessfulSession } from "../src/services/session-outcome.js";
import { sha256StableBytes32, stableStringify } from "../src/utils/hash.js";

const rentalStartTime = 1_800_000_000n;
const rentalEndTime = rentalStartTime + 60n;
const startedAt = new Date(Number(rentalStartTime) * 1000);
const endedAt = new Date(Number(rentalEndTime) * 1000);
const telemetry = [
  { timestamp: new Date(Number(rentalStartTime + 10n) * 1000), payload: { heartbeat: true } },
  { timestamp: new Date(Number(rentalEndTime) * 1000), payload: { heartbeat: true, operationCompleted: true } },
];
const rows = telemetry.map((sample) => ({
  timestamp: sample.timestamp,
  telemetryJson: JSON.stringify(sample.payload),
  telemetryHash: sha256StableBytes32(sample.payload),
}));
const data = {
  orderId: "RP-SESSION-OUTCOME-TEST",
  robotId: "RF-01",
  startedAt: startedAt.toISOString(),
  endedAt: endedAt.toISOString(),
  telemetry: rows.map((row) => ({
    timestamp: row.timestamp.toISOString(),
    telemetry: JSON.parse(row.telemetryJson) as unknown,
    telemetryHash: row.telemetryHash,
  })),
};
const dataJson = stableStringify(data);
const dataHash = sha256StableBytes32(data);
const session = {
  orderId: data.orderId,
  robotId: data.robotId,
  status: "COMPLETED",
  startedAt,
  endedAt,
  sessionDataJson: dataJson,
  sessionDataHash: dataHash,
  activityHash: dataHash,
};

function evaluate(overrides: Partial<Parameters<typeof determineSessionOutcome>[0]> = {}) {
  return determineSessionOutcome({
    session,
    telemetry: rows,
    rentalStartTime,
    rentalEndTime,
    now: rentalEndTime,
    verifiedFailure: false,
    ...overrides,
  });
}

describe("robot session outcome verification", () => {
  it("accepts complete, consistent telemetry only after the scheduled end", () => {
    expect(evaluate()).toBe("SUCCESS");
    expect(evaluate({ now: rentalEndTime - 1n })).toBe("UNKNOWN");
  });

  it("keeps incomplete, tampered, and faulted session data unknown", () => {
    expect(evaluate({ telemetry: rows.slice(0, 1) })).toBe("UNKNOWN");
    expect(evaluate({ telemetry: [{ ...rows[1], telemetryJson: JSON.stringify({ heartbeat: true, emergencyStop: true }) }, rows[0]] })).toBe("UNKNOWN");
    expect(verifySuccessfulSession({
      session: { ...session, activityHash: `0x${"f".repeat(64)}` },
      telemetry: rows,
      rentalStartTime,
      rentalEndTime,
      now: rentalEndTime,
      hasVerifiedFailure: false,
    })).toBe(false);
  });

  it("classifies a robot-authenticated failed session only with verified failure evidence", () => {
    expect(evaluate({ session: { ...session, status: "FAILED" }, verifiedFailure: true })).toBe("FAILURE");
    expect(evaluate({ session: { ...session, status: "FAILED" }, verifiedFailure: true, now: rentalEndTime - 1n })).toBe("FAILURE");
    expect(evaluate({ session: { ...session, status: "FAILED" }, verifiedFailure: false })).toBe("UNKNOWN");
  });

  it("requires failure evidence to be verified, correctly bound, and hash-consistent", () => {
    const evidencePayload = { sensor: "motor-current", measured: 0 };
    const failure = {
      orderId: session.orderId,
      robotId: session.robotId,
      customerAddress: "0x1111111111111111111111111111111111111111",
      failureType: "MOTOR_FAILURE",
      description: "Motor failure reported by robot controller",
      evidenceJson: stableStringify(evidencePayload),
      evidenceHash: sha256StableBytes32({
        orderId: session.orderId,
        robotId: session.robotId,
        failureType: "MOTOR_FAILURE",
        description: "Motor failure reported by robot controller",
        evidence: evidencePayload,
      }),
      status: "VERIFIED_FAILURE",
    };
    const args = { evidence: failure, orderId: session.orderId, robotId: session.robotId, customerAddress: failure.customerAddress, sessionStatus: "FAILED" };
    expect(verifyFailureEvidence(args)).toBe(true);
    expect(verifyFailureEvidence({ ...args, evidence: { ...failure, evidenceHash: `0x${"f".repeat(64)}` } })).toBe(false);
    expect(verifyFailureEvidence({ ...args, customerAddress: "0x2222222222222222222222222222222222222222" })).toBe(false);
  });
});
