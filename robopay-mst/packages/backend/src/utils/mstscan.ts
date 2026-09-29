export const MSTSCAN_BASE = "https://testnet.mstscan.com";

export function contractUrl(address: string) {
  return `${MSTSCAN_BASE}/address/${address}`;
}

export function transactionUrl(txHash: string) {
  return `${MSTSCAN_BASE}/tx/${txHash}`;
}

export function addressUrl(address: string) {
  return `${MSTSCAN_BASE}/address/${address}`;
}

export const getContractUrl = contractUrl;
export const getTransactionUrl = transactionUrl;
export const getAddressUrl = addressUrl;
