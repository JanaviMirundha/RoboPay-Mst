export type RentalStatus = "ACTIVE" | "COMPLETED" | "REFUNDED" | "UNKNOWN";
export type PaymentStatus = "ESCROWED" | "SETTLED" | "REFUNDED" | "UNKNOWN";

export interface RentalRecord {
  orderId: string;
  robotId: string;
  service: string;
  durationMinutes: number;
  amountInr: number;
  amountPaidWei: string;
  customer: string;
  startTime: bigint;
  endTime: bigint;
  status: RentalStatus;
  paymentStatus: PaymentStatus;
  active: boolean;
  completed: boolean;
  refunded: boolean;
  activityHash: string;
  rentalDataHash: string;
  failureReasonHash: string;
  settledAt: bigint;
  escrowedAmountWei: string | null;
}

export interface RentalSummary {
  orderId: string;
  robotId: string;
  customer: string;
  status: RentalStatus;
  paymentStatus: PaymentStatus;
  amountInr: number;
  amountPaidWei: string;
  startTime: bigint;
  endTime: bigint;
}
