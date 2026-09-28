export const MSTSCAN_BASE = "https://testnet.mstscan.com";
export function getContractUrl(address) {
    return `${MSTSCAN_BASE}/address/${address}`;
}
export function getTransactionUrl(txHash) {
    return `${MSTSCAN_BASE}/tx/${txHash}`;
}
export function getAddressUrl(address) {
    return `${MSTSCAN_BASE}/address/${address}`;
}
