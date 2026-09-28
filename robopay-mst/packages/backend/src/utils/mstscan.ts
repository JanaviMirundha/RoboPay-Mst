export const MSTSCAN_BASE = "https://testnet.mstscan.com";

export function getContractUrl(address: string) {
  return `${MSTSCAN_BASE}/address/${address}`;
}

export function getTransactionUrl(txHash: string) {
  return `${MSTSCAN_BASE}/tx/${txHash}`;
}

export function getAddressUrl(address: string) {
  return `${MSTSCAN_BASE}/address/${address}`;
}
