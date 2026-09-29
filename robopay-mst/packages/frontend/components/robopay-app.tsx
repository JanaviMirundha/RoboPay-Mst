"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createWalletClient,
  custom,
  createPublicClient,
  formatEther,
  http,
  parseEther,
  parseAbiItem,
  parseEventLogs,
  type Address,
  type EIP1193Provider,
  type Hex,
} from "viem";
import { useAccount, useBalance, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { mstTestnet } from "@/lib/chains";
import { IS_ROBO_PAY_ESCROW_DEPLOYED, ROBO_PAY_ABI, ROBO_PAY_ADDRESS } from "@/lib/contract";
import { api, type ActiveRobotRentalResponse, type RentalOutcomeResponse } from "@/lib/api";
import { CONTRACT_SCAN_URL, getMstscanTxUrl } from "@/lib/mstscan";
import { shortenAddress, createOrderId, formatRobotStatus, formatRentalStatus, computeRentalDataHash } from "@/lib/blockchain";
import type { Robot, RobotStatus, TransactionState } from "@/types";

const PAGES = [
  "home",
  "robots",
  "robot",
  "rentals",
  "history",
  "verify",
  "audit",
  "blockchain",
] as const;

type PageName = (typeof PAGES)[number];
type RentalVerificationState =
  | { status: "IDLE" | "LOADING"; orderId: string }
  | { status: "NOT_FOUND"; orderId: string }
  | { status: "ERROR"; orderId: string; message: string }
  | {
      status: "FOUND";
      orderId: string;
      rental: RentalDetail;
      dataHashMatches: boolean;
      robotStatus: RobotStatus | null;
      paymentRecipient: Address | null;
      activityVerification: Awaited<ReturnType<typeof api.verifyActivity>> | null;
      outcome: RentalOutcomeResponse | null;
    };
type ActivityAuditState =
  | { status: "IDLE" | "LOADING"; orderId: string }
  | { status: "NOT_FOUND"; orderId: string }
  | { status: "ERROR"; orderId: string; message: string }
  | { status: "PENDING"; orderId: string; rental: RentalDetail; audit: Awaited<ReturnType<typeof api.audit>> | null; verification: Awaited<ReturnType<typeof api.verifyActivity>> | null; outcome: RentalOutcomeResponse | null }
  | { status: "ANCHORED"; orderId: string; rental: RentalDetail; audit: Awaited<ReturnType<typeof api.audit>> | null; verification: Awaited<ReturnType<typeof api.verifyActivity>> | null; outcome: RentalOutcomeResponse | null };

type RentalDetail = {
  orderId: string;
  robotId: string;
  service: string;
  durationMinutes: bigint;
  amountInr: bigint;
  amountPaidWei: bigint;
  customer: Address;
  startTime: bigint;
  endTime: bigint;
  status: number;
  active: boolean;
  completed: boolean;
  refunded: boolean;
  activityHash: string;
  rentalDataHash: string;
  failureReasonHash: string;
  settledAt: bigint;
  settlementTxHash?: Hex;
  refundTxHash?: Hex;
};

type RentalTuple = [string, string, string, bigint, bigint, bigint, Address, bigint, bigint, number, Hex, Hex, Hex, bigint];

function rentalFromTuple(data: RentalTuple): RentalDetail {
  const status = Number(data[9]);
  return {
    orderId: data[0],
    robotId: data[1],
    service: data[2],
    durationMinutes: data[3],
    amountInr: data[4],
    amountPaidWei: data[5],
    customer: data[6],
    startTime: data[7],
    endTime: data[8],
    status,
    active: status === 0,
    completed: status === 1,
    refunded: status === 2,
    rentalDataHash: data[10],
    activityHash: data[11],
    failureReasonHash: data[12],
    settledAt: data[13],
  };
}

function getEventOrderId(args: Record<string, unknown> | readonly unknown[] | undefined) {
  if (!args || Array.isArray(args)) return "—";
  const orderId = (args as Record<string, unknown>).orderId;
  return typeof orderId === "string" ? orderId : "—";
}

type ConfirmationState = {
  robotId: string;
  durationMinutes: number;
  amountInr: bigint;
  payment: bigint;
  orderId: string;
  service: string;
  customer: Address;
} | null;

type ContractMessage = {
  type: "success" | "info" | "error";
  text: string;
};

type ContractEventRecord = {
  name: string;
  orderId: string;
  blockNumber: bigint;
  transactionHash: Hex;
};

type PackageLoadState = "INITIAL" | "WAITING_FOR_WALLET" | "WAITING_FOR_NETWORK" | "LOADING" | "SUCCESS" | "EMPTY" | "ERROR";
type BridgeKeyEip1193Provider = EIP1193Provider & { isBridgeKey?: boolean };

const publicClient = createPublicClient({
  chain: mstTestnet,
  transport: http("/api/rpc/testnet"),
});

const robotPricingMap: Record<string, number[]> = {
  "RF-01": [1, 2, 3],
  "FC-01": [1, 2, 3],
  "ST-01": [1, 2, 3],
  "RC-01": [1, 2, 3],
};

function usingAddress(address?: string) {
  return address && address.startsWith("0x") ? (address as Address) : undefined;
}

function getTransactionErrorDetails(error: unknown) {
  const details: string[] = [];
  const seen = new Set<object>();
  let current: unknown = error;

  while (current && typeof current === "object" && !seen.has(current) && details.length < 5) {
    seen.add(current);
    const value = current as Record<string, unknown>;
    const name = value.name;
    if (typeof name === "string" && name && !details.includes(name)) details.push(name);
    for (const key of ["shortMessage", "message", "details"]) {
      const entry = value[key];
      if (typeof entry === "string" && entry && !details.includes(entry)) details.push(entry);
    }
    const code = value.code;
    if ((typeof code === "number" || typeof code === "string") && !details.includes(`code ${code}`)) {
      details.push(`code ${code}`);
    }
    current = value.cause;
  }

  return details.join(" | ") || (typeof error === "string" ? error : "Unknown provider error");
}

function isBridgeKeyProviderUpdateError(error: unknown) {
  const diagnostic = getTransactionErrorDetails(error).toLowerCase();
  return diagnostic.includes("bridgekey] was updated")
    || diagnostic.includes("bridgekey was updated")
    || diagnostic.includes("extension context invalidated");
}

function refreshAfterBridgeKeyUpdate() {
  const recoveryKey = "robopay.bridgekey-provider-refresh-attempted";
  if (window.sessionStorage.getItem(recoveryKey) === "1") return false;
  window.sessionStorage.setItem(recoveryKey, "1");
  window.setTimeout(() => window.location.reload(), 250);
  return true;
}

export function RoboPayApp({ initialTab = "home" }: { initialTab?: PageName }) {
  const { address, chainId, isConnected, connector: activeConnector } = useAccount();
  const { connectAsync, connectors, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const { data: nativeBalance, isLoading: balanceLoading } = useBalance({
    address: address as `0x${string}` | undefined,
    chainId: mstTestnet.id,
    query: { enabled: Boolean(address) },
  });
  const [activeTab, setActiveTab] = useState<PageName>(initialTab);
  const [robots, setRobots] = useState<Robot[]>([]);
  const [rentals, setRentals] = useState<RentalDetail[]>([]);
  const [activeRentalTimings, setActiveRentalTimings] = useState<Record<string, ActiveRobotRentalResponse["rental"]>>({});
  const [contractEvents, setContractEvents] = useState<ContractEventRecord[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [eventLoadError, setEventLoadError] = useState<string | null>(null);
  const [robotPrices, setRobotPrices] = useState<Record<string, Array<{ durationMinutes: number; amountInr: bigint; payment: bigint }>>>({});
  const [selectedRobotId, setSelectedRobotId] = useState("RF-01");
  const [selectedDuration, setSelectedDuration] = useState(1);
  const [currentOrderId, setCurrentOrderId] = useState(createOrderId);
  const [verifyOrderId, setVerifyOrderId] = useState("");
  const [verificationResult, setVerificationResult] = useState<RentalVerificationState>({ status: "IDLE", orderId: "" });
  const [auditResult, setAuditResult] = useState<ActivityAuditState>({ status: "IDLE", orderId: "" });
  const [confirmation, setConfirmation] = useState<ConfirmationState>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [lastRentalTx, setLastRentalTx] = useState<{ orderId: string; hash: Hex } | null>(null);
  const [txState, setTxState] = useState<TransactionState>("DISCONNECTED");
  const [backendStatus, setBackendStatus] = useState<"healthy" | "degraded" | "unavailable" | "unknown">("unknown");
  const [rentalExpiryState, setRentalExpiryState] = useState<Record<string, { state: "ACTIVE" | "VERIFYING_SESSION" | "SETTLING" | "SETTLEMENT_RETRY_PENDING" | "REFUNDING" | "REFUND_RETRY_PENDING" | "PENDING" | "COMPLETED" | "REFUNDED"; message?: string; txHash?: Hex; paymentStatus?: string; robotStatus?: string; adminAddress?: string; activityHash?: string; anchorTxHash?: string; failureReasonHash?: string; evidenceMode?: RentalOutcomeResponse["evidenceMode"] }>>({});
  const [toast, setToast] = useState<ContractMessage | null>(null);
  const [isLoadingRobots, setIsLoadingRobots] = useState(true);
  const [isLoadingRentals, setIsLoadingRentals] = useState(false);
  const [packageLoadState, setPackageLoadState] = useState<PackageLoadState>("INITIAL");
  const [packageLoadError, setPackageLoadError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [orderSearch, setOrderSearch] = useState("");
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [isTransactionLocked, setIsTransactionLocked] = useState(false);
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState(() => Math.floor(Date.now() / 1000));
  const transactionLock = useRef(false);

  const hasWalletAccount = isConnected && Boolean(address);
  const walletConnected = hasWalletAccount && Number.isSafeInteger(chainId);
  const isMstTestnet = walletConnected && chainId === mstTestnet.id;
  const connectedAddress = usingAddress(walletConnected ? address : undefined);
  const walletResolving = connecting || (hasWalletAccount && chainId === undefined);
  const bridgeKeyConnector = connectors.find((connector) => connector.id === "bridgekey");
  const walletStatusText = !hasWalletAccount
    ? "Not connected"
    : chainId === undefined
      ? "Checking network"
      : isMstTestnet
        ? "MST Testnet Connected"
        : "Wrong Network";
  const selectedRobot = robots.find((robot) => robot.id === selectedRobotId) ?? robots[0];
  const walletRequiredPage = activeTab === "robot" || activeTab === "rentals" || activeTab === "history";

  useEffect(() => {
    if (!connectedAddress || !isMstTestnet) {
      setVerificationResult({ status: "IDLE", orderId: "" });
      setAuditResult({ status: "IDLE", orderId: "" });
    }
  }, [connectedAddress, isMstTestnet]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    setCurrentOrderId(createOrderId());
  }, [selectedRobotId, selectedDuration]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const health = await api.health();
        if (active) setBackendStatus(health.status === "healthy" ? "healthy" : health.status === "degraded" ? "degraded" : "unavailable");
      } catch {
        if (active) setBackendStatus("unavailable");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (walletConnected && isMstTestnet) {
      window.sessionStorage.removeItem("robopay.bridgekey-provider-refresh-attempted");
    }
  }, [walletConnected, isMstTestnet, address]);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTimeSeconds(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void refreshRobots();
    void refreshRentals();
    void refreshContractEvents();
    const refreshAvailability = () => {
      if (document.visibilityState === "visible") {
        void refreshRobots();
        void refreshRentals();
      }
    };
    const interval = window.setInterval(refreshAvailability, 15_000);
    document.addEventListener("visibilitychange", refreshAvailability);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshAvailability);
    };
    // Public contract reads keep availability accurate before wallet connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshRobots = async () => {
    if (!IS_ROBO_PAY_ESCROW_DEPLOYED) {
      setRobots([]);
      setIsLoadingRobots(false);
      return;
    }
    setIsLoadingRobots(true);
    try {
      const ids = (await publicClient.readContract({
        address: ROBO_PAY_ADDRESS,
        abi: ROBO_PAY_ABI,
        functionName: "getRobotIds",
      })) as string[];

      const nextRobots = await Promise.all(
        ids.map(async (robotId) => {
          const robotData = (await publicClient.readContract({
            address: ROBO_PAY_ADDRESS,
            abi: ROBO_PAY_ABI,
            functionName: "getRobot",
            args: [robotId],
          })) as [string, string, string, Address, number, boolean];

          return {
            id: robotData[0],
            name: robotData[1],
            service: robotData[2],
            owner: robotData[3],
            status: Number(robotData[4]) as RobotStatus,
            registered: robotData[5],
          } satisfies Robot;
        })
      );

      if (nextRobots.length > 0) {
        setRobots(nextRobots);
        const inUseRobots = nextRobots.filter((robot) => robot.status === 1);
        const timingEntries = await Promise.all(inUseRobots.map(async (robot) => {
          try {
            const result = await api.activeRobotRental(robot.id);
            return [robot.id, result.rental] as const;
          } catch (error) {
            console.warn(`Active rental timing unavailable for ${robot.id}`, error);
            return [robot.id, null] as const;
          }
        }));
        setActiveRentalTimings(Object.fromEntries(timingEntries));
        if (!nextRobots.some((robot) => robot.id === selectedRobotId)) {
          setSelectedRobotId(nextRobots[0].id);
        }
      }
    } catch (error) {
      console.error(error);
      setToast({ type: "error", text: "Unable to read robot data from the MST blockchain." });
    } finally {
      setIsLoadingRobots(false);
    }
  };

  const refreshRentals = async () => {
    if (!IS_ROBO_PAY_ESCROW_DEPLOYED) {
      setRentals([]);
      setIsLoadingRentals(false);
      return;
    }
    setIsLoadingRentals(true);
    try {
      const orderIds = (await publicClient.readContract({
        address: ROBO_PAY_ADDRESS,
        abi: ROBO_PAY_ABI,
        functionName: "getRentalOrderIds",
      })) as string[];

      const list = await Promise.all(
        orderIds.map(async (orderId) => {
          const rentalData = (await publicClient.readContract({
            address: ROBO_PAY_ADDRESS,
            abi: ROBO_PAY_ABI,
            functionName: "getRental",
            args: [orderId],
          })) as RentalTuple;

          const rental = rentalFromTuple(rentalData);
          if (rental.status === 1) {
            try {
              const logs = await publicClient.getLogs({
                address: ROBO_PAY_ADDRESS,
                event: parseAbiItem("event RentalSettled(string indexed orderId,string indexed robotId,address indexed recipient,uint256 amount,uint256 settledAt)"),
                args: { orderId },
                fromBlock: BigInt(0),
              });
              rental.settlementTxHash = logs.at(-1)?.transactionHash;
            } catch (error) {
              console.warn("Settlement event lookup unavailable; preserving on-chain rental state.", error);
            }
          } else if (rental.status === 2) {
            try {
              const logs = await publicClient.getLogs({
                address: ROBO_PAY_ADDRESS,
                event: parseAbiItem("event RentalRefunded(string indexed orderId,string indexed robotId,address indexed customer,uint256 amount,bytes32 failureReasonHash,bytes32 activityHash,uint256 refundedAt)"),
                args: { orderId },
                fromBlock: BigInt(0),
              });
              rental.refundTxHash = logs.at(-1)?.transactionHash;
            } catch (error) {
              console.warn("Refund event lookup unavailable; preserving on-chain rental state.", error);
            }
          }
          return rental;
        })
      );

      setRentals(list);
    } catch (error) {
      console.error(error);
      setRentals([]);
      setToast({ type: "error", text: "Unable to read rental history from the contract." });
    } finally {
      setIsLoadingRentals(false);
    }
  };

  const refreshContractEvents = async () => {
    if (!IS_ROBO_PAY_ESCROW_DEPLOYED) {
      setContractEvents([]);
      setEventLoadError(null);
      return;
    }

    setIsLoadingEvents(true);
    setEventLoadError(null);
    try {
      const latestBlock = await publicClient.getBlockNumber();
      const startBlock = latestBlock > BigInt(50_000) ? latestBlock - BigInt(50_000) : BigInt(0);
      const logs = await publicClient.getLogs({
        address: ROBO_PAY_ADDRESS,
        fromBlock: startBlock,
        toBlock: latestBlock,
      });
      const decodedLogs = parseEventLogs({ abi: ROBO_PAY_ABI, logs, strict: false });
      const nextEvents = decodedLogs
        .filter((log) => [
          "RobotRegistered",
          "RobotAvailabilityChanged",
          "RentalCreated",
          "ActivityHashRecorded",
          "RentalSettled",
          "RentalCompleted",
          "RentalRefunded",
        ].includes(log.eventName ?? ""))
        .map((log) => ({
          name: log.eventName ?? "ContractEvent",
          orderId: getEventOrderId(log.args),
          blockNumber: log.blockNumber ?? BigInt(0),
          transactionHash: log.transactionHash,
        }))
        .sort((left, right) => (left.blockNumber > right.blockNumber ? -1 : left.blockNumber < right.blockNumber ? 1 : 0))
        .slice(0, 25);
      setContractEvents(nextEvents);
    } catch (error) {
      console.error("Unable to read RoboPay escrow contract events", error);
      setContractEvents([]);
      setEventLoadError("Unable to load escrow events from MST Testnet. Retry when the RPC is available.");
    } finally {
      setIsLoadingEvents(false);
    }
  };

  useEffect(() => {
    if (!walletConnected || chainId === undefined) {
      setTxState("DISCONNECTED");
      return;
    }

    if (!isMstTestnet) {
      setTxState("CONNECTED_WRONG_NETWORK");
      return;
    }

    setTxState("CONNECTED_MST_TESTNET");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletConnected, address, chainId, isMstTestnet, connectedAddress]);

  useEffect(() => {
    if (!IS_ROBO_PAY_ESCROW_DEPLOYED) {
      setPackageLoadState("ERROR");
      setPackageLoadError("RoboPay escrow is not deployed to MST Testnet yet.");
      setRobotPrices((current) => ({ ...current, [selectedRobotId]: [] }));
      return;
    }
    if (!selectedRobotId) {
      setPackageLoadState("INITIAL");
      setPackageLoadError(null);
      return;
    }

    if (!walletConnected) {
      setPackageLoadState("WAITING_FOR_WALLET");
      setPackageLoadError(null);
      setRobotPrices((current) => ({ ...current, [selectedRobotId]: [] }));
      return;
    }

    if (!isMstTestnet) {
      setPackageLoadState("WAITING_FOR_NETWORK");
      setPackageLoadError(null);
      setRobotPrices((current) => ({ ...current, [selectedRobotId]: [] }));
      return;
    }

    let cancelled = false;

    const loadPrices = async () => {
      setPackageLoadState("LOADING");
      setPackageLoadError(null);

      const candidateDurations = [1, 2, 3];
      const nextPrices: Array<{ durationMinutes: number; amountInr: bigint; payment: bigint }> = [];

      for (const durationMinutes of candidateDurations) {
        try {
          const [amountInr, payment] = await Promise.all([
            publicClient.readContract({
              address: ROBO_PAY_ADDRESS,
              abi: ROBO_PAY_ABI,
              functionName: "requiredAmountInr",
              args: [selectedRobotId, BigInt(durationMinutes)],
            }),
            publicClient.readContract({
              address: ROBO_PAY_ADDRESS,
              abi: ROBO_PAY_ABI,
              functionName: "requiredPayment",
              args: [selectedRobotId, BigInt(durationMinutes)],
            }),
          ]);

          nextPrices.push({
            durationMinutes,
            amountInr: amountInr as bigint,
            payment: payment as bigint,
          });
        } catch (error) {
          console.warn(`Skipping unsupported package for ${selectedRobotId} at ${durationMinutes} minutes`, error);
        }
      }

      if (cancelled) return;

      if (nextPrices.length === 0) {
        setRobotPrices((current) => ({ ...current, [selectedRobotId]: [] }));
        setSelectedDuration(0);
        setPackageLoadState("EMPTY");
        setPackageLoadError("No valid rental packages are available for this robot.");
        return;
      }

      const sorted = [...nextPrices].sort((a, b) => a.durationMinutes - b.durationMinutes);
      setRobotPrices((current) => ({ ...current, [selectedRobotId]: sorted }));
      setSelectedDuration(sorted[0].durationMinutes);
      setPackageLoadState("SUCCESS");
      setPackageLoadError(null);
    };

    void loadPrices();

    return () => {
      cancelled = true;
    };
  }, [selectedRobotId, walletConnected, isMstTestnet]);

  const pricingForSelectedRobot = robotPrices[selectedRobotId] ?? [];
  const selectedPackage = pricingForSelectedRobot.find((entry) => entry.durationMinutes === selectedDuration) ?? pricingForSelectedRobot[0];
  const customerRentals = connectedAddress
    ? rentals.filter((rental) => rental.customer.toLowerCase() === connectedAddress.toLowerCase())
    : [];
  const historyRentals = [...customerRentals].sort((a, b) => Number(b.startTime - a.startTime));
  const availableRobotCount = robots.filter((robot) => robot.status === 0 && robot.registered).length;
  const activeRentalCount = customerRentals.filter((rental) => rental.active).length;
  const completedRentalCount = customerRentals.filter((rental) => rental.completed).length;
  const refundedRentalCount = customerRentals.filter((rental) => rental.refunded).length;

  const getRobotUsageMessage = (robotId: string) => {
    const activeRental = rentals.find((rental) => rental.robotId === robotId && rental.active);
    const backendRental = activeRentalTimings[robotId];
    if (!activeRental && !backendRental) return "IN_USE on MST Testnet; matching active rental timing is currently unavailable.";

    const endTimeSeconds = activeRental ? Number(activeRental.endTime) : Number(backendRental?.endTime);
    if (!Number.isFinite(endTimeSeconds)) return "IN_USE on MST Testnet; backend could not resolve a unique matching active rental.";
    const remainingSeconds = Math.max(endTimeSeconds - currentTimeSeconds, 0);
    const endTime = new Date(endTimeSeconds * 1000).toLocaleString();
    if (remainingSeconds === 0) {
      const orderId = activeRental?.orderId ?? backendRental?.orderId;
      const finalization = orderId ? rentalExpiryState[orderId] : undefined;
      if (finalization?.state === "SETTLING") return `Usage period ended at ${endTime}. Verified session success is settling escrow on MST Testnet; robot availability remains IN_USE until chain confirmation.`;
      if (finalization?.state === "REFUNDING") return `Usage period ended at ${endTime}. Verified robot failure is refunding escrow on MST Testnet; robot availability remains IN_USE until chain confirmation.`;
      if (finalization?.state === "SETTLEMENT_RETRY_PENDING") return `Usage period ended at ${endTime}. Settlement retry pending; payment remains escrowed and the robot remains IN_USE.`;
      if (finalization?.state === "REFUND_RETRY_PENDING") return `Usage period ended at ${endTime}. Refund retry pending; payment remains escrowed and the robot remains IN_USE.`;
      if (finalization?.state === "PENDING") return `Usage period ended at ${endTime}. Robot-session outcome is not yet verifiable; payment remains escrowed and the robot remains IN_USE.`;
      if (finalization?.state === "COMPLETED") return `Usage period ended at ${endTime}. MST Testnet confirmed settlement; the robot is AVAILABLE.`;
      if (finalization?.state === "REFUNDED") return `Usage period ended at ${endTime}. MST Testnet confirmed refund; the robot is AVAILABLE.`;
      return `Usage period ended at ${endTime}. Verifying robot-session evidence; the robot remains IN_USE until settlement or refund is confirmed on MST Testnet.`;
    }

    const hours = Math.floor(remainingSeconds / 3600);
    const minutes = Math.floor((remainingSeconds % 3600) / 60);
    const seconds = remainingSeconds % 60;
    return `Usage ends at ${endTime} (${hours}h ${minutes}m ${seconds}s remaining). Availability updates only after on-chain completion.`;
  };

  const handleSwitchToMstTestnet = async () => {
    if (!switchChainAsync) return;
    try {
      const switchedChainId = await switchChainAsync({ chainId: mstTestnet.id });
      if (switchedChainId.id !== mstTestnet.id) {
        throw new Error(`BridgeKey reported chain ${switchedChainId.id} after switching.`);
      }
      setToast({ type: "success", text: "Switched to MST Testnet." });
    } catch (error) {
      console.error(error);
      setToast({ type: "error", text: "Unable to switch to MST Testnet." });
    }
  };

  const handleConnect = async (connector: (typeof connectors)[number] | undefined) => {
    console.info("[BridgeKey] connect clicked");
    if (!connector) {
      setToast({ type: "error", text: "BridgeKey connector is unavailable." });
      return;
    }

    try {
      setTxState("CONNECTING");
      const provider = await connector.getProvider() as BridgeKeyEip1193Provider | undefined;
      const isBridgeKeyProvider = provider?.isBridgeKey === true;
      if (process.env.NODE_ENV === "development") {
        console.info("[wallet] connector/provider", {
          connectorId: connector.id,
          connectorName: connector.name,
          connectorType: connector.type,
          providerDetected: Boolean(provider),
          isBridgeKeyProvider,
        });
      }
      if (!provider) throw new Error("BridgeKey provider unavailable.");
      if (!isBridgeKeyProvider) throw new Error("The selected provider did not identify itself as BridgeKey.");

      const result = await connectAsync({ connector });
      const connectedAccount = result.accounts[0];
      if (!connectedAccount || !Number.isSafeInteger(result.chainId)) {
        throw new Error("BridgeKey did not return both an account and a chain ID.");
      }

      console.info("[BridgeKey] account", connectedAccount);
      console.info("[BridgeKey] chainId", result.chainId);
      if (process.env.NODE_ENV === "development") {
        console.info("[wallet] connected", {
          connectorId: connector.id,
          connectorName: connector.name,
          providerDetected: true,
          isBridgeKeyProvider,
          account: connectedAccount,
          chainId: result.chainId,
        });
      }
      if (result.chainId === mstTestnet.id) {
        window.sessionStorage.removeItem("robopay.bridgekey-provider-refresh-attempted");
        setTxState("CONNECTED_MST_TESTNET");
        setToast({ type: "success", text: "BridgeKey connected to MST Testnet." });
      } else {
        setTxState("CONNECTED_WRONG_NETWORK");
        setToast({ type: "info", text: `BridgeKey connected on chain ${result.chainId}. Switch to MST Testnet.` });
      }
      console.info("[BridgeKey] connection complete");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown provider error";
      console.error("[BridgeKey] connection failed", { name: error instanceof Error ? error.name : "Error", message });
      if (isBridgeKeyProviderUpdateError(error)) {
        setTxState("PROVIDER_REFRESH_REQUIRED");
        setToast({ type: "info", text: "BridgeKey updated its wallet session. RoboPay is reconnecting." });
        if (refreshAfterBridgeKeyUpdate()) return;
      }
      const normalized = message.toLowerCase();
      setTxState(normalized.includes("reject") ? "USER_REJECTED" : "DISCONNECTED");
      setToast({
        type: "error",
        text: normalized.includes("reject")
          ? "BridgeKey connection was rejected."
          : normalized.includes("loading")
            ? "BridgeKey is still initializing. Try again shortly."
            : normalized.includes("not detected")
              ? "BridgeKey provider was not detected in this browser."
              : "BridgeKey connection failed. Check the browser console for provider diagnostics.",
      });
    }
  };

  const getFreshBridgeKeySession = async (expectedAccount: Address) => {
    const connector = activeConnector;
    if (!connector) throw new Error("BridgeKey connector is not connected.");

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const provider = await connector.getProvider() as BridgeKeyEip1193Provider | undefined;
      if (!provider || provider.isBridgeKey !== true) {
        throw new Error("BridgeKey provider unavailable.");
      }

      try {
        const accounts = await provider.request({ method: "eth_accounts" });
        const liveChain = await provider.request({ method: "eth_chainId" });
        const liveAccount = Array.isArray(accounts) ? usingAddress(accounts[0]) : undefined;
        const liveChainId = typeof liveChain === "string" ? Number(BigInt(liveChain)) : NaN;
        if (!liveAccount) throw new Error("BridgeKey returned no selected account.");
        if (liveAccount.toLowerCase() !== expectedAccount.toLowerCase()) {
          throw new Error("BridgeKey account changed. Select the intended customer account and retry.");
        }
        if (liveChainId !== mstTestnet.id) {
          throw new Error(`Wrong network: BridgeKey is on chain ${liveChainId}; MST Testnet (${mstTestnet.id}) is required.`);
        }

        const walletClient = createWalletClient({
          account: liveAccount,
          chain: mstTestnet,
          transport: custom(provider),
        });
        return { provider, walletClient, account: liveAccount, chainId: liveChainId };
      } catch (error) {
        lastError = error;
        if (!isBridgeKeyProviderUpdateError(error) || attempt === 1) throw error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error("BridgeKey wallet session could not be refreshed.");
  };

  const createUniqueOrderId = async (candidateOrderId: string) => {
    let nextOrder = candidateOrderId;
    let exists = true;

    while (exists) {
      exists = (await publicClient.readContract({
        address: ROBO_PAY_ADDRESS,
        abi: ROBO_PAY_ABI,
        functionName: "orderExists",
        args: [nextOrder],
      })) as boolean;

      if (!exists) break;
      nextOrder = createOrderId();
    }

    return nextOrder;
  };

  const runRentFlow = async () => {
    if (!IS_ROBO_PAY_ESCROW_DEPLOYED) {
      setValidationError("RoboPay escrow has not been deployed to MST Testnet. No payment can be submitted.");
      return;
    }
    if (!connectedAddress) {
      setValidationError("Wallet not connected.");
      return;
    }

    if (!isMstTestnet) {
      setValidationError("Switch to MST Testnet before renting a robot.");
      return;
    }

    const robot = robots.find((entry) => entry.id === selectedRobotId);
    if (!robot) {
      setValidationError("This robot is not available in the contract registry.");
      return;
    }

    const packageEntry = selectedPackage;
    if (!packageEntry) {
      setValidationError("Choose a valid rental package.");
      return;
    }

    if (robot.status !== 0) {
      setValidationError("Robot is not available. Please choose another robot.");
      return;
    }

    const nextOrderId = await createUniqueOrderId(currentOrderId);
    const orderPayload = {
      orderId: nextOrderId,
      robotId: robot.id,
      service: robot.service,
      durationMinutes: Number(packageEntry.durationMinutes),
      amountInr: packageEntry.amountInr,
      payment: packageEntry.payment,
      customer: connectedAddress,
    };

    setConfirmation(orderPayload);
    setTxHash(null);
    setTxState("TRANSACTION_PENDING");
    setValidationError(null);
  };

  const confirmPayment = async () => {
    if (!IS_ROBO_PAY_ESCROW_DEPLOYED) {
      setToast({ type: "error", text: "RoboPay escrow is not deployed on MST Testnet. Payment was not submitted." });
      return;
    }
    if (transactionLock.current || !confirmation || !connectedAddress || !isMstTestnet) return;
    if (confirmation.customer.toLowerCase() !== connectedAddress.toLowerCase()) {
      setToast({ type: "error", text: "The connected wallet changed. Recreate the rental confirmation." });
      setConfirmation(null);
      return;
    }

    const lock = confirmation;
    const account = connectedAddress;
    let submittedHash: Hex | undefined;
    let transactionStage = "refreshing the live BridgeKey session";
    transactionLock.current = true;
    setIsTransactionLocked(true);
    setIsSubmittingPayment(true);
    setTxState("TRANSACTION_PENDING");
    setToast({ type: "info", text: "Waiting for BridgeKey transaction approval…" });

    const requestTimeout = window.setTimeout(() => {
      setIsSubmittingPayment(false);
      setTxState("TRANSACTION_REQUEST_TIMEOUT");
      setToast({ type: "error", text: "BridgeKey did not respond. Please try again." });
    }, 90_000);

    try {
      const session = await getFreshBridgeKeySession(account);
      const { walletClient, account: freshAccount, chainId: freshChainId } = session;
      if (process.env.NODE_ENV === "development") {
        console.info("[wallet] refreshed transaction identity", {
          connectorId: activeConnector?.id,
          connectorName: activeConnector?.name,
          providerDetected: true,
          account: freshAccount,
          chainId: freshChainId,
        });
      }

      transactionStage = "checking robot availability, order ID, contract package price and customer balance";
      const [robotPreflightData, orderExists, requiredPayment, requiredAmountInr, balance] = await Promise.all([
        publicClient.readContract({
          address: ROBO_PAY_ADDRESS,
          abi: ROBO_PAY_ABI,
          functionName: "getRobot",
          args: [lock.robotId],
        }),
        publicClient.readContract({
          address: ROBO_PAY_ADDRESS,
          abi: ROBO_PAY_ABI,
          functionName: "orderExists",
          args: [lock.orderId],
        }),
        publicClient.readContract({
          address: ROBO_PAY_ADDRESS,
          abi: ROBO_PAY_ABI,
          functionName: "requiredPayment",
          args: [lock.robotId, BigInt(lock.durationMinutes)],
        }),
        publicClient.readContract({
          address: ROBO_PAY_ADDRESS,
          abi: ROBO_PAY_ABI,
          functionName: "requiredAmountInr",
          args: [lock.robotId, BigInt(lock.durationMinutes)],
        }),
        publicClient.getBalance({ address: freshAccount }),
      ]);

      const robot = robotPreflightData as [string, string, string, Address, number, boolean];
      if (!robot[5]) throw new Error(`Robot ${lock.robotId} is not registered on the contract.`);
      if (Number(robot[4]) !== 0) {
        await refreshRobots();
        throw new Error(`Robot ${lock.robotId} is currently IN_USE on MST Testnet.`);
      }
      if (orderExists) throw new Error(`Order ID ${lock.orderId} already exists. Create a new rental confirmation.`);

      if (requiredPayment !== lock.payment || requiredAmountInr !== lock.amountInr) {
        throw new Error("The selected package no longer matches the contract price. Re-select the package.");
      }
      if (balance < requiredPayment) throw new Error("Insufficient tMSTC balance for the rental payment.");

      console.info("[BridgeKey] rentRobot request", {
        target: ROBO_PAY_ADDRESS,
        chainId: mstTestnet.id,
        from: account,
        functionName: "rentRobot",
        orderId: lock.orderId,
        robotId: lock.robotId,
        service: lock.service,
        durationMinutes: lock.durationMinutes,
        amountInr: lock.amountInr.toString(),
        nativeValueWei: requiredPayment.toString(),
      });

      const walletClientAccount = walletClient.account.address;

      transactionStage = "estimating rentRobot gas through the MST Testnet RPC";
      const transactionArgs = [
        lock.orderId,
        lock.robotId,
        lock.service,
        BigInt(lock.durationMinutes),
        BigInt(lock.amountInr),
      ] as const;
      const gas = await publicClient.estimateContractGas({
        address: ROBO_PAY_ADDRESS,
        abi: ROBO_PAY_ABI,
        functionName: "rentRobot",
        args: transactionArgs,
        account: freshAccount,
        value: requiredPayment,
      });
      const [gasPrice, balanceAfterEstimate] = await Promise.all([
        publicClient.getGasPrice(),
        publicClient.getBalance({ address: freshAccount }),
      ]);
      if (balanceAfterEstimate < requiredPayment + gas * gasPrice) {
        throw new Error("Insufficient tMSTC balance to cover rental payment and estimated network fees.");
      }

      transactionStage = "BridgeKey eth_sendTransaction wallet approval";
      console.info("[BridgeKey] walletClient.writeContract using active BridgeKey signer; expected wallet RPC: eth_sendTransaction", {
        estimatedGas: gas.toString(),
        walletClientAccount,
        walletClientChainId: walletClient.chain.id,
      });
      const txHashValue = await walletClient.writeContract({
        address: ROBO_PAY_ADDRESS,
        abi: ROBO_PAY_ABI,
        functionName: "rentRobot",
        args: transactionArgs,
        account: freshAccount,
        chain: mstTestnet,
        gas,
        value: requiredPayment,
      });

      submittedHash = txHashValue;
      window.sessionStorage.removeItem("robopay.bridgekey-provider-refresh-attempted");
      setLastRentalTx({ orderId: lock.orderId, hash: txHashValue });
      window.clearTimeout(requestTimeout);
      setIsSubmittingPayment(false);
      setTxHash(txHashValue);
      setTxState("TRANSACTION_SUBMITTED");
      setToast({ type: "info", text: "Transaction submitted. Waiting for MST Testnet confirmation." });

      transactionStage = "waiting for MST Testnet receipt";
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHashValue, timeout: 120_000 });
      if (!receipt) {
        throw new Error("Transaction receipt not available.");
      }
      if (receipt.status !== "success") {
        throw new Error("The rental transaction reverted on MST Testnet.");
      }

      transactionStage = "verifying getRental and getRobot state";
      const rentalData = (await publicClient.readContract({
        address: ROBO_PAY_ADDRESS,
        abi: ROBO_PAY_ABI,
        functionName: "getRental",
        args: [lock.orderId],
      })) as RentalTuple;
      const eventRental = rentalFromTuple(rentalData);
      const escrowedAmount = await publicClient.readContract({
        address: ROBO_PAY_ADDRESS,
        abi: ROBO_PAY_ABI,
        functionName: "escrowedAmount",
        args: [lock.orderId],
      });

      if (!eventRental.active || eventRental.status !== 0 || escrowedAmount !== eventRental.amountPaidWei) {
        throw new Error("The mined transaction did not create an active rental with matching contract escrow.");
      }

      const robotData = (await publicClient.readContract({
        address: ROBO_PAY_ADDRESS,
        abi: ROBO_PAY_ABI,
        functionName: "getRobot",
        args: [lock.robotId],
      })) as [string, string, string, Address, number, boolean];
      if (Number(robotData[4]) !== 1) {
        throw new Error("The rental is active, but the robot state has not updated to IN_USE.");
      }

      setRentals((current) => [eventRental, ...current]);
      await refreshRobots();
      setTxState("TRANSACTION_CONFIRMED");
      setConfirmation(null);

      try {
        setTxState("VERIFYING");
        const verification = await api.verifyTransaction({
          orderId: lock.orderId,
          transactionHash: txHashValue,
          customerAddress: connectedAddress,
        });
        setTxState(verification.verified ? "VERIFIED" : "FAILED");
        if (verification.verified) {
          setToast({ type: "success", text: `Blockchain transaction confirmed. Backend verification succeeded for order ${lock.orderId}.` });
        } else {
          setToast({ type: "error", text: `Blockchain transaction confirmed, but backend verification did not pass for order ${lock.orderId}.` });
        }
      } catch (error) {
        setTxState("UNAVAILABLE");
        setToast({
          type: "info",
          text: `Blockchain transaction confirmed. Backend verification is currently unavailable.`,
        });
        console.warn("Backend verification unavailable after successful BridgeKey transaction", error);
      }

      setActiveTab("rentals");
      setToast((current) => current ?? { type: "success", text: `Rental ${lock.orderId} is active. Payment is escrowed in the RoboPay contract.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Transaction failed";
      const diagnostic = getTransactionErrorDetails(error);
      const output = diagnostic.toLowerCase();
      if (submittedHash) {
        setTxHash(submittedHash);
        setTxState("TRANSACTION_SUBMITTED");
        setToast({ type: "error", text: "Transaction was submitted, but confirmation is delayed. Check MSTScan." });
      } else {
        setTxState(output.includes("reject") ? "USER_REJECTED" : "TRANSACTION_FAILED");
        if (isBridgeKeyProviderUpdateError(error)) {
          setTxState("PROVIDER_REFRESH_REQUIRED");
          setToast({ type: "info", text: "BridgeKey refreshed its provider. RoboPay is reconnecting to the updated wallet session." });
          if (refreshAfterBridgeKeyUpdate()) return;
        }
        setToast({
          type: "error",
          text: output.includes("reject")
            ? "BridgeKey rejected the transaction request."
            : output.includes("switch to mst testnet")
              ? "Switch to MST Testnet."
                : output.includes("provider unavailable")
                  ? "BridgeKey provider unavailable."
              : output.includes("-32601") || output.includes("method not found") || output.includes("unsupported method")
                ? `BridgeKey transaction method unsupported: ${diagnostic}`
                : process.env.NODE_ENV === "development"
                  ? `Transaction failed during ${transactionStage}: ${diagnostic}`
                  : "BridgeKey transaction request failed.",
        });
      }
      console.error("[BridgeKey] rentRobot failed", {
        stage: transactionStage,
        name: error instanceof Error ? error.name : "Error",
        message,
        diagnostic,
        error,
      });
    } finally {
      window.clearTimeout(requestTimeout);
      setIsSubmittingPayment(false);
      transactionLock.current = false;
      setIsTransactionLocked(false);
    }
  };

  const readRentalRecord = useCallback(async (orderId: string): Promise<RentalDetail | null> => {
    if (!IS_ROBO_PAY_ESCROW_DEPLOYED) return null;
    const exists = await publicClient.readContract({
      address: ROBO_PAY_ADDRESS,
      abi: ROBO_PAY_ABI,
      functionName: "orderExists",
      args: [orderId],
    });
    if (!exists) return null;

    const rentalData = (await publicClient.readContract({
      address: ROBO_PAY_ADDRESS,
      abi: ROBO_PAY_ABI,
      functionName: "getRental",
      args: [orderId],
    })) as RentalTuple;

    const rental = rentalFromTuple(rentalData);
    try {
      if (rental.status === 1) {
        const logs = await publicClient.getLogs({
          address: ROBO_PAY_ADDRESS,
          event: parseAbiItem("event RentalSettled(string indexed orderId,string indexed robotId,address indexed recipient,uint256 amount,uint256 settledAt)"),
          args: { orderId },
          fromBlock: BigInt(0),
        });
        rental.settlementTxHash = logs.at(-1)?.transactionHash;
      } else if (rental.status === 2) {
        const logs = await publicClient.getLogs({
          address: ROBO_PAY_ADDRESS,
          event: parseAbiItem("event RentalRefunded(string indexed orderId,string indexed robotId,address indexed customer,uint256 amount,bytes32 failureReasonHash,bytes32 activityHash,uint256 refundedAt)"),
          args: { orderId },
          fromBlock: BigInt(0),
        });
        rental.refundTxHash = logs.at(-1)?.transactionHash;
      }
    } catch (error) {
      console.warn("Outcome event lookup unavailable; transaction hash is not claimed.", error);
    }
    return rental;
  }, []);

  const verifyRentalOrder = async (rawOrderId: string) => {
    const orderId = rawOrderId.trim();
    if (!orderId) {
      setVerificationResult({ status: "ERROR", orderId, message: "Enter an Order ID to verify." });
      return;
    }
    setVerificationResult({ status: "LOADING", orderId });
    try {
      const rental = await readRentalRecord(orderId);
      if (!rental) {
        setVerificationResult({ status: "NOT_FOUND", orderId });
        return;
      }

      const computedHash = computeRentalDataHash(
        rental.orderId,
        rental.robotId,
        rental.service,
        Number(rental.durationMinutes),
        rental.amountInr,
        rental.customer,
        rental.startTime,
        rental.endTime,
      );
      const contractVerification = await publicClient.readContract({
        address: ROBO_PAY_ADDRESS,
        abi: ROBO_PAY_ABI,
        functionName: "verifyRentalDataHash",
        args: [rental.orderId, computedHash],
      }) as boolean;
      const dataHashMatches = contractVerification && computedHash.toLowerCase() === rental.rentalDataHash.toLowerCase();
      let robotStatus: RobotStatus | null = null;
      try {
        const robotData = await publicClient.readContract({
          address: ROBO_PAY_ADDRESS,
          abi: ROBO_PAY_ABI,
          functionName: "getRobot",
          args: [rental.robotId],
        }) as [string, string, string, Address, number, boolean];
        robotStatus = Number(robotData[4]) as RobotStatus;
      } catch (error) {
        console.warn("Unable to read robot state during rental verification", error);
      }

      const [paymentRecipient, activityVerification, outcome] = await Promise.all([
        publicClient.readContract({ address: ROBO_PAY_ADDRESS, abi: ROBO_PAY_ABI, functionName: "paymentRecipient" }).then((value) => value as Address).catch(() => null),
        api.verifyActivity(orderId).catch(() => null),
        api.rentalOutcome(orderId).catch(() => null),
      ]);

      setVerificationResult({ status: "FOUND", orderId, rental, dataHashMatches, robotStatus, paymentRecipient, activityVerification, outcome });
    } catch (error) {
      console.error("Rental verification failed", error);
      setVerificationResult({ status: "ERROR", orderId, message: "Unable to read this rental from MST Testnet. Check the network and retry." });
    }
  };

  const loadActivityAudit = async (rawOrderId: string) => {
    const orderId = rawOrderId.trim();
    if (!orderId) {
      setAuditResult({ status: "ERROR", orderId, message: "Enter an Order ID to load its robot session audit." });
      return;
    }
    setAuditResult({ status: "LOADING", orderId });
    try {
      const rental = await readRentalRecord(orderId);
      if (!rental) {
        setAuditResult({ status: "NOT_FOUND", orderId });
        return;
      }

      const hasActivityHash = !/^0x0{64}$/i.test(rental.activityHash);
      const [audit, verification, outcome] = await Promise.all([
        api.audit(orderId).catch(() => null),
        api.verifyActivity(orderId).catch(() => null),
        api.rentalOutcome(orderId).catch(() => null),
      ]);
      setAuditResult({ status: hasActivityHash ? "ANCHORED" : "PENDING", orderId, rental, audit, verification, outcome });
    } catch (error) {
      console.error("Activity audit lookup failed", error);
      setAuditResult({ status: "ERROR", orderId, message: "Unable to load this rental from MST Testnet. Check the network and retry." });
    }
  };

  const finalizeExpiredRental = useCallback(async (orderId: string) => {
    try {
      const outcome = await api.rentalOutcome(orderId);
      const messages = {
        ACTIVE: "Rental Active",
        VERIFYING_SESSION: "VERIFYING ROBOT SESSION...",
        SETTLING: "💰 SETTLING ESCROW...",
        SETTLEMENT_RETRY_PENDING: "Settlement retry pending. Payment remains escrowed.",
        REFUNDING: "💰 REFUNDING ESCROW...",
        REFUND_RETRY_PENDING: "Refund retry pending. Payment remains escrowed.",
        PENDING: "Robot session outcome is not yet verifiable.",
        COMPLETED: "✅ RENTAL COMPLETED · PAYMENT SETTLED · ROBOT AVAILABLE",
        REFUNDED: "✅ RENTAL REFUNDED · REFUND CONFIRMED · ROBOT AVAILABLE",
      } satisfies Record<typeof outcome.state, string>;
      const txHash = outcome.settlementTxHash ?? outcome.refundTxHash;
      setRentalExpiryState((current) => {
        const nextState = {
          state: outcome.state,
          message: messages[outcome.state],
          paymentStatus: outcome.paymentStatus,
          robotStatus: outcome.robotStatus,
          adminAddress: outcome.adminAddress,
          activityHash: outcome.activityHash,
          anchorTxHash: outcome.anchorTxHash ?? undefined,
          failureReasonHash: outcome.failureReasonHash ?? undefined,
          evidenceMode: outcome.evidenceMode,
          ...(txHash ? { txHash: txHash as Hex } : {}),
        };
        const previous = current[orderId];
        if (previous?.state === nextState.state && previous.message === nextState.message && previous.txHash === nextState.txHash && previous.paymentStatus === nextState.paymentStatus && previous.robotStatus === nextState.robotStatus) return current;
        return { ...current, [orderId]: nextState };
      });
    } catch (error) {
      console.error("Expired rental outcome lookup failed", error);
      setRentalExpiryState((current) => ({
        ...current,
        [orderId]: { state: "PENDING", message: "Robot session outcome is not yet verifiable." },
      }));
    }
  }, []);

  useEffect(() => {
    if (!historyRentals.length) return;

    const pendingOrders = historyRentals.filter((rental) => rental.active && Number(rental.endTime) <= currentTimeSeconds);
    if (pendingOrders.length === 0) return;

    const tick = async () => {
      for (const rental of pendingOrders) {
        const currentState = rentalExpiryState[rental.orderId]?.state;
        if (currentState === "COMPLETED" || currentState === "REFUNDED") continue;
        await finalizeExpiredRental(rental.orderId);
      }
    };

    const timer = window.setInterval(() => {
      void tick();
    }, 5000);

    void tick();
    return () => window.clearInterval(timer);
  }, [historyRentals, currentTimeSeconds, finalizeExpiredRental, rentalExpiryState]);

  const renderHome = () => (
    <div className="page-shell">
      <section className="hero glass-card">
        <div className="hero-copy">
          <span className="eyebrow">RoboPay Smart Mall</span>
          <h1>Rent Robots. Pay On-Chain. Trust Every Session.</h1>
          <p>
            Customer payments stay in the RoboPay escrow contract while a robot session runs. Verified success settles to the operator; verified failure refunds the original customer.
          </p>
          <div className="cta-row">
            {!walletConnected ? (
              <button className="primary" onClick={() => handleConnect(bridgeKeyConnector)} disabled={walletResolving}>
                {walletResolving ? "Connecting…" : "Connect BridgeKey"}
              </button>
            ) : (
              <button className="primary" onClick={() => setActiveTab("robots")}>Explore Robots</button>
            )}
            <button className="secondary" onClick={() => setActiveTab("robots")}>Explore Robots</button>
          </div>
        </div>
        <div className="hero-visual">
          <div className="visual-grid">
            <div className="visual-card visual-card-main">MST Testnet + Robotics</div>
            <div className="visual-card visual-card-small">Native tMSTC</div>
            <div className="visual-card visual-card-small">Hash Audit Trail</div>
            <div className="visual-card visual-card-main">Rental Contract</div>
          </div>
        </div>
      </section>

      <section className="feature-grid">
        <div className="glass-card feature-card">
          <h3>Blockchain Rental Authorization</h3>
          <p>Each rental is stored on MST Testnet and its exact native payment remains in contract escrow until an authorized outcome is recorded.</p>
        </div>
        <div className="glass-card feature-card">
          <h3>Tamper-Evident Rental History</h3>
          <p>Every rental has an on-chain hash that can be independently verified against the stored session data.</p>
        </div>
        <div className="glass-card feature-card">
          <h3>Robot Activity Audit Trail</h3>
          <p>Activity hashes are recorded to prove the robot session has not been silently altered after the fact.</p>
        </div>
        <div className="glass-card feature-card">
          <h3>On-Chain Availability State</h3>
          <p>Robot availability is not a mock frontend flag; it is derived directly from the RoboPay contract.</p>
        </div>
      </section>

      <section className="glass-card process-card">
        <h2>How It Works</h2>
        <div className="steps">
          {["Connect BridgeKey", "Choose Robot", "Select Package", "Pay with tMSTC", "Robot Activated", "Session Audited"].map((step, index) => (
            <div key={step} className="step-item">
              <span>{index + 1}</span>
              <strong>{step}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="glass-card proof-card">
        <h2>Blockchain Proof</h2>
        <div className="proof-grid">
          <div><label>Network</label><strong>MST Testnet</strong></div>
          <div><label>Chain ID</label><strong>{mstTestnet.id}</strong></div>
          <div><label>Escrow contract</label><strong>{IS_ROBO_PAY_ESCROW_DEPLOYED ? shortenAddress(ROBO_PAY_ADDRESS) : "Not deployed"}</strong></div>
          <div><label>Explorer</label>{IS_ROBO_PAY_ESCROW_DEPLOYED ? <a href={CONTRACT_SCAN_URL} target="_blank" rel="noreferrer">View on MSTScan</a> : <strong>MST Testnet</strong>}</div>
        </div>
      </section>
    </div>
  );

  const renderDashboard = () => (
    <div className="page-shell">
      <section className="glass-card dashboard-top">
        <div>
          <span className="eyebrow">Customer wallet</span>
          <h2>{walletConnected && address ? shortenAddress(address) : "Not connected"}</h2>
        </div>
        <div className="meta-stack">
          <div><label>Network</label><strong>{walletStatusText}</strong></div>
          <div><label>Balance</label><strong>{walletConnected && nativeBalance ? `${formatEther(nativeBalance.value)} tMSTC` : walletConnected && balanceLoading ? "Loading…" : "Balance unavailable"}</strong></div>
        </div>
      </section>

      <section className="stat-grid">
        <div className="glass-card stat-card"><span>Available robots</span><strong>{availableRobotCount}</strong></div>
        <div className="glass-card stat-card"><span>Active rentals</span><strong>{activeRentalCount}</strong></div>
        <div className="glass-card stat-card"><span>Completed rentals</span><strong>{completedRentalCount}</strong></div>
        <div className="glass-card stat-card"><span>Refunded rentals</span><strong>{refundedRentalCount}</strong></div>
        <div className="glass-card stat-card"><span>Total rentals</span><strong>{customerRentals.length}</strong></div>
      </section>

      <section className="glass-card list-card">
        <div className="section-header">
          <h3>Available Robot catalog</h3>
        </div>
        {isLoadingRobots ? (
          <div className="loading-block">Loading robot status from blockchain…</div>
        ) : (
          robots.length === 0 ? <div className="loading-block">{IS_ROBO_PAY_ESCROW_DEPLOYED ? "No robots are registered in the RoboPay escrow contract." : "The new RoboPay escrow contract has not been deployed to MST Testnet. The legacy contract is intentionally not used."}</div> :
          <div className="robot-grid">
            {robots.map((robot) => (
              <div key={robot.id} className="robot-card glass-subcard">
                <div className="robot-head">
                  <div>
                    <div className="mini-label">{robot.id}</div>
                    <h4>{robot.name}</h4>
                  </div>
                  <span className={`status-pill ${robot.status === 0 ? "status-available" : "status-inuse"}`}>{formatRobotStatus(robot.status)}</span>
                </div>
                <p>{robot.service}</p>
                {robot.status === 1 ? <p className="network-banner">{getRobotUsageMessage(robot.id)}</p> : null}
                <div className="pricing-list">
                  {(robotPricingMap[robot.id] ?? [1, 2, 3]).map((duration) => {
                    const price = robotPrices[robot.id]?.find((item) => item.durationMinutes === duration);
                    return (
                      <div key={duration} className="mini-package">
                        <span>{duration} min</span>
                        <strong>{price ? `₹${Number(price.amountInr).toLocaleString()}` : "—"}</strong>
                        <small>{price ? `${formatEther(price.payment)} tMSTC` : "—"}</small>
                      </div>
                    );
                  })}
                </div>
                <button className="primary compact" disabled={robot.status !== 0} onClick={() => {
                  setSelectedRobotId(robot.id);
                  setSelectedDuration(robotPricingMap[robot.id]?.[0] ?? 1);
                  setActiveTab("robot");
                }}>{robot.status === 1 ? "Currently in use" : "Select robot"}</button>
              </div>
            ))}
            {IS_ROBO_PAY_ESCROW_DEPLOYED && !robots.some((robot) => robot.id === "RC-01") ? (
              <div className="robot-card glass-subcard">
                <div className="robot-head">
                  <div>
                    <div className="mini-label">RC-01</div>
                    <h4>RoboCourier</h4>
                  </div>
                  <span className="status-pill status-inuse">NOT DEPLOYED</span>
                </div>
                <p>Autonomous Parcel Delivery</p>
                <p className="network-banner">RoboCourier is configured in the source but is not registered in the current MST Testnet contract. It cannot be booked until a compatible contract is safely deployed.</p>
                <div className="pricing-list">
                  {[1, 2, 3].map((duration) => (
                    <div key={duration} className="mini-package">
                      <span>{duration} min</span>
                      <strong>Deployment pending</strong>
                      <small>Not bookable on this contract</small>
                    </div>
                  ))}
                </div>
                <button className="secondary compact" disabled>Awaiting contract deployment</button>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );

  const renderRobotDetail = () => (
    <div className="page-shell">
      <section className="glass-card detail-card">
        <div className="section-header">
          <div>
            <span className="eyebrow">Robot rental</span>
            <h2>{selectedRobot?.name ?? "Loading robot"}</h2>
          </div>
          <span className={`status-pill ${selectedRobot?.status === 0 ? "status-available" : "status-inuse"}`}>{selectedRobot ? formatRobotStatus(selectedRobot.status) : "LOADING"}</span>
        </div>

        <div className="detail-meta">
          <div><label>Robot ID</label><strong>{selectedRobot?.id}</strong></div>
          <div><label>Service</label><strong>{selectedRobot?.service}</strong></div>
          <div><label>Current availability</label><strong>{selectedRobot ? formatRobotStatus(selectedRobot.status) : "—"}</strong></div>
        </div>

        {selectedRobot?.status === 1 ? (
          <div className="network-banner">{getRobotUsageMessage(selectedRobot.id)}</div>
        ) : null}

        {(!walletConnected || !isMstTestnet) && (
          <div className="network-banner">
            {!walletConnected
              ? "Connect BridgeKey to load rental packages."
              : chainId === undefined
                ? "Waiting for BridgeKey network information."
                : "Switch to MST Testnet to load rental packages."}
          </div>
        )}

        <div className="package-panel">
          {packageLoadState === "WAITING_FOR_WALLET" && (
            <div className="loading-block">Connect BridgeKey to load rental packages.</div>
          )}
          {packageLoadState === "WAITING_FOR_NETWORK" && (
            <div className="loading-block">
              <span>Switch to MST Testnet to load rental packages.</span>
              <button className="secondary compact" onClick={handleSwitchToMstTestnet}>Switch to MST Testnet</button>
            </div>
          )}
          {packageLoadState === "LOADING" && (
            <div className="loading-block">Loading valid rental packages…</div>
          )}
          {packageLoadState === "ERROR" && (
            <div className="loading-block error-banner">
              <span>{packageLoadError ?? "Unable to load rental packages."}</span>
              <button className="secondary compact" onClick={() => setSelectedRobotId((current) => current)}>Retry</button>
            </div>
          )}
          {packageLoadState === "EMPTY" && (
            <div className="loading-block">No valid rental packages are available for this robot.</div>
          )}
          {packageLoadState === "SUCCESS" && pricingForSelectedRobot.length > 0 && (
            <div className="package-grid">
              {pricingForSelectedRobot.map((packageEntry) => (
                <button
                  key={packageEntry.durationMinutes}
                  className={`package-card ${selectedDuration === packageEntry.durationMinutes ? "selected" : ""}`}
                  onClick={() => setSelectedDuration(packageEntry.durationMinutes)}
                >
                  <span className="mini-label">{packageEntry.durationMinutes} min</span>
                  <strong>₹{Number(packageEntry.amountInr).toLocaleString()}</strong>
                  <small>{formatEther(packageEntry.payment)} tMSTC</small>
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedPackage && (
          <div className="summary-panel glass-subcard">
            <h3>Rental summary</h3>
            <div className="summary-grid">
              <div><label>Order ID</label><strong>{currentOrderId}</strong></div>
              <div><label>Robot</label><strong>{selectedRobot?.id}</strong></div>
              <div><label>Duration</label><strong>{selectedPackage.durationMinutes} minutes</strong></div>
              <div><label>INR</label><strong>₹{Number(selectedPackage.amountInr).toLocaleString()}</strong></div>
              <div><label>tMSTC</label><strong>{formatEther(selectedPackage.payment)}</strong></div>
              <div><label>Wallet</label><strong>{walletConnected && address ? shortenAddress(address) : "Not connected"}</strong></div>
            </div>
            <button
              className="primary wide"
              disabled={walletResolving || selectedRobot?.status !== 0 || (walletConnected && isMstTestnet && !selectedPackage)}
              onClick={() => {
                if (!walletConnected) void handleConnect(bridgeKeyConnector);
                else if (!isMstTestnet) void handleSwitchToMstTestnet();
                else void runRentFlow();
              }}
            >
              {selectedRobot?.status !== 0 ? "Currently in use" : walletResolving ? "Connecting…" : !walletConnected ? "Connect BridgeKey" : !isMstTestnet ? "Switch to MST Testnet" : "Rent Robot with BridgeKey"}
            </button>
          </div>
        )}
      </section>

      {confirmation && (
        <div className="modal-backdrop">
          <div className="glass-card modal-card">
            <h3>Confirm rental</h3>
            <div className="line-item"><span>Robot</span><strong>{confirmation.robotId}</strong></div>
            <div className="line-item"><span>Package</span><strong>{confirmation.durationMinutes} min</strong></div>
            <div className="line-item"><span>Duration</span><strong>{confirmation.durationMinutes} min</strong></div>
            <div className="line-item"><span>INR</span><strong>₹{Number(confirmation.amountInr).toLocaleString()}</strong></div>
            <div className="line-item"><span>tMSTC</span><strong>{formatEther(confirmation.payment)}</strong></div>
            <div className="line-item"><span>Wallet</span><strong>{shortenAddress(confirmation.customer)}</strong></div>
            <div className="line-item"><span>Network</span><strong>MST Testnet</strong></div>
            <div className="line-item"><span>Contract</span><strong>{shortenAddress(ROBO_PAY_ADDRESS)}</strong></div>
            <div className="line-item"><span>Payment handling</span><strong>Held by RoboPay escrow</strong></div>
            <p className="muted">Funds are not sent to Admin at rental creation. An authorized operator settles only after verified session success, or refunds after verified failure evidence.</p>
            {txHash ? (
              <p className="muted">
                Transaction submitted: <a href={getMstscanTxUrl(txHash)} target="_blank" rel="noreferrer">{shortenAddress(txHash)}</a>
              </p>
            ) : txState === "TRANSACTION_REQUEST_TIMEOUT" ? (
              <p className="muted">BridgeKey did not respond. The wallet request is still unresolved; do not submit a second transaction.</p>
            ) : isTransactionLocked ? (
              <p className="muted">Waiting for BridgeKey to approve the transaction…</p>
            ) : (
              <p className="muted">Payment will be submitted on MST Testnet through BridgeKey.</p>
            )}
            <div className="modal-actions">
              <button className="secondary" onClick={() => setConfirmation(null)} disabled={isTransactionLocked}>Cancel</button>
              {!txHash ? (
                <button className="primary" onClick={confirmPayment} disabled={isTransactionLocked || !isMstTestnet}>
                  {isTransactionLocked ? "Waiting for BridgeKey…" : "Confirm payment"}
                </button>
              ) : null}
              {txHash ? (
                <div className="verification-box glass-subcard">
                  <strong>Blockchain Transaction Confirmed</strong>
                  <p>{txState === "VERIFYING" ? "Backend Verification" : txState === "VERIFIED" ? "✓ Transaction Verified" : txState === "UNAVAILABLE" ? "Blockchain transaction confirmed. Backend verification is currently unavailable." : "Backend Verification"}</p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderRentals = () => (
    <div className="page-shell">
      <section className="glass-card list-card">
        <div className="section-header">
          <h2>My Rentals</h2>
        </div>
        {isLoadingRentals ? (
          <div className="loading-block">Loading your rental contracts from MST Testnet…</div>
        ) : historyRentals.length === 0 ? (
          <p className="muted">No rentals are associated with this connected wallet.</p>
        ) : (
          <div className="rental-list">
            {historyRentals.map((rental) => {
              const remainingSeconds = Math.max(Number(rental.endTime) - currentTimeSeconds, 0);
              const hours = Math.floor(remainingSeconds / 3600);
              const minutes = Math.floor((remainingSeconds % 3600) / 60);
              const seconds = remainingSeconds % 60;
              const outcomeState = rentalExpiryState[rental.orderId];
              const expiryState = outcomeState?.state ?? (rental.completed ? "COMPLETED" : rental.refunded ? "REFUNDED" : rental.active && remainingSeconds === 0 ? "VERIFYING_SESSION" : "ACTIVE");
              const expiryMessage = rentalExpiryState[rental.orderId]?.message ?? "Rental Active";
              const expiryTxHash = rentalExpiryState[rental.orderId]?.txHash;
              const paymentStatus = outcomeState?.paymentStatus ?? (rental.active ? "ESCROWED" : rental.completed ? "SETTLED" : "REFUNDED");
              const currentRobotStatus = outcomeState?.robotStatus ?? (robots.find((robot) => robot.id === rental.robotId)?.status === 0 ? "AVAILABLE" : "IN_USE");
              return (
                <div key={rental.orderId} className="glass-subcard rental-card">
                  <div className="robot-head">
                    <div>
                      <div className="mini-label">{rental.orderId}</div>
                      <h4>{rental.robotId}</h4>
                    </div>
                    <span className={`status-pill ${expiryState === "COMPLETED" || expiryState === "REFUNDED" ? "status-available" : "status-active"}`}>
                      {expiryState === "ACTIVE" ? formatRentalStatus(rental.status) : expiryState}
                    </span>
                  </div>
                  <div className="meta-grid two-col">
                    <div><label>Service</label><strong>{rental.service}</strong></div>
                    <div><label>Duration</label><strong>{Number(rental.durationMinutes)} mins</strong></div>
                    <div><label>Start</label><strong>{new Date(Number(rental.startTime) * 1000).toLocaleString()}</strong></div>
                    <div><label>End</label><strong>{new Date(Number(rental.endTime) * 1000).toLocaleString()}</strong></div>
                    {rental.active ? <div><label>Time left</label><strong>{remainingSeconds > 0 ? `${hours}h ${minutes}m ${seconds}s` : "00:00"}</strong></div> : null}
                    <div><label>Payment status</label><strong>{paymentStatus}</strong></div>
                    <div><label>Robot status</label><strong>{currentRobotStatus}</strong></div>
                    <div><label>Amount</label><strong>{formatEther(rental.amountPaidWei)} tMSTC</strong></div>
                    {rental.active ? <div><label>Held by</label><strong>RoboPay escrow contract</strong></div> : null}
                  </div>
                  {rental.active && remainingSeconds === 0 ? (
                    <div className="network-banner">
                      <strong>Rental time completed</strong>
                      <div>{expiryState === "VERIFYING_SESSION" ? "VERIFYING ROBOT SESSION..." : expiryState === "SETTLING" ? "💰 SETTLING ESCROW..." : expiryState === "SETTLEMENT_RETRY_PENDING" ? "Settlement retry pending" : expiryState === "REFUNDING" ? "💰 REFUNDING ESCROW..." : expiryState === "REFUND_RETRY_PENDING" ? "Refund retry pending" : expiryState === "PENDING" ? "⏳ COMPLETION PENDING" : expiryState === "COMPLETED" ? "✅ SESSION VERIFIED · RENTAL COMPLETED · PAYMENT SETTLED" : expiryState === "REFUNDED" ? "⚠ FAILURE VERIFIED · RENTAL REFUNDED · REFUND CONFIRMED" : "VERIFYING ROBOT SESSION..."}</div>
                      <div>{expiryMessage}</div>
                      {outcomeState?.evidenceMode === "DEMO_SIMULATED" ? <div className="muted">DEMO SIMULATION EVIDENCE · not physical robot telemetry</div> : null}
                      {expiryState === "PENDING" ? <div>Robot session outcome is not yet verifiable. Payment remains ESCROWED and the robot remains IN_USE.</div> : null}
                      {expiryState === "COMPLETED" && outcomeState?.adminAddress ? <div>Admin received {formatEther(rental.amountPaidWei)} tMSTC: {outcomeState.adminAddress}</div> : null}
                      {expiryState === "COMPLETED" && outcomeState?.activityHash ? <div>Activity hash: <span className="mono">{outcomeState.activityHash}</span></div> : null}
                      {expiryState === "COMPLETED" && outcomeState?.anchorTxHash ? <div>Anchor transaction: <span className="mono">{outcomeState.anchorTxHash}</span></div> : null}
                      {expiryState === "REFUNDED" && outcomeState?.failureReasonHash ? <div>Failure evidence hash: <span className="mono">{outcomeState.failureReasonHash}</span></div> : null}
                    </div>
                  ) : null}
                  {rental.active && remainingSeconds > 0 ? <p className="muted">Rental Active</p> : null}
                  {rental.active ? <p className="muted">Payment is held by the RoboPay Smart Contract and has not been paid to Admin.</p> : null}
                  {rental.completed ? <p className="network-banner">Session marked successful on-chain. Payment settled to Admin.</p> : null}
                  {rental.refunded ? <p className="network-banner">Rental refunded on-chain to {shortenAddress(rental.customer)}. Failure evidence: <span className="mono">{rental.failureReasonHash}</span></p> : null}
                  {rental.completed && rental.settlementTxHash ? <p><a href={getMstscanTxUrl(rental.settlementTxHash as Hex)} target="_blank" rel="noreferrer">View settlement transaction on MSTScan</a></p> : null}
                  {rental.refunded && rental.refundTxHash ? <p><a href={getMstscanTxUrl(rental.refundTxHash as Hex)} target="_blank" rel="noreferrer">View refund transaction on MSTScan</a></p> : null}
                  {expiryTxHash ? <p><a href={getMstscanTxUrl(expiryTxHash)} target="_blank" rel="noreferrer">View completion transaction on MSTScan</a></p> : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );

  const renderHistory = () => (
    <div className="page-shell">
      <section className="glass-card list-card">
        <div className="section-header">
          <h2>Rental history</h2>
        </div>
        {isLoadingRentals ? (
          <div className="loading-block">Loading rental history from MST blockchain…</div>
        ) : (
          <div className="history-table-wrap">
            <table className="history-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Robot</th>
                  <th>Customer</th>
                  <th>Service</th>
                  <th>Duration</th>
                  <th>INR</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {historyRentals.map((rental) => (
                  <tr key={rental.orderId}>
                    <td>{rental.orderId}</td>
                    <td>{rental.robotId}</td>
                    <td>{shortenAddress(rental.customer)}</td>
                    <td>{rental.service}</td>
                    <td>{Number(rental.durationMinutes)} min</td>
                    <td>₹{Number(rental.amountInr).toLocaleString()}</td>
                    <td>{formatRentalStatus(rental.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );

  const renderVerify = () => (
    <div className="page-shell">
      <section className="glass-card verify-card">
        <h2>Verify Rental</h2>
        <p className="muted">Check whether a rental record matches the data stored on MST Testnet.</p>
        <div className="verify-input-row">
          <input aria-label="Order ID" value={verifyOrderId} onChange={(e) => setVerifyOrderId(e.target.value)} placeholder="Order ID" />
          <button className="primary" onClick={() => void verifyRentalOrder(verifyOrderId)} disabled={verificationResult.status === "LOADING"}>
            {verificationResult.status === "LOADING" ? "Checking…" : "Verify Rental"}
          </button>
        </div>
        {verificationResult.status === "IDLE" && (
          <div className="verification-box glass-subcard">
            <strong>What this verifies</strong>
            <ul>
              <li>Rental exists on the RoboPay contract</li>
              <li>Robot, customer, package, payment, and timestamps</li>
              <li>Rental data hash against the Solidity record</li>
              <li>Whether an activity hash has been anchored</li>
            </ul>
          </div>
        )}
        {verificationResult.status === "LOADING" && <div className="loading-block">Reading the rental and hashes from MST Testnet…</div>}
        {verificationResult.status === "NOT_FOUND" && (
          <div className="verification-box glass-subcard"><strong>Rental Not Found</strong><p>No rental with this Order ID exists on the RoboPay contract.</p></div>
        )}
        {verificationResult.status === "ERROR" && (
          <div className="verification-box glass-subcard error-banner"><strong>Verification unavailable</strong><p>{verificationResult.message}</p></div>
        )}
        {verificationResult.status === "FOUND" && (() => {
          const { rental, dataHashMatches, robotStatus, paymentRecipient, activityVerification, outcome } = verificationResult;
          const computedHash = computeRentalDataHash(rental.orderId, rental.robotId, rental.service, Number(rental.durationMinutes), rental.amountInr, rental.customer, rental.startTime, rental.endTime);
          const hasActivityHash = !/^0x0{64}$/i.test(rental.activityHash);
          const remaining = Math.max(Number(rental.endTime) - Math.floor(Date.now() / 1000), 0);
          const dataMismatch = !dataHashMatches || computedHash.toLowerCase() !== rental.rentalDataHash.toLowerCase();
          const settlementHash = rental.settlementTxHash ?? outcome?.settlementTxHash ?? undefined;
          const refundHash = rental.refundTxHash ?? outcome?.refundTxHash ?? undefined;
          return (
            <div className="verification-box glass-subcard">
              <div className={`verification-badge ${dataMismatch ? "error-banner" : ""}`}>
                {dataMismatch ? "TAMPER DETECTED" : formatRentalStatus(rental.status)}
              </div>
              {dataMismatch ? <p>The current data does not match the cryptographic record anchored on MST Testnet.</p> : null}
              <h3>On-chain record</h3>
              <div className="meta-grid">
                <div><label>Order ID</label><strong>{rental.orderId}</strong></div>
                <div><label>Robot</label><strong>{rental.robotId}</strong></div>
                <div><label>Service</label><strong>{rental.service}</strong></div>
                <div><label>Customer</label><strong>{rental.customer}</strong></div>
                <div><label>Duration</label><strong>{Number(rental.durationMinutes)} min</strong></div>
                <div><label>INR amount</label><strong>₹{Number(rental.amountInr).toLocaleString()}</strong></div>
                <div><label>tMSTC paid</label><strong>{formatEther(rental.amountPaidWei)} tMSTC</strong></div>
                <div><label>Start time</label><strong>{new Date(Number(rental.startTime) * 1000).toLocaleString()}</strong></div>
                <div><label>End time</label><strong>{new Date(Number(rental.endTime) * 1000).toLocaleString()}</strong></div>
                <div><label>Rental status</label><strong>{formatRentalStatus(rental.status)}</strong></div>
                <div><label>Payment status</label><strong>{rental.active ? "ESCROWED" : rental.completed ? "SETTLED" : "REFUNDED"}</strong></div>
                <div><label>Escrow amount</label><strong>{formatEther(rental.amountPaidWei)} tMSTC</strong></div>
                <div><label>Robot status</label><strong>{robotStatus === null ? "Unavailable" : formatRobotStatus(robotStatus)}</strong></div>
                {rental.active && !rental.completed ? <div><label>Time remaining</label><strong>{Math.floor(remaining / 60)}m {remaining % 60}s</strong></div> : null}
                <div><label>On-chain rental data hash</label><strong className="mono">{rental.rentalDataHash}</strong></div>
                <div><label>Computed rental data hash</label><strong className="mono">{computedHash}</strong></div>
                <div><label>Activity audit hash</label><strong className="mono">{rental.activityHash}</strong></div>
                {rental.refunded ? <div><label>Failure evidence hash</label><strong className="mono">{rental.failureReasonHash}</strong></div> : null}
                {rental.completed ? <div><label>Admin</label><strong>{paymentRecipient ?? "Unable to read payment recipient"}</strong></div> : null}
                {rental.completed ? <div><label>Settlement confirmation</label><strong>{settlementHash ? "Confirmed on MST Testnet" : "Confirmed on-chain; transaction hash unavailable"}</strong></div> : null}
                {rental.completed && settlementHash ? <div><label>Settlement transaction</label><a href={getMstscanTxUrl(settlementHash as Hex)} target="_blank" rel="noreferrer">{shortenAddress(settlementHash)}</a></div> : null}
                {rental.refunded ? <div><label>Refund recipient</label><strong>{rental.customer}</strong></div> : null}
                {rental.refunded && refundHash ? <div><label>Refund transaction</label><a href={getMstscanTxUrl(refundHash as Hex)} target="_blank" rel="noreferrer">{shortenAddress(refundHash)}</a></div> : null}
              </div>
              <h3>Verification result</h3>
              <p>{dataMismatch ? "Rental data: HASH MISMATCH" : "Rental data: VERIFIED"}</p>
              {hasActivityHash ? (
                <>
                  <p>Activity audit: {activityVerification?.status ?? "VERIFICATION UNAVAILABLE"}{activityVerification?.verified ? " · SESSION VERIFIED" : ""}</p>
                  {activityVerification?.computedHash ? <p className="mono">Computed activity hash: {activityVerification.computedHash}</p> : null}
                  {activityVerification?.transactionHash ? <p>Anchor transaction: <a href={getMstscanTxUrl(activityVerification.transactionHash as Hex)} target="_blank" rel="noreferrer">{shortenAddress(activityVerification.transactionHash)}</a></p> : null}
                </>
              ) : (
                <p>{rental.completed ? "Activity audit: Rental completed, but activity audit was not anchored." : "Activity audit: AUDIT NOT YET ANCHORED. Robot session activity has not yet been anchored to MST Testnet."}</p>
              )}
              {outcome?.state === "PENDING" || outcome?.state === "VERIFYING_SESSION" ? <p>Session outcome: {outcome.state === "PENDING" ? "UNKNOWN · COMPLETION PENDING" : "VERIFYING ROBOT SESSION"}</p> : null}
              <a href={CONTRACT_SCAN_URL} target="_blank" rel="noreferrer">View Contract on MSTScan</a>
              {lastRentalTx?.orderId === rental.orderId ? <p><a href={getMstscanTxUrl(lastRentalTx.hash)} target="_blank" rel="noreferrer">View Transaction on MSTScan</a></p> : null}
            </div>
          );
        })()}
      </section>
    </div>
  );

  const renderAudit = () => (
    <div className="page-shell">
      <section className="glass-card audit-card">
        <h2>Robot Activity Audit</h2>
        <p className="muted">Track the cryptographic proof of robot session activity. Session telemetry remains off-chain; its deterministic SHA-256 digest is anchored to MST Testnet for later recomputation.</p>
        <div className="audit-flow">
          <span>Robot Session</span>
          <span>↓</span>
          <span>Telemetry / Session Data</span>
          <span>↓</span>
          <span>SHA-256</span>
          <span>↓</span>
          <span>Activity Hash</span>
          <span>↓</span>
          <span>MST Blockchain</span>
          <span>↓</span>
          <span>Verification</span>
        </div>
        <div className="audit-input-row">
          <input aria-label="Order ID" value={orderSearch} onChange={(e) => setOrderSearch(e.target.value)} placeholder="Order ID" />
          <button className="primary" onClick={() => void loadActivityAudit(orderSearch)} disabled={auditResult.status === "LOADING"}>
            {auditResult.status === "LOADING" ? "Loading…" : "Load Audit"}
          </button>
        </div>
        {auditResult.status === "IDLE" && <p className="muted">Enter an Order ID to inspect its on-chain session audit state.</p>}
        {auditResult.status === "LOADING" && <div className="loading-block">Reading rental and activity hash from MST Testnet…</div>}
        {auditResult.status === "NOT_FOUND" && <div className="verification-box glass-subcard"><strong>Rental Not Found</strong><p>No robot session can be associated with this Order ID.</p></div>}
        {auditResult.status === "ERROR" && <div className="verification-box glass-subcard error-banner"><strong>Audit unavailable</strong><p>{auditResult.message}</p></div>}
        {(auditResult.status === "PENDING" || auditResult.status === "ANCHORED") && (() => {
          const rental = auditResult.rental;
          const audit = auditResult.audit;
          const verification = auditResult.verification;
          const outcome = auditResult.outcome;
          const sessionVerified = outcome?.sessionStatus === "SUCCESS" && verification?.verified === true;
          const failureVerified = outcome?.sessionStatus === "FAILURE";
          const anchorTxHash = verification?.transactionHash ?? outcome?.anchorTxHash;
          const refundTxHash = outcome?.refundTxHash;
          return (
            <div className="verification-box glass-subcard">
              <div className="verification-badge">{failureVerified ? "FAILURE VERIFIED" : sessionVerified ? "SESSION VERIFIED" : outcome?.state === "PENDING" ? "AUDIT / SESSION VERIFICATION PENDING" : rental.active ? "SESSION ACTIVE" : "AUDIT VERIFICATION PENDING"}</div>
              <h3>{failureVerified ? "ROBOT FAILURE EVIDENCE" : sessionVerified ? "SUCCESSFUL SESSION EVIDENCE" : "AUDIT PENDING"}</h3>
              <div className="meta-grid">
                <div><label>Order ID</label><strong>{rental.orderId}</strong></div>
                <div><label>Robot</label><strong>{rental.robotId}</strong></div>
                <div><label>Rental status</label><strong>{outcome?.rentalStatus ?? formatRentalStatus(rental.status)}</strong></div>
                <div><label>Session status</label><strong>{audit?.session?.status ?? outcome?.sessionStatus ?? "UNKNOWN"}</strong></div>
                <div><label>Payment status</label><strong>{outcome?.paymentStatus ?? (rental.active ? "ESCROWED" : rental.completed ? "SETTLED" : "REFUNDED")}</strong></div>
                <div><label>Robot status</label><strong>{outcome?.robotStatus ?? (rental.active ? "IN_USE" : "Read from chain during refresh")}</strong></div>
                <div><label>Session start</label><strong>{new Date(Number(rental.startTime) * 1000).toLocaleString()}</strong></div>
                <div><label>Expected end</label><strong>{new Date(Number(rental.endTime) * 1000).toLocaleString()}</strong></div>
                <div><label>Activity hash</label><strong className="mono">{rental.activityHash}</strong></div>
                <div><label>Verification result</label><strong>{verification?.status ?? audit?.activityStatus ?? "DATA_UNAVAILABLE"}</strong></div>
                {outcome ? <div><label>Evidence source</label><strong>{outcome.evidenceMode === "DEMO_SIMULATED" ? "DEMO SIMULATED" : outcome.evidenceMode === "ROBOT_SESSION" ? "ROBOT SESSION" : "UNAVAILABLE"}</strong></div> : null}
                {anchorTxHash ? <div><label>Anchor transaction</label><a href={getMstscanTxUrl(anchorTxHash as Hex)} target="_blank" rel="noreferrer">{shortenAddress(anchorTxHash)}</a></div> : null}
                {failureVerified && outcome?.failureType ? <div><label>Failure type</label><strong>{outcome.failureType}</strong></div> : null}
                {failureVerified && outcome?.failureReasonHash ? <div><label>Failure evidence hash</label><strong className="mono">{outcome.failureReasonHash}</strong></div> : null}
                {outcome?.state === "REFUNDED" && refundTxHash ? <div><label>Refund transaction</label><a href={getMstscanTxUrl(refundTxHash as Hex)} target="_blank" rel="noreferrer">{shortenAddress(refundTxHash)}</a></div> : null}
              </div>
              {verification?.verified ? <p>SESSION VERIFIED: computed activity hash matches the on-chain anchor.</p> : null}
              {outcome?.state === "PENDING" ? <p className="muted">Robot session outcome is not yet verifiable. Escrow remains held and the robot remains IN_USE.</p> : null}
              {failureVerified && outcome?.state !== "REFUNDED" ? <p className="muted">Failure evidence is verified; refund transaction confirmation is still pending.</p> : null}
              {audit?.failureEvidence.map((item) => (
                <p key={item.id} className="muted">{item.type}: {item.status} · <span className="mono">{item.hash}</span></p>
              ))}
              <a href={CONTRACT_SCAN_URL} target="_blank" rel="noreferrer">View Contract on MSTScan</a>
            </div>
          );
        })()}
      </section>
    </div>
  );

  const renderBlockchain = () => (
    <div className="page-shell">
      <section className="glass-card detail-card">
        <h2>Contract and blockchain info</h2>
        <div className="proof-grid">
          <div><label>RoboPay escrow contract</label><strong>{IS_ROBO_PAY_ESCROW_DEPLOYED ? ROBO_PAY_ADDRESS : "Not yet deployed"}</strong></div>
          <div><label>Network</label><strong>MST Testnet</strong></div>
          <div><label>Chain ID</label><strong>{mstTestnet.id}</strong></div>
          <div><label>RPC</label><a href="https://testnetrpc.mstblockchain.com" target="_blank" rel="noreferrer">https://testnetrpc.mstblockchain.com</a></div>
          <div><label>Explorer</label><a href="https://testnet.mstscan.com" target="_blank" rel="noreferrer">MSTScan</a></div>
        </div>
        <div className="capability-list">
          <span>Rental Authorization</span>
          <span>Robot Availability</span>
          <span>Payment Verification</span>
          <span>Rental History</span>
          <span>Activity Hash Audit</span>
        </div>
        <div className="network-banner">Customer payment → RoboPay escrow → successful verified session: Admin settlement → verified failure: customer refund. Timer expiry alone does not release funds or mark the robot available.</div>
        {IS_ROBO_PAY_ESCROW_DEPLOYED ? <a className="primary button-link" href={CONTRACT_SCAN_URL} target="_blank" rel="noreferrer">View Contract on MSTScan</a> : null}
        <div className="section-header">
          <h3>Contract events</h3>
          {IS_ROBO_PAY_ESCROW_DEPLOYED ? <button className="secondary compact" onClick={() => void refreshContractEvents()} disabled={isLoadingEvents}>{isLoadingEvents ? "Refreshing…" : "Refresh events"}</button> : null}
        </div>
        {!IS_ROBO_PAY_ESCROW_DEPLOYED ? (
          <p className="muted">Escrow events will appear after the new contract is deployed to MST Testnet.</p>
        ) : eventLoadError ? (
          <div className="network-banner error-banner">{eventLoadError}</div>
        ) : isLoadingEvents ? (
          <div className="loading-block">Reading contract events from MST Testnet…</div>
        ) : contractEvents.length === 0 ? (
          <p className="muted">No escrow events found in the recent contract history.</p>
        ) : (
          <div className="history-table-wrap">
            <table className="history-table">
              <thead><tr><th>Event</th><th>Order</th><th>Block</th><th>Transaction</th></tr></thead>
              <tbody>
                {contractEvents.map((event) => (
                  <tr key={`${event.transactionHash}-${event.name}`}>
                    <td>{event.name}</td>
                    <td>{event.orderId}</td>
                    <td>{event.blockNumber.toString()}</td>
                    <td><a href={getMstscanTxUrl(event.transactionHash)} target="_blank" rel="noreferrer">{shortenAddress(event.transactionHash)}</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );

  const renderTabContent = () => {
    if (activeTab === "robots") return renderDashboard();
    if (activeTab === "robot") return renderRobotDetail();
    if (activeTab === "rentals") return renderRentals();
    if (activeTab === "history") return renderHistory();
    if (activeTab === "verify") return renderVerify();
    if (activeTab === "audit") return renderAudit();
    if (activeTab === "blockchain") return renderBlockchain();
    return renderHome();
  };

  return (
    <div className="app-shell">
      <header className="topbar glass-card">
        <div className="brand-block">
          <div className="brand-mark">R</div>
          <div>
            <strong>RoboPay</strong>
            <small>Smart Mall</small>
          </div>
        </div>

        <nav className="nav-tabs">
          {[
            ["Home", "home"],
            ["Robots", "robots"],
            ["My Rentals", "rentals"],
            ["History", "history"],
            ["Verify", "verify"],
            ["Audit", "audit"],
            ["Blockchain", "blockchain"],
          ].map(([label, tab]) => (
            <button key={tab} className={activeTab === tab ? "nav-item active" : "nav-item"} onClick={() => setActiveTab(tab as PageName)}>
              {label}
            </button>
          ))}
        </nav>

        <div className="wallet-rail">
          <span className={`network-indicator ${isMstTestnet ? "ok" : "warning"}`}>{walletStatusText}</span>
          <span className={`network-indicator ${backendStatus === "healthy" ? "ok" : backendStatus === "degraded" ? "warning" : "warning"}`}>
            {backendStatus === "healthy" ? "Backend Connected" : backendStatus === "degraded" ? "Backend Degraded" : "Backend Unavailable"}
          </span>
          {!walletConnected ? (
            <button className="primary compact" onClick={() => handleConnect(bridgeKeyConnector)} disabled={walletResolving}>
              {walletResolving ? "Connecting…" : "Connect BridgeKey"}
            </button>
          ) : (
            <>
              <span className="wallet-address-badge">{shortenAddress(address)}</span>
              {!isMstTestnet ? (
                <button className="secondary compact" onClick={handleSwitchToMstTestnet}>Switch to MST Testnet</button>
              ) : null}
              <button className="secondary compact" onClick={() => disconnect()}>Disconnect</button>
            </>
          )}
        </div>
      </header>

      {toast ? <div className={`toast toast-${toast.type}`}>{toast.text}</div> : null}

      {!IS_ROBO_PAY_ESCROW_DEPLOYED ? (
        <div className="network-banner error-banner">RoboPay Escrow is not deployed to MST Testnet yet. The legacy contract is disabled for customer rentals; no escrow payment can be submitted.</div>
      ) : null}

      {walletRequiredPage && (!walletConnected || !isMstTestnet) ? (
        <div className="network-banner">
          {!walletConnected
            ? "Connect BridgeKey to access live RoboPay blockchain data."
            : chainId === undefined
              ? "Waiting for BridgeKey network information."
              : "Switch to MST Testnet to access live RoboPay blockchain data."}
        </div>
      ) : null}

      {validationError ? <div className="network-banner error-banner">{validationError}</div> : null}

      {isSubmittingPayment ? (
        <div className="loading-overlay">Waiting for BridgeKey transaction approval…</div>
      ) : null}

      {walletRequiredPage && !walletConnected ? <div className="page-shell"><section className="glass-card access-panel"><h2>BridgeKey is required</h2><p className="muted">Connect your wallet to browse your rentals and authorize a rental.</p></section></div> : null}

      {renderTabContent()}
    </div>
  );
}
