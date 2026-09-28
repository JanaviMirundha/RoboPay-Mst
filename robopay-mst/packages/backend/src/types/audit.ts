export interface AuditEntry {
  id: string;
  orderId: string;
  robotId: string;
  eventType: string;
  payloadJson?: string;
  timestamp: string;
  blockchainAnchored: boolean;
  anchorTxHash?: string;
}
