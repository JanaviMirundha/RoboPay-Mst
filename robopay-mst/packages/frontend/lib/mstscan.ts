import { ROBO_PAY_ADDRESS } from "@/lib/contract";

export const CONTRACT_SCAN_URL = `https://testnet.mstscan.com/address/${ROBO_PAY_ADDRESS}`;

export function getMstscanAddressUrl(address: string) {
  return `https://testnet.mstscan.com/address/${address}`;
}

export function getMstscanTxUrl(txHash: string) {
  return `https://testnet.mstscan.com/tx/${txHash}`;
}

export function getContractScanUrl() {
  return CONTRACT_SCAN_URL;
}
