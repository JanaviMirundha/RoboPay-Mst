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
  active: boolean;
  completed: boolean;
  activityHash: string;
  rentalDataHash: string;
}

export interface RentalSummary {
  orderId: string;
  robotId: string;
  customer: string;
  status: "ACTIVE" | "COMPLETED" | "UNKNOWN";
  amountInr: number;
  amountPaidWei: string;
  startTime: bigint;
  endTime: bigint;
}
