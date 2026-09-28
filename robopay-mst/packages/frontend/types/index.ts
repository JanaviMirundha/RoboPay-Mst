export type RobotStatus = 0 | 1;

export type RentalStatus = "ACTIVE" | "COMPLETED" | "PENDING";

export type TransactionState =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED_WRONG_NETWORK"
  | "CONNECTED_MST_TESTNET"
  | "TRANSACTION_PENDING"
  | "TRANSACTION_REQUEST_TIMEOUT"
  | "PROVIDER_REFRESH_REQUIRED"
  | "TRANSACTION_SUBMITTED"
  | "TRANSACTION_CONFIRMED"
  | "TRANSACTION_FAILED"
  | "USER_REJECTED";

export interface Robot {
  id: string;
  name: string;
  service: string;
  status: RobotStatus;
  registered: boolean;
  owner: string;
}

export interface Rental {
  orderId: string;
  robotId: string;
  service: string;
  durationMinutes: number;
  amountInr: bigint;
  amountPaidWei: bigint;
  customer: string;
  startTime: bigint;
  endTime: bigint;
  active: boolean;
  completed: boolean;
  activityHash: string;
  rentalDataHash: string;
}

export interface PackageOption {
  durationMinutes: number;
  amountInr: number;
  amountWei: bigint;
  amountDisplay: string;
}

export interface AuditRecord {
  orderId: string;
  robotId: string;
  status: string;
  activityHash: string;
  timestamp: number;
  transactionHash?: string;
}

export interface WalletState {
  connected: boolean;
  address?: `0x${string}`;
  chainId?: number;
  balance?: bigint;
  isMstTestnet: boolean;
}
