import type {
  ApiEnvelope,
  BackendAudit,
  BackendActiveRobotRental,
  BackendBlockchainInfo,
  BackendHealth,
  BackendRental,
  BackendRobot,
  BackendVerificationActivity,
  BackendVerificationRental,
  FailureReportRequest,
  VerifyTransactionRequest,
  VerifyTransactionResponse,
} from "robopay-mst-shared";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export type RentalOutcomeResponse = {
  orderId: string;
  state: "ACTIVE" | "VERIFYING_SESSION" | "SETTLING" | "SETTLEMENT_RETRY_PENDING" | "REFUNDING" | "REFUND_RETRY_PENDING" | "PENDING" | "COMPLETED" | "REFUNDED";
  sessionStatus: "SUCCESS" | "FAILURE" | "UNKNOWN";
  evidenceMode: "DEMO_SIMULATED" | "ROBOT_SESSION" | "UNAVAILABLE";
  rentalStatus: string;
  paymentStatus: string;
  robotStatus: string;
  settlementTxHash: string | null;
  refundTxHash: string | null;
  activityHash: string;
  anchorTxHash: string | null;
  failureReasonHash: string | null;
  failureType: string | null;
  adminAddress: string;
  settledAt: string;
};

export type ActiveRobotRentalResponse = BackendActiveRobotRental;

async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  const body = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;

  if (!response.ok) {
    const errorBody = body && "error" in body ? body.error : undefined;
    const message = errorBody?.message ?? `Request failed with status ${response.status}`;
    const error = new Error(message) as Error & { status?: number; code?: string };
    error.status = response.status;
    error.code = errorBody?.code ?? "REQUEST_FAILED";
    throw error;
  }

  if (!body || !body.success) {
    const errorBody = body && "error" in body ? body.error : undefined;
    throw new Error(errorBody?.message ?? "Malformed backend response");
  }

  return body.data as T;
}

export const api = {
  health: () => fetchApi<BackendHealth>("/api/v1/health"),
  blockchainInfo: () => fetchApi<BackendBlockchainInfo>("/api/v1/blockchain/info"),
  robots: () => fetchApi<BackendRobot[]>("/api/v1/robots"),
  robot: (robotId: string) => fetchApi<BackendRobot>(`/api/v1/robots/${encodeURIComponent(robotId)}`),
  activeRobotRental: (robotId: string) => fetchApi<ActiveRobotRentalResponse>(`/api/v1/robots/${encodeURIComponent(robotId)}/active-rental`),
  rental: (orderId: string) => fetchApi<BackendRental>(`/api/v1/rentals/${encodeURIComponent(orderId)}`),
  rentalOutcome: (orderId: string) => fetchApi<RentalOutcomeResponse>(`/api/v1/rentals/${encodeURIComponent(orderId)}/outcome`),
  activeRentals: () => fetchApi<BackendRental[]>("/api/v1/rentals/active"),
  customerRentals: (address: string) => fetchApi<BackendRental[]>(`/api/v1/rentals/customer/${encodeURIComponent(address)}`),
  verifyTransaction: (payload: VerifyTransactionRequest) =>
    fetchApi<VerifyTransactionResponse>("/api/v1/rentals/verify-transaction", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  verifyRental: (orderId: string) => fetchApi<BackendVerificationRental>(`/api/v1/verify/rental/${encodeURIComponent(orderId)}`),
  verifyActivity: (orderId: string) => fetchApi<BackendVerificationActivity>(`/api/v1/verify/activity/${encodeURIComponent(orderId)}`),
  audit: (orderId: string) => fetchApi<BackendAudit>(`/api/v1/audit/${encodeURIComponent(orderId)}`),
  auditHistory: (orderId: string) => fetchApi<BackendAudit[]>(`/api/v1/audit/${encodeURIComponent(orderId)}/history`),
  session: (orderId: string) => fetchApi<unknown>(`/api/v1/sessions/${encodeURIComponent(orderId)}`),
  reportFailure: (orderId: string, payload: FailureReportRequest) =>
    fetchApi<{ reportId: string; evidenceHash: string; status: string }>(`/api/v1/rentals/${encodeURIComponent(orderId)}/report-failure`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};

export { API_BASE_URL };
