export const MST_TESTNET_CHAIN_ID =
    "0x5752035";

export const MST_TESTNET_CHAIN_ID_DECIMAL =
    91562037;

export const MST_TESTNET_RPC =
    "https://testnetrpc.mstblockchain.com";

export const MSTSCAN_URL =
    "https://testnet.mstscan.com";

export const API_URL =
    "http://localhost:5000";

export const ROBO_PAY_ABI = [
    "function requiredPayment(string robotId, uint256 durationMinutes) view returns (uint256)",
    "function requiredAmountInr(string robotId, uint256 durationMinutes) view returns (uint256)",
    "function rentRobot(string orderId, string robotId, string service, uint256 durationMinutes, uint256 amountInr) payable",
    "function getRental(string orderId) view returns (string,string,string,uint256,uint256,uint256,address,uint256,uint256,bool,bool,bytes32,bytes32)",
    "function getRobot(string robotId) view returns (string,string,string,address,uint8,bool)",
    "function endRental(string orderId)",
    "function verifyActivityHash(string orderId, bytes32 currentHash) view returns (bool)",
    "function verifyRentalDataHash(string orderId, bytes32 currentHash) view returns (bool)"
];

export async function getContractAddress(): Promise<string> {

    const response =
        await fetch(
            `${API_URL}/api/config`,
            {
                cache: "no-store"
            }
        );

    const data =
        await response.json();

    if (
        !response.ok ||
        !data.success ||
        !data.contractAddress
    ) {
        throw new Error(
            data.error ||
            "RoboPay contract address is unavailable."
        );
    }

    return data.contractAddress;
}