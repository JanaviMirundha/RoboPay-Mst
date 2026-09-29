export type ApiEnvelope<T> = {
  success: true;
  data: T;
} | {
  success: false;
  error: {
    code?: string;
    message?: string;
  };
};

export type BackendHealth = {
  status: "healthy" | "degraded";
  network: string;
  chainId: number;
  contract: string;
  database?: string;
  blockchain?: string;
  blockNumber?: number | null;
};

export type BackendBlockchainInfo = {
  network: string;
  chainId: number;
  contract: string;
  owner: string;
  operatorAuthorized: boolean;
  capabilities: {
    settlement: boolean;
    refund: boolean;
    activityAnchor: boolean;
    rentalEnd: boolean;
  };
};

export type BackendRobot = {
  robotId: string;
  name: string;
  service: string;
  robotOwner: string;
  status: number;
  registered: boolean;
  statusLabel: string;
  lastSyncedBlock?: number;
};

export type BackendActiveRobotRental = {
  robotId: string;
  active: false;
  rental: null;
} | {
  robotId: string;
  active: true;
  rental: {
    orderId: string;
    customer: string;
    service: string;
    durationMinutes: number;
    startTime: string;
    endTime: string;
    status: string;
    paymentStatus: string;
  };
};

export type BackendRental = {
  orderId: string;
  robotId: string;
  customer: string;
  service: string;
  durationMinutes: number;
  amountInr: number;
  amountPaidWei: string;
  startTime: number | bigint;
  endTime: number | bigint;
  status: number | string;
  active: boolean;
  completed: boolean;
  refunded: boolean;
  rentalDataHash: string;
  activityHash: string;
  failureReasonHash: string;
  escrowedAmountWei?: string;
  paymentStatus?: string;
};

export type BackendVerificationRental = {
  orderId: string;
  robotId: string;
  customer: string;
  service: string;
  durationMinutes: number;
  amountInr: number;
  amountPaidWei: string;
  startTime: number | bigint;
  endTime: number | bigint;
  status: string;
  statusCode?: number;
  paymentStatus?: string;
  activityHash?: string;
  rentalDataHash?: string;
  activityStatus?: string;
  computedHash?: string | null;
  verified?: boolean;
};

export type BackendVerificationActivity = {
  orderId: string;
  status: string;
  verified: boolean;
  computedHash: string | null;
  onChainHash: string;
  transactionHash?: string | null;
};

export type BackendAudit = {
  orderId: string;
  rentalStatus: string;
  paymentStatus: string;
  activityHash: string;
  activityStatus: string;
  failureReasonHash: string;
  failureEvidence: Array<{
    id: string;
    type: string;
    hash: string;
    status: string;
    createdAt: string;
  }>;
  session: {
    id: string;
    status: string;
    startedAt: string | null;
    endedAt: string | null;
  } | null;
};

export type VerifyTransactionRequest = {
  orderId: string;
  transactionHash: string;
  customerAddress: string;
};

export type VerifyTransactionResponse = {
  verified: boolean;
  orderId: string;
  transactionHash: string;
  robotId: string;
  customerAddress: string;
  status: string;
  paymentStatus: string;
  amountPaidWei: string;
  escrowedAmountWei: string;
  blockNumber: number;
  blockTimestamp: number;
};

export type FailureReportRequest = {
  customerAddress: string;
  signature: string;
  failureType:
    | "ROBOT_OFFLINE"
    | "HEARTBEAT_LOST"
    | "MOTOR_FAILURE"
    | "EMERGENCY_STOP"
    | "SENSOR_FAILURE"
    | "SESSION_INTERRUPTED"
    | "HARDWARE_ERROR"
    | "OTHER";
  description: string;
  evidence: Record<string, unknown>;
};
