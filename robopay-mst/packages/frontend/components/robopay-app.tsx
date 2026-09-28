"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createPublicClient,
  formatEther,
  http,
  keccak256,
  encodePacked,
  parseEther,
  type Address,
  type EIP1193Provider,
  type Hex,
} from "viem";
import { useAccount, useBalance, useConnect, useDisconnect, useSwitchChain, useWalletClient, useWriteContract } from "wagmi";
import { mstTestnet } from "@/lib/chains";
import { ROBO_PAY_ABI, ROBO_PAY_ADDRESS } from "@/lib/contract";
import { CONTRACT_SCAN_URL, getMstscanTxUrl } from "@/lib/mstscan";
import { shortenAddress, createOrderId, formatRobotStatus, formatRentalStatus, computeRentalDataHash, formatMstAmount, formatInrAmount } from "@/lib/blockchain";
import type { AuditRecord, Rental, Robot, RobotStatus, TransactionState } from "@/types";

const DEFAULT_ROBOTS: Robot[] = [
  { id: "RF-01", name: "RoboFollow", service: "Human Following", status: 0, registered: true, owner: "0x0000000000000000000000000000000000000000" },
  { id: "FC-01", name: "RoboClean", service: "Floor Cleaning", status: 0, registered: true, owner: "0x0000000000000000000000000000000000000000" },
  { id: "ST-01", name: "RoboTrolley", service: "Smart Shopping Trolley", status: 0, registered: true, owner: "0x0000000000000000000000000000000000000000" },
];

const PAGES = [
  "home",
  "robots",
  "robot",
  "rentals",
  "history",
  "verify",
  "audit",
  "admin",
  "blockchain",
] as const;

type PageName = (typeof PAGES)[number];

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
  active: boolean;
  completed: boolean;
  activityHash: string;
  rentalDataHash: string;
};

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

type PackageLoadState = "INITIAL" | "WAITING_FOR_WALLET" | "WAITING_FOR_NETWORK" | "LOADING" | "SUCCESS" | "EMPTY" | "ERROR";
type BridgeKeyEip1193Provider = EIP1193Provider & { isBridgeKey?: boolean };

const publicClient = createPublicClient({
  chain: mstTestnet,
  transport: http("/api/rpc/testnet"),
});

const robotPricingMap: Record<string, number[]> = {
  "RF-01": [10, 20, 30],
  "FC-01": [10],
  "ST-01": [30],
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

function isMatchingRoute(tab: PageName, initialTab?: PageName) {
  return initialTab === tab;
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
  const { data: walletClient } = useWalletClient({ chainId: mstTestnet.id, connector: activeConnector });
  const { writeContract } = useWriteContract();

  const [activeTab, setActiveTab] = useState<PageName>(initialTab);
  const [robots, setRobots] = useState<Robot[]>(DEFAULT_ROBOTS);
  const [rentalOrderIds, setRentalOrderIds] = useState<string[]>([]);
  const [rentals, setRentals] = useState<RentalDetail[]>([]);
  const [robotPrices, setRobotPrices] = useState<Record<string, Array<{ durationMinutes: number; amountInr: bigint; payment: bigint }>>>({});
  const [selectedRobotId, setSelectedRobotId] = useState("RF-01");
  const [selectedDuration, setSelectedDuration] = useState(10);
  const [verifyOrderId, setVerifyOrderId] = useState("");
  const [verificationResult, setVerificationResult] = useState<{ rental?: RentalDetail; verified: boolean; type: "rental" | "activity" | null } | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationState>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [txState, setTxState] = useState<TransactionState>("DISCONNECTED");
  const [toast, setToast] = useState<ContractMessage | null>(null);
  const [isLoadingRobots, setIsLoadingRobots] = useState(false);
  const [isLoadingRentals, setIsLoadingRentals] = useState(false);
  const [isLoadingAdmin, setIsLoadingAdmin] = useState(false);
  const [packageLoadState, setPackageLoadState] = useState<PackageLoadState>("INITIAL");
  const [packageLoadError, setPackageLoadError] = useState<string | null>(null);
  const [adminOwner, setAdminOwner] = useState<string | null>(null);
  const [contractBalance, setContractBalance] = useState<bigint | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [orderSearch, setOrderSearch] = useState("");
  const [activityHash, setActivityHash] = useState("");
  const [newActivityHash, setNewActivityHash] = useState("");
  const [activityHashTx, setActivityHashTx] = useState<Hex | null>(null);
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [isTransactionLocked, setIsTransactionLocked] = useState(false);
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

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const refreshRobots = async () => {
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
    if (!walletConnected || !isMstTestnet) {
      setRentals([]);
      return;
    }

    setIsLoadingRentals(true);
    try {
      const orderIds = (await publicClient.readContract({
        address: ROBO_PAY_ADDRESS,
        abi: ROBO_PAY_ABI,
        functionName: "getRentalOrderIds",
      })) as string[];

      setRentalOrderIds(orderIds);

      const list = await Promise.all(
        orderIds.map(async (orderId) => {
          const rentalData = (await publicClient.readContract({
            address: ROBO_PAY_ADDRESS,
            abi: ROBO_PAY_ABI,
            functionName: "getRental",
            args: [orderId],
          })) as [string, string, string, bigint, bigint, bigint, Address, bigint, bigint, boolean, boolean, Hex, Hex];

          return {
            orderId: rentalData[0],
            robotId: rentalData[1],
            service: rentalData[2],
            durationMinutes: rentalData[3],
            amountInr: rentalData[4],
            amountPaidWei: rentalData[5],
            customer: rentalData[6],
            startTime: rentalData[7],
            endTime: rentalData[8],
            active: rentalData[9],
            completed: rentalData[10],
            activityHash: rentalData[11],
            rentalDataHash: rentalData[12],
          } satisfies RentalDetail;
        })
      );

      setRentals(list);
    } catch (error) {
      console.error(error);
      setToast({ type: "error", text: "Unable to read rental history from the contract." });
    } finally {
      setIsLoadingRentals(false);
    }
  };

  const refreshAdminMeta = async () => {
    try {
      setIsLoadingAdmin(true);
      const owner = (await publicClient.readContract({
        address: ROBO_PAY_ADDRESS,
        abi: ROBO_PAY_ABI,
        functionName: "owner",
      })) as Address;
      setAdminOwner(owner);
      const balance = (await publicClient.readContract({
        address: ROBO_PAY_ADDRESS,
        abi: ROBO_PAY_ABI,
        functionName: "contractBalance",
      })) as bigint;
      setContractBalance(balance);
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoadingAdmin(false);
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
    refreshRobots();
    refreshRentals();
    refreshAdminMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletConnected, address, chainId, isMstTestnet]);

  useEffect(() => {
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

      const candidateDurations = [10, 20, 30];
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
  const currentOrderId = useMemo(() => createOrderId(), [activeTab]);

  const activeRentals = rentals.filter((rental) => rental.active && rental.customer.toLowerCase() === address?.toLowerCase());
  const historyRentals = [...rentals].sort((a, b) => Number(b.startTime - a.startTime));
  const availableRobotCount = robots.filter((robot) => robot.status === 0 && robot.registered).length;
  const activeRentalCount = rentals.filter((rental) => rental.active).length;
  const completedRentalCount = rentals.filter((rental) => rental.completed).length;

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

  const createUniqueOrderId = async () => {
    let nextOrder = createOrderId();
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

    const nextOrderId = await createUniqueOrderId();
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
    if (transactionLock.current || !confirmation || !connectedAddress || !isMstTestnet) return;
    if (confirmation.customer.toLowerCase() !== connectedAddress.toLowerCase()) {
      setToast({ type: "error", text: "The connected wallet changed. Recreate the rental confirmation." });
      setConfirmation(null);
      return;
    }

    const lock = confirmation;
    const account = connectedAddress;
    const connector = activeConnector;
    let submittedHash: Hex | undefined;
    let transactionStage = "validating active wallet provider";
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
      if (!connector) throw new Error("The connected wallet connector is unavailable.");

      const provider = await connector.getProvider() as BridgeKeyEip1193Provider | undefined;
      const isBridgeKeyProvider = provider?.isBridgeKey === true;
      if (process.env.NODE_ENV === "development") {
        console.info("[wallet] transaction connector/provider", {
          connectorId: connector.id,
          connectorName: connector.name,
          connectorType: connector.type,
          providerDetected: Boolean(provider),
          isBridgeKeyProvider,
        });
      }
      if (!provider) throw new Error("BridgeKey provider unavailable.");
      if (!isBridgeKeyProvider) {
        throw new Error(`The active provider is not BridgeKey (connector ${connector.id}/${connector.name}).`);
      }

      transactionStage = "checking BridgeKey account and chain";
      const [providerAccounts, providerChain] = await Promise.all([
        provider.request({ method: "eth_accounts" }),
        provider.request({ method: "eth_chainId" }),
      ]);
      const providerAccount = Array.isArray(providerAccounts) ? providerAccounts[0] : undefined;
      const providerChainId = typeof providerChain === "string" ? Number(BigInt(providerChain)) : NaN;

      if (typeof providerAccount !== "string" || providerAccount.toLowerCase() !== account.toLowerCase()) {
        throw new Error("BridgeKey account does not match the selected RoboPay account.");
      }
      if (providerChainId !== mstTestnet.id || chainId !== mstTestnet.id) {
        throw new Error(`Switch to MST Testnet. BridgeKey chain ID: ${providerChainId}.`);
      }
      if (process.env.NODE_ENV === "development") {
        console.info("[wallet] transaction identity verified", { account, chainId: providerChainId });
      }

      transactionStage = "checking contract package price";
      const [requiredPayment, requiredAmountInr] = await Promise.all([
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
      ]);

      if (requiredPayment !== lock.payment || requiredAmountInr !== lock.amountInr) {
        throw new Error("The selected package no longer matches the contract price. Re-select the package.");
      }

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

      if (!walletClient) {
        throw new Error("Wagmi did not provide a BridgeKey wallet client for MST Testnet.");
      }
      const walletClientAccount = typeof walletClient.account === "string"
        ? walletClient.account
        : walletClient.account.address;
      if (walletClientAccount.toLowerCase() !== account.toLowerCase()) {
        throw new Error("The BridgeKey wallet client account does not match the selected account.");
      }
      if (walletClient.chain?.id !== mstTestnet.id) {
        throw new Error(`BridgeKey wallet client is on chain ${walletClient.chain?.id ?? "unknown"}.`);
      }

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
        account,
        value: requiredPayment,
      });

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
        account,
        chain: mstTestnet,
        gas,
        value: requiredPayment,
      });

      submittedHash = txHashValue;
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
      })) as [string, string, string, bigint, bigint, bigint, Address, bigint, bigint, boolean, boolean, Hex, Hex];

      const eventRental = {
        orderId: rentalData[0],
        robotId: rentalData[1],
        service: rentalData[2],
        durationMinutes: rentalData[3],
        amountInr: rentalData[4],
        amountPaidWei: rentalData[5],
        customer: rentalData[6],
        startTime: rentalData[7],
        endTime: rentalData[8],
        active: rentalData[9],
        completed: rentalData[10],
        activityHash: rentalData[11],
        rentalDataHash: rentalData[12],
      } satisfies RentalDetail;

      if (!eventRental.active) {
        throw new Error("The mined transaction did not create an active rental.");
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
      setActiveTab("rentals");
      setToast({ type: "success", text: `Rental authorized: ${lock.orderId}` });
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

  const handleVerify = async (orderId: string, mode: "rental" | "activity") => {
    if (!orderId.trim()) {
      setVerificationResult({ verified: false, type: mode, rental: undefined });
      return;
    }

    try {
      const rentalData = (await publicClient.readContract({
        address: ROBO_PAY_ADDRESS,
        abi: ROBO_PAY_ABI,
        functionName: "getRental",
        args: [orderId],
      })) as [string, string, string, bigint, bigint, bigint, Address, bigint, bigint, boolean, boolean, Hex, Hex];

      const rental = {
        orderId: rentalData[0],
        robotId: rentalData[1],
        service: rentalData[2],
        durationMinutes: rentalData[3],
        amountInr: rentalData[4],
        amountPaidWei: rentalData[5],
        customer: rentalData[6],
        startTime: rentalData[7],
        endTime: rentalData[8],
        active: rentalData[9],
        completed: rentalData[10],
        activityHash: rentalData[11],
        rentalDataHash: rentalData[12],
      } satisfies RentalDetail;

      const nextHash = computeRentalDataHash(
        rental.orderId,
        rental.robotId,
        rental.service,
        Number(rental.durationMinutes),
        rental.amountInr,
        rental.customer,
        rental.startTime,
        rental.endTime,
      );

      const verified = mode === "rental"
        ? (await publicClient.readContract({
            address: ROBO_PAY_ADDRESS,
            abi: ROBO_PAY_ABI,
            functionName: "verifyRentalDataHash",
            args: [orderId, nextHash],
          })) as boolean
        : (await publicClient.readContract({
            address: ROBO_PAY_ADDRESS,
            abi: ROBO_PAY_ABI,
            functionName: "verifyActivityHash",
            args: [orderId, keccak256(encodePacked(["string"], [activityHash]))],
          })) as boolean;

      setVerificationResult({ rental, verified, type: mode });
      setToast({ type: verified ? "success" : "error", text: verified ? "Verification successful on MST blockchain." : "Hash does not match the blockchain record." });
    } catch (error) {
      console.error(error);
      setVerificationResult({ verified: false, type: mode, rental: undefined });
      setToast({ type: "error", text: "Unable to verify this rental on the blockchain." });
    }
  };

  const endRentalFromContract = async (orderId: string) => {
    try {
      const tx = await new Promise<Hex>((resolve, reject) => {
        writeContract({
          address: ROBO_PAY_ADDRESS,
          abi: ROBO_PAY_ABI,
          functionName: "endRental",
          args: [orderId],
        }, {
          onSuccess: (hash) => resolve(hash),
          onError: (error) => reject(error),
        });
      });

      await publicClient.waitForTransactionReceipt({ hash: tx });
      await refreshRentals();
      await refreshRobots();
      setToast({ type: "success", text: "Rental completed and robot returned to availability." });
    } catch (error) {
      console.error(error);
      setToast({ type: "error", text: "The rental completion transaction could not be confirmed." });
    }
  };

  const recordActivityHash = async () => {
    if (!newActivityHash.trim() || !orderSearch.trim()) return;

    try {
      const tx = await new Promise<Hex>((resolve, reject) => {
        writeContract({
          address: ROBO_PAY_ADDRESS,
          abi: ROBO_PAY_ABI,
          functionName: "recordActivityHash",
          args: [orderSearch, keccak256(encodePacked(["string"], [newActivityHash]))],
        }, {
          onSuccess: (hash) => resolve(hash),
          onError: (error) => reject(error),
        });
      });

      await publicClient.waitForTransactionReceipt({ hash: tx });
      setActivityHashTx(tx);
      setToast({ type: "success", text: "Activity hash anchored to the blockchain." });
    } catch (error) {
      console.error(error);
      setToast({ type: "error", text: "The activity hash could not be recorded on-chain." });
    }
  };

  const withdrawBalance = async () => {
    try {
      const tx = await new Promise<Hex>((resolve, reject) => {
        writeContract({
          address: ROBO_PAY_ADDRESS,
          abi: ROBO_PAY_ABI,
          functionName: "withdraw",
        }, {
          onSuccess: (hash) => resolve(hash),
          onError: (error) => reject(error),
        });
      });

      await publicClient.waitForTransactionReceipt({ hash: tx });
      setToast({ type: "success", text: "Owner withdrawal executed." });
      await refreshAdminMeta();
    } catch (error) {
      console.error(error);
      setToast({ type: "error", text: "Withdrawal was rejected or failed." });
    }
  };

  const setRobotStatus = async (robotId: string, nextStatus: 0 | 1) => {
    try {
      const tx = await new Promise<Hex>((resolve, reject) => {
        writeContract({
          address: ROBO_PAY_ADDRESS,
          abi: ROBO_PAY_ABI,
          functionName: "setRobotAvailability",
          args: [robotId, nextStatus],
        }, {
          onSuccess: (hash) => resolve(hash),
          onError: (error) => reject(error),
        });
      });

      await publicClient.waitForTransactionReceipt({ hash: tx });
      await refreshRobots();
      setToast({ type: "success", text: `Robot ${robotId} is now ${nextStatus === 0 ? "AVAILABLE" : "IN_USE"}.` });
    } catch (error) {
      console.error(error);
      setToast({ type: "error", text: "Availability update failed." });
    }
  };

  const renderHome = () => (
    <div className="page-shell">
      <section className="hero glass-card">
        <div className="hero-copy">
          <span className="eyebrow">RoboPay Smart Mall</span>
          <h1>Rent Robots. Pay On-Chain. Trust Every Session.</h1>
          <p>
            RoboPay is a blockchain-backed Robot-as-a-Service platform where every payment,
            rental authorization, and robot session is independently verifiable and tamper-evident.
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
          <p>Each rental is created and stored on MST Testnet, with the exact native payment enforced by the contract.</p>
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
          <div><label>Contract</label><strong>{shortenAddress(ROBO_PAY_ADDRESS)}</strong></div>
          <div><label>Explorer</label><a href={CONTRACT_SCAN_URL} target="_blank" rel="noreferrer">View on MSTScan</a></div>
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
        <div className="glass-card stat-card"><span>Total rentals</span><strong>{rentals.length}</strong></div>
      </section>

      <section className="glass-card list-card">
        <div className="section-header">
          <h3>Available Robot catalog</h3>
        </div>
        {isLoadingRobots ? (
          <div className="loading-block">Loading robot status from blockchain…</div>
        ) : (
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
                <div className="pricing-list">
                  {(robotPricingMap[robot.id] ?? [10]).map((duration) => {
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
                <button className="primary compact" onClick={() => {
                  setSelectedRobotId(robot.id);
                  setSelectedDuration(robotPricingMap[robot.id]?.[0] ?? 10);
                  setActiveTab("robot");
                }}>Select robot</button>
              </div>
            ))}
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
              disabled={walletResolving || (walletConnected && isMstTestnet && (!selectedPackage || selectedRobot?.status !== 0))}
              onClick={() => {
                if (!walletConnected) void handleConnect(bridgeKeyConnector);
                else if (!isMstTestnet) void handleSwitchToMstTestnet();
                else void runRentFlow();
              }}
            >
              {walletResolving ? "Connecting…" : !walletConnected ? "Connect BridgeKey" : !isMstTestnet ? "Switch to MST Testnet" : "Rent Robot with BridgeKey"}
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
          <h2>Active rentals</h2>
        </div>
        {isLoadingRentals ? (
          <div className="loading-block">Loading active rental contracts…</div>
        ) : activeRentals.length === 0 ? (
          <p className="muted">No active rentals for this wallet yet.</p>
        ) : (
          <div className="rental-list">
            {activeRentals.map((rental) => {
              const remainingSeconds = Math.max(Number(rental.endTime - BigInt(Math.floor(Date.now() / 1000))), 0);
              const minutes = Math.floor(remainingSeconds / 60);
              const seconds = remainingSeconds % 60;

              return (
                <div key={rental.orderId} className="glass-subcard rental-card">
                  <div className="robot-head">
                    <div>
                      <div className="mini-label">{rental.orderId}</div>
                      <h4>{rental.robotId}</h4>
                    </div>
                    <span className="status-pill status-active">ACTIVE</span>
                  </div>
                  <div className="meta-grid two-col">
                    <div><label>Service</label><strong>{rental.service}</strong></div>
                    <div><label>Duration</label><strong>{Number(rental.durationMinutes)} mins</strong></div>
                    <div><label>Start</label><strong>{new Date(Number(rental.startTime) * 1000).toLocaleString()}</strong></div>
                    <div><label>End</label><strong>{new Date(Number(rental.endTime) * 1000).toLocaleString()}</strong></div>
                    <div><label>Time left</label><strong>{minutes}m {seconds}s</strong></div>
                    <div><label>Blockchain</label><strong>Verified</strong></div>
                  </div>
                  <div className="modal-actions">
                    <button className="secondary" onClick={() => endRentalFromContract(rental.orderId)}>Complete rental</button>
                  </div>
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
                    <td>{formatRentalStatus(rental.active, rental.completed)}</td>
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
        <div className="verify-input-row">
          <input value={verifyOrderId} onChange={(e) => setVerifyOrderId(e.target.value)} placeholder="Enter order ID" />
          <button className="primary" onClick={() => handleVerify(verifyOrderId, "rental")}>Verify rental</button>
        </div>
        {verificationResult && verificationResult.rental ? (
          <div className="verification-box glass-subcard">
            <div className="meta-grid">
              <div><label>Order ID</label><strong>{verificationResult.rental.orderId}</strong></div>
              <div><label>Customer</label><strong>{shortenAddress(verificationResult.rental.customer)}</strong></div>
              <div><label>Robot</label><strong>{verificationResult.rental.robotId}</strong></div>
              <div><label>Duration</label><strong>{Number(verificationResult.rental.durationMinutes)} min</strong></div>
              <div><label>Amount</label><strong>₹{Number(verificationResult.rental.amountInr).toLocaleString()}</strong></div>
              <div><label>Status</label><strong>{verificationResult.rental.active ? "ACTIVE" : "COMPLETED"}</strong></div>
            </div>
            <div className="verification-badge">
              {verificationResult.verified ? "✓ VERIFIED ON MST BLOCKCHAIN" : "✗ HASH DOES NOT MATCH"}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );

  const renderAudit = () => (
    <div className="page-shell">
      <section className="glass-card audit-card">
        <h2>Robot activity audit</h2>
        <div className="audit-flow">
          <span>Robot Session Data</span>
          <span>↓</span>
          <span>SHA-256 Hash</span>
          <span>↓</span>
          <span>MST Blockchain</span>
          <span>↓</span>
          <span>Verification</span>
        </div>
        <p className="muted">Detailed robot telemetry remains off-chain. Its cryptographic hash is anchored to MST Testnet, so if session data changes, verification fails.</p>
        <div className="audit-input-row">
          <input value={activityHash} onChange={(e) => setActivityHash(e.target.value)} placeholder="Pet robot session payload" />
          <button className="primary" onClick={() => handleVerify(orderSearch || verifyOrderId, "activity")}>Check hash</button>
        </div>
      </section>
    </div>
  );

  const renderAdmin = () => {
    const ownerMatch = adminOwner && address && adminOwner.toLowerCase() === address.toLowerCase();

    if (!isConnected || !ownerMatch) {
      return (
        <div className="page-shell">
          <section className="glass-card access-panel">
            <h2>Admin access required</h2>
            <p className="muted">This dashboard is only visible to the RoboPay contract owner.</p>
          </section>
        </div>
      );
    }

    return (
      <div className="page-shell">
        <section className="glass-card admin-overview">
          <h2>Robot Operator Dashboard</h2>
          <div className="meta-grid">
            <div><label>Contract owner</label><strong>{shortenAddress(adminOwner ?? undefined)}</strong></div>
            <div><label>Contract address</label><strong>{shortenAddress(ROBO_PAY_ADDRESS)}</strong></div>
            <div><label>Network</label><strong>MST Testnet</strong></div>
            <div><label>Contract balance</label><strong>{contractBalance ? formatEther(contractBalance) : "—"} tMSTC</strong></div>
          </div>
        </section>

        <section className="glass-card list-card">
          <h3>Robot availability</h3>
          <table className="history-table">
            <thead>
              <tr>
                <th>Robot ID</th>
                <th>Name</th>
                <th>Service</th>
                <th>Owner</th>
                <th>Availability</th>
                <th>Controls</th>
              </tr>
            </thead>
            <tbody>
              {robots.map((robot) => (
                <tr key={robot.id}>
                  <td>{robot.id}</td>
                  <td>{robot.name}</td>
                  <td>{robot.service}</td>
                  <td>{shortenAddress(robot.owner)}</td>
                  <td>{formatRobotStatus(robot.status)}</td>
                  <td>
                    <button className="secondary compact" onClick={() => setRobotStatus(robot.id, 0)}>Mark Available</button>
                    <button className="secondary compact" onClick={() => setRobotStatus(robot.id, 1)}>Mark In Use</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="glass-card admin-actions">
          <h3>Activity hash recording</h3>
          <div className="verify-input-row">
            <input value={orderSearch} onChange={(e) => setOrderSearch(e.target.value)} placeholder="Order ID" />
            <input value={newActivityHash} onChange={(e) => setNewActivityHash(e.target.value)} placeholder="Activity hash" />
            <button className="primary" onClick={recordActivityHash}>Record Activity Hash</button>
          </div>
          {activityHashTx ? <p className="muted">Transaction: <a href={getMstscanTxUrl(activityHashTx)} target="_blank" rel="noreferrer">{shortenAddress(activityHashTx)}</a></p> : null}
        </section>

        <section className="glass-card admin-actions">
          <h3>Withdrawal</h3>
          <div className="verify-input-row">
            <strong>{contractBalance ? `${formatEther(contractBalance)} tMSTC` : "0 tMSTC"}</strong>
            <button className="primary" onClick={withdrawBalance}>Withdraw</button>
          </div>
        </section>
      </div>
    );
  };

  const renderBlockchain = () => (
    <div className="page-shell">
      <section className="glass-card detail-card">
        <h2>Contract and blockchain info</h2>
        <div className="proof-grid">
          <div><label>RoboPay contract</label><strong>{ROBO_PAY_ADDRESS}</strong></div>
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
        <a className="primary button-link" href={CONTRACT_SCAN_URL} target="_blank" rel="noreferrer">View Contract on MSTScan</a>
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
    if (activeTab === "admin") return renderAdmin();
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
          {adminOwner && address && adminOwner.toLowerCase() === address.toLowerCase() ? (
            <button className={activeTab === "admin" ? "nav-item active" : "nav-item"} onClick={() => setActiveTab("admin")}>Admin</button>
          ) : null}
        </nav>

        <div className="wallet-rail">
          <span className={`network-indicator ${isMstTestnet ? "ok" : "warning"}`}>{walletStatusText}</span>
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

      {(!walletConnected || !isMstTestnet) && activeTab !== "home" ? (
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

      {!walletConnected && activeTab !== "home" ? <div className="page-shell"><section className="glass-card access-panel"><h2>BridgeKey is required</h2><p className="muted">Connect your wallet to browse available robots and authorize a rental.</p></section></div> : null}

      {renderTabContent()}
    </div>
  );
}
