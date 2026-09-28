import { createConfig, http } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import type { EIP1193Provider } from "viem";
import { mstMainnet, mstTestnet } from "./chains";

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

type BridgeKeyProvider = EIP1193Provider & { isBridgeKey?: boolean };

function getBridgeKeyProvider(): BridgeKeyProvider | undefined {
  if (typeof window === "undefined") return undefined;

  const bridgeWindow = window as typeof window & {
    ethereum?: BridgeKeyProvider;
    bridgekey?: BridgeKeyProvider;
  };

  const provider = bridgeWindow.bridgekey?.isBridgeKey
    ? bridgeWindow.bridgekey
    : bridgeWindow.ethereum?.isBridgeKey
      ? bridgeWindow.ethereum
      : undefined;

  return provider && typeof provider.request === "function" ? provider : undefined;
}

const bridgeKeyConnector = injected({
  target: {
    id: "bridgekey",
    name: "BridgeKey",
    provider: () => getBridgeKeyProvider(),
  },
});

export const wagmiConfig = createConfig({
  chains: [mstTestnet, mstMainnet],
  connectors: [
    bridgeKeyConnector,
    ...(walletConnectProjectId ? [walletConnect({ projectId: walletConnectProjectId })] : []),
  ],
  // Same-origin proxy, not the RPC URLs directly — MST Testnet's RPC
  // doesn't send CORS headers, so a direct browser fetch to it is blocked.
  // See app/api/rpc/[network]/route.ts.
  transports: {
    [mstTestnet.id]: http("/api/rpc/testnet"),
    [mstMainnet.id]: http("/api/rpc/mainnet"),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
