import type { AuditRecord } from "@/types";

export interface AuditApiClient {
  listAuditRecords(): Promise<AuditRecord[]>;
  postActivityHash(orderId: string, hash: string): Promise<void>;
}

export const auditApi: AuditApiClient = {
  async listAuditRecords() {
    return [];
  },
  async postActivityHash() {
    return;
  },
};
