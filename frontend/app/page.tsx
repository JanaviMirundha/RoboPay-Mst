"use client";

import {
    useEffect,
    useMemo,
    useState
} from "react";

import { ethers } from "ethers";

import {
    API_URL,
    MSTSCAN_URL,
    ROBO_PAY_ABI,
    getContractAddress
} from "../lib/contract";

import {
    connectBridgeKey
} from "../lib/bridgekey";

type Robot = {
    id: string;
    name: string;
    service: string;
    status: "AVAILABLE" | "IN_USE";
    owner?: string;
};

type Order = {
    orderId: string;
    robotId: string;
    robotName: string;
    service: string;
    durationMinutes: number;
    amountInr: number;
    requiredPaymentWei: string;
    requiredPaymentTmstc: string;
    paymentStatus: string;
    blockchainStatus: string;
    rentalStatus?: string;
    transactionHash?: string | null;
    customerAddress?: string;
    startTime?: string;
    expiresAt?: string;
};

type IntegrityResult = {
    success: boolean;
    rentalIntegrity?: {
        databaseHash: string;
        blockchainHash: string;
        match: boolean;
    };
    activityIntegrity?: {
        calculatedHash: string;
        blockchainHash: string;
        match: boolean;
        activityRecorded: boolean;
    };
};

const fallbackRobots: Robot[] = [
    {
        id: "RF-01",
        name: "RoboFollow",
        service: "Human Following",
        status: "AVAILABLE"
    },
    {
        id: "FC-01",
        name: "RoboClean",
        service: "Floor Cleaning",
        status: "AVAILABLE"
    },
    {
        id: "ST-01",
        name: "RoboTrolley",
        service:
            "Smart Shopping Trolley",
        status: "AVAILABLE"
    }
];

export default function Home() {

    const [robots, setRobots] =
        useState<Robot[]>(
            fallbackRobots
        );

    const [selectedRobot, setSelectedRobot] =
        useState<Robot | null>(null);

    const [duration, setDuration] =
        useState<number>(10);

    const [walletAddress, setWalletAddress] =
        useState<string>("");

    const [order, setOrder] =
        useState<Order | null>(null);

    const [transactionHash, setTransactionHash] =
        useState<string>("");

    const [integrity, setIntegrity] =
        useState<IntegrityResult | null>(
            null
        );

    const [loading, setLoading] =
        useState<boolean>(false);

    const [walletLoading, setWalletLoading] =
        useState<boolean>(false);

    const [bookingLoading, setBookingLoading] =
        useState<boolean>(false);

    const [paymentLoading, setPaymentLoading] =
        useState<boolean>(false);

    const [auditLoading, setAuditLoading] =
        useState<boolean>(false);

    const [error, setError] =
        useState<string>("");

    const [successMessage, setSuccessMessage] =
        useState<string>("");

    const [remainingSeconds, setRemainingSeconds] =
        useState<number>(0);

    const availableCount =
        useMemo(
            () =>
                robots.filter(
                    (robot) =>
                        robot.status ===
                        "AVAILABLE"
                ).length,
            [robots]
        );

    async function loadRobots() {

        try {

            setLoading(true);

            const response =
                await fetch(
                    `${API_URL}/api/robots`,
                    {
                        cache: "no-store"
                    }
                );

            const data =
                await response.json();

            if (
                response.ok &&
                data.success &&
                Array.isArray(
                    data.robots
                )
            ) {
                setRobots(
                    data.robots
                );
            }

        } catch (loadError) {

            console.error(
                loadError
            );

        } finally {

            setLoading(false);
        }
    }

    useEffect(() => {
        loadRobots();
    }, []);

    useEffect(() => {

        if (
            !order?.expiresAt ||
            order.rentalStatus !==
                "ACTIVE"
        ) {
            setRemainingSeconds(0);
            return;
        }

        const updateTimer =
            () => {

                const end =
                    new Date(
                        order.expiresAt!
                    ).getTime();

                const seconds =
                    Math.max(
                        0,
                        Math.ceil(
                            (end -
                                Date.now()) /
                                1000
                        )
                    );

                setRemainingSeconds(
                    seconds
                );

                if (seconds === 0) {
                    completeRental();
                }
            };

        updateTimer();

        const interval =
            setInterval(
                updateTimer,
                1000
            );

        return () =>
            clearInterval(
                interval
            );

    }, [
        order?.expiresAt,
        order?.rentalStatus
    ]);

    function formatTime(
        totalSeconds: number
    ) {

        const minutes =
            Math.floor(
                totalSeconds / 60
            );

        const seconds =
            totalSeconds % 60;

        return `${String(
            minutes
        ).padStart(
            2,
            "0"
        )}:${String(
            seconds
        ).padStart(
            2,
            "0"
        )}`;
    }

    function calculateLocalPrice(
        robot: Robot | null,
        selectedDuration: number
    ) {

        if (!robot) {
            return 0;
        }

        if (
            robot.id === "ST-01"
        ) {
            return 30;
        }

        return (
            selectedDuration /
            10
        ) * 20;
    }

    async function connectWallet() {

        try {

            setWalletLoading(true);
            setError("");
            setSuccessMessage("");

            const result =
                await connectBridgeKey();

            setWalletAddress(
                result.address
            );

            setSuccessMessage(
                "BridgeKey connected to MST Testnet."
            );

        } catch (walletError: any) {

            setError(
                walletError?.message ||
                    "BridgeKey connection failed."
            );

        } finally {

            setWalletLoading(false);
        }
    }

    async function createBooking() {

        if (!selectedRobot) {
            setError(
                "Select a robot first."
            );
            return;
        }

        if (
            selectedRobot.status !==
            "AVAILABLE"
        ) {
            setError(
                "This robot is currently unavailable."
            );
            return;
        }

        try {

            setBookingLoading(true);
            setError("");
            setSuccessMessage("");
            setOrder(null);
            setTransactionHash("");
            setIntegrity(null);

            const response =
                await fetch(
                    `${API_URL}/api/bookings`,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type":
                                "application/json"
                        },
                        body: JSON.stringify({
                            robotId:
                                selectedRobot.id,
                            durationMinutes:
                                duration
                        })
                    }
                );

            const data =
                await response.json();

            if (
                !response.ok ||
                !data.success
            ) {
                throw new Error(
                    data.error ||
                        "Could not create booking."
                );
            }

            setOrder(
                data.order
            );

            setSuccessMessage(
                "Booking created. Connect BridgeKey to continue."
            );

        } catch (bookingError: any) {

            setError(
                bookingError?.message ||
                    "Booking creation failed."
            );

        } finally {

            setBookingLoading(false);
        }
    }

    async function payForRental() {

        if (!order) {
            setError(
                "Create a booking first."
            );
            return;
        }

        try {

            setPaymentLoading(true);
            setError("");
            setSuccessMessage("");
            setIntegrity(null);

            const wallet =
                await connectBridgeKey();

            setWalletAddress(
                wallet.address
            );

            const contractAddress =
                await getContractAddress();

            const contract =
                new ethers.Contract(
                    contractAddress,
                    ROBO_PAY_ABI,
                    wallet.signer
                );

            const requiredInr =
                await contract.requiredAmountInr(
                    order.robotId,
                    order.durationMinutes
                );

            const requiredPayment =
                await contract.requiredPayment(
                    order.robotId,
                    order.durationMinutes
                );

            if (
                Number(
                    requiredInr
                ) !==
                Number(
                    order.amountInr
                )
            ) {
                throw new Error(
                    "Package amount does not match the MST smart contract."
                );
            }

            const tx =
                await contract.rentRobot(
                    order.orderId,
                    order.robotId,
                    order.service,
                    order.durationMinutes,
                    order.amountInr,
                    {
                        value:
                            requiredPayment
                    }
                );

            setTransactionHash(
                tx.hash
            );

            setSuccessMessage(
                "Transaction submitted. Waiting for MST confirmation..."
            );

            const receipt =
                await tx.wait();

            if (!receipt) {
                throw new Error(
                    "MST transaction receipt was not received."
                );
            }

            setTransactionHash(
                receipt.hash
            );

            const verifyResponse =
                await fetch(
                    `${API_URL}/api/blockchain/verify-rental`,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type":
                                "application/json"
                        },
                        body: JSON.stringify({
                            orderId:
                                order.orderId,
                            transactionHash:
                                receipt.hash,
                            walletAddress:
                                wallet.address
                        })
                    }
                );

            const verifyData =
                await verifyResponse.json();

            if (
                !verifyResponse.ok ||
                !verifyData.success
            ) {
                throw new Error(
                    verifyData.error ||
                        "Backend blockchain verification failed."
                );
            }

            setOrder(
                verifyData.order
            );

            setSuccessMessage(
                "Payment confirmed on MST Testnet. Rental authorized."
            );

            await loadRobots();

        } catch (paymentError: any) {

            console.error(
                paymentError
            );

            setError(
                paymentError?.message ||
                    "Blockchain payment failed."
            );

        } finally {

            setPaymentLoading(false);
        }
    }

    async function recordDemoActivity() {

        if (!order) {
            setError(
                "Create and confirm a rental first."
            );
            return;
        }

        try {

            setAuditLoading(true);
            setError("");
            setSuccessMessage("");
            setIntegrity(null);

            const activity = {
                robotId:
                    order.robotId,
                orderId:
                    order.orderId,
                event:
                    "ROBOT_SESSION",
                startTimestamp:
                    order.startTime ||
                    new Date().toISOString(),
                auditTimestamp:
                    new Date().toISOString(),
                battery:
                    82,
                distanceMeters:
                    120,
                sessionStatus:
                    "ACTIVE"
            };

            const response =
                await fetch(
                    `${API_URL}/api/activity/${order.orderId}`,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type":
                                "application/json"
                        },
                        body:
                            JSON.stringify({
                                activity
                            })
                    }
                );

            const data =
                await response.json();

            if (
                !response.ok ||
                !data.success
            ) {
                throw new Error(
                    data.error ||
                        "Activity audit failed."
                );
            }

            setSuccessMessage(
                "Robot activity hash recorded on MST."
            );

            await checkIntegrity();

        } catch (auditError: any) {

            setError(
                auditError?.message ||
                    "Robot activity audit failed."
            );

        } finally {

            setAuditLoading(false);
        }
    }

    async function checkIntegrity() {

        if (!order) {
            return;
        }

        try {

            setError("");

            const response =
                await fetch(
                    `${API_URL}/api/integrity/${order.orderId}`,
                    {
                        cache: "no-store"
                    }
                );

            const data =
                await response.json();

            if (
                !response.ok ||
                !data.success
            ) {
                throw new Error(
                    data.error ||
                        "Integrity check failed."
                );
            }

            setIntegrity(
                data
            );

        } catch (integrityError: any) {

            setError(
                integrityError?.message ||
                    "Integrity verification failed."
            );
        }
    }

    async function completeRental() {

        if (!order) {
            return;
        }

        try {

            const response =
                await fetch(
                    `${API_URL}/api/rentals/${order.orderId}/complete`,
                    {
                        method: "POST"
                    }
                );

            const data =
                await response.json();

            if (
                response.ok &&
                data.success
            ) {

                setOrder(
                    data.order
                );

                setRemainingSeconds(
                    0
                );

                setSuccessMessage(
                    "Rental completed. Robot is available again."
                );

                await loadRobots();
            }

        } catch (completeError) {

            console.error(
                completeError
            );
        }
    }

    const selectedPrice =
        calculateLocalPrice(
            selectedRobot,
            duration
        );

    return (
        <main className="page">

            <header className="navbar">

                <div className="brand">

                    <div className="brandMark">
                        🤖
                    </div>

                    <div>
                        <div className="brandTitle">
                            RoboPay
                        </div>

                        <div className="brandSub">
                            Blockchain Robot-as-a-Service
                        </div>
                    </div>

                </div>

                <div className="navbarRight">

                    <div className="networkPill">
                        MST Testnet
                    </div>

                    <button
                        className="walletButton"
                        onClick={
                            connectWallet
                        }
                        disabled={
                            walletLoading
                        }
                    >
                        {walletLoading
                            ? "Connecting..."
                            : walletAddress
                            ? `${walletAddress.slice(
                                  0,
                                  6
                              )}...${walletAddress.slice(
                                  -4
                              )}`
                            : "Connect BridgeKey"}
                    </button>

                </div>

            </header>

            <section className="hero">

                <div className="heroContent">

                    <div className="eyebrow">
                        MST BLOCKCHAIN × ROBOTICS
                    </div>

                    <h1>
                        Rent robots.
                        <br />
                        Verify everything.
                    </h1>

                    <p>
                        RoboPay authorizes robotic
                        rentals through MST Blockchain
                        and maintains a tamper-evident
                        usage history.
                    </p>

                    <div className="heroActions">

                        <button
                            className="primaryButton"
                            onClick={() =>
                                document
                                    .getElementById(
                                        "robots"
                                    )
                                    ?.scrollIntoView({
                                        behavior:
                                            "smooth"
                                    })
                            }
                        >
                            Explore Robots →
                        </button>

                        <div className="heroTrust">
                            🔐 On-chain rental authorization
                        </div>

                    </div>

                </div>

                <div className="heroCard">

                    <div className="heroCardLabel">
                        BLOCKCHAIN STATUS
                    </div>

                    <div className="heroCardValue">
                        LIVE
                    </div>

                    <div className="heroCardGrid">

                        <div>
                            <span>
                                Network
                            </span>
                            <strong>
                                MST Testnet
                            </strong>
                        </div>

                        <div>
                            <span>
                                Wallet
                            </span>
                            <strong>
                                {walletAddress
                                    ? "Connected"
                                    : "Not connected"}
                            </strong>
                        </div>

                        <div>
                            <span>
                                Available
                            </span>
                            <strong>
                                {
                                    availableCount
                                }
                            </strong>
                        </div>

                        <div>
                            <span>
                                Audit
                            </span>
                            <strong>
                                On-chain
                            </strong>
                        </div>

                    </div>

                </div>

            </section>

            <section
                id="robots"
                className="section"
            >

                <div className="sectionHeader">

                    <div>
                        <div className="sectionEyebrow">
                            ROBOT MARKETPLACE
                        </div>

                        <h2>
                            Choose your robot
                        </h2>

                        <p>
                            Availability is read from
                            the RoboPay smart contract.
                        </p>
                    </div>

                    <div className="availableBox">
                        <strong>
                            {availableCount}
                        </strong>
                        <span>
                            available
                        </span>
                    </div>

                </div>

                <div className="robotGrid">

                    {robots.map(
                        (robot) => (

                            <article
                                className={
                                    selectedRobot?.id ===
                                    robot.id
                                        ? "robotCard selected"
                                        : "robotCard"
                                }
                                key={
                                    robot.id
                                }
                            >

                                <div className="robotTop">

                                    <div className="robotEmoji">
                                        🤖
                                    </div>

                                    <span
                                        className={
                                            robot.status ===
                                            "AVAILABLE"
                                                ? "status available"
                                                : "status busy"
                                        }
                                    >
                                        {
                                            robot.status
                                        }
                                    </span>

                                </div>

                                <div className="robotId">
                                    {
                                        robot.id
                                    }
                                </div>

                                <h3>
                                    {
                                        robot.name
                                    }
                                </h3>

                                <div className="robotService">
                                    {
                                        robot.service
                                    }
                                </div>

                                <div className="robotFooter">

                                    <div>
                                        <strong>
                                            {robot.id ===
                                            "ST-01"
                                                ? "₹30"
                                                : "₹20"}
                                        </strong>

                                        <span>
                                            {robot.id ===
                                            "ST-01"
                                                ? "/ 30 min"
                                                : "/ 10 min"}
                                        </span>
                                    </div>

                                    <button
                                        className="secondaryButton"
                                        disabled={
                                            robot.status !==
                                            "AVAILABLE"
                                        }
                                        onClick={() => {

                                            setSelectedRobot(
                                                robot
                                            );

                                            setDuration(
                                                robot.id ===
                                                "ST-01"
                                                    ? 30
                                                    : 10
                                            );

                                            setOrder(
                                                null
                                            );

                                            setTransactionHash(
                                                ""
                                            );

                                            setIntegrity(
                                                null
                                            );

                                            setError(
                                                ""
                                            );

                                            setSuccessMessage(
                                                ""
                                            );

                                            window.scrollTo({
                                                top: 0,
                                                behavior:
                                                    "smooth"
                                            });
                                        }}
                                    >
                                        {robot.status ===
                                        "AVAILABLE"
                                            ? "Book"
                                            : "In Use"}
                                    </button>

                                </div>

                            </article>
                        )
                    )}

                </div>

            </section>

            {selectedRobot && (

                <section className="bookingSection">

                    <div className="bookingCard">

                        <div className="bookingTop">

                            <div>
                                <div className="sectionEyebrow">
                                    RENTAL REQUEST
                                </div>

                                <h2>
                                    {
                                        selectedRobot.name
                                    }
                                </h2>

                                <p>
                                    {
                                        selectedRobot.service
                                    }
                                </p>
                            </div>

                            <button
                                className="closeButton"
                                onClick={() => {
                                    setSelectedRobot(
                                        null
                                    );
                                    setOrder(
                                        null
                                    );
                                    setIntegrity(
                                        null
                                    );
                                }}
                            >
                                ✕
                            </button>

                        </div>

                        <div className="durationRow">

                            {[10, 20, 30].map(
                                (minutes) => {

                                    const disabled =
                                        selectedRobot.id ===
                                            "ST-01" &&
                                        minutes !== 30;

                                    return (
                                        <button
                                            key={
                                                minutes
                                            }
                                            className={
                                                duration ===
                                                minutes
                                                    ? "durationButton active"
                                                    : "durationButton"
                                            }
                                            disabled={
                                                disabled
                                            }
                                            onClick={() =>
                                                setDuration(
                                                    minutes
                                                )
                                            }
                                        >
                                            {
                                                minutes
                                            }{" "}
                                            min
                                        </button>
                                    );
                                }
                            )}

                        </div>

                        <div className="priceSummary">

                            <div>
                                <span>
                                    Robot
                                </span>
                                <strong>
                                    {
                                        selectedRobot.name
                                    }
                                </strong>
                            </div>

                            <div>
                                <span>
                                    Duration
                                </span>
                                <strong>
                                    {duration} min
                                </strong>
                            </div>

                            <div>
                                <span>
                                    Reference price
                                </span>
                                <strong>
                                    ₹
                                    {
                                        selectedPrice
                                    }
                                </strong>
                            </div>

                        </div>

                        {!order && (

                            <button
                                className="primaryButton full"
                                onClick={
                                    createBooking
                                }
                                disabled={
                                    bookingLoading
                                }
                            >
                                {bookingLoading
                                    ? "Creating booking..."
                                    : "Continue to Payment →"}
                            </button>
                        )}

                    </div>

                </section>

            )}

            {order && (

                <section className="statusSection">

                    <div className="statusCard">

                        <div className="statusHeader">

                            <div>

                                <div className="sectionEyebrow">
                                    RENTAL
                                </div>

                                <h2>
                                    {
                                        order.robotName
                                    }
                                </h2>

                            </div>

                            <div className="liveStatus">
                                {order.rentalStatus ===
                                "ACTIVE"
                                    ? "ACTIVE"
                                    : order.completed
                                    ? "COMPLETED"
                                    : order.paymentStatus ===
                                      "CONFIRMED"
                                    ? "CONFIRMED"
                                    : "PENDING"}
                            </div>

                        </div>

                        <div className="detailsGrid">

                            <div>
                                <span>
                                    Order ID
                                </span>
                                <strong>
                                    {
                                        order.orderId
                                    }
                                </strong>
                            </div>

                            <div>
                                <span>
                                    Robot
                                </span>
                                <strong>
                                    {
                                        order.robotId
                                    }
                                </strong>
                            </div>

                            <div>
                                <span>
                                    Duration
                                </span>
                                <strong>
                                    {
                                        order.durationMinutes
                                    }{" "}
                                    min
                                </strong>
                            </div>

                            <div>
                                <span>
                                    Amount
                                </span>
                                <strong>
                                    ₹
                                    {
                                        order.amountInr
                                    }
                                </strong>
                            </div>

                            <div>
                                <span>
                                    Payment
                                </span>
                                <strong>
                                    {
                                        order.paymentStatus
                                    }
                                </strong>
                            </div>

                            <div>
                                <span>
                                    Blockchain
                                </span>
                                <strong>
                                    {
                                        order.blockchainStatus
                                    }
                                </strong>
                            </div>

                        </div>

                        {order.paymentStatus !==
                            "CONFIRMED" && (

                            <div className="paymentBox">

                                <div className="paymentLabel">
                                    BLOCKCHAIN PAYMENT
                                </div>

                                <h3>
                                    Pay with BridgeKey
                                </h3>

                                <p>
                                    Your BridgeKey wallet
                                    will sign a real MST
                                    Testnet transaction.
                                </p>

                                <div className="cryptoAmount">
                                    {
                                        order.requiredPaymentTmstc
                                    }{" "}
                                    tMSTC
                                </div>

                                <button
                                    className="primaryButton full"
                                    onClick={
                                        payForRental
                                    }
                                    disabled={
                                        paymentLoading
                                    }
                                >
                                    {paymentLoading
                                        ? "Waiting for MST confirmation..."
                                        : "Pay with BridgeKey →"}
                                </button>

                            </div>
                        )}

                        {order.paymentStatus ===
                            "CONFIRMED" && (

                            <div className="confirmedBox">

                                <div className="confirmedIcon">
                                    ✓
                                </div>

                                <h3>
                                    Payment CONFIRMED
                                </h3>

                                <p>
                                    Blockchain CONFIRMED
                                </p>

                                <div className="verifiedText">
                                    🔐 Blockchain verified •
                                    Rental authorized
                                </div>

                                {transactionHash && (

                                    <div className="txBox">

                                        <div className="smallLabel">
                                            Transaction Hash
                                        </div>

                                        <div className="hash">
                                            {
                                                transactionHash
                                            }
                                        </div>

                                        <a
                                            href={`${MSTSCAN_URL}/tx/${transactionHash}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            View transaction on MSTScan ↗
                                        </a>

                                    </div>
                                )}

                                {order.rentalStatus ===
                                    "ACTIVE" && (

                                    <div className="timerBox">

                                        <div className="smallLabel">
                                            RENTAL ACTIVE
                                        </div>

                                        <div className="timer">
                                            {
                                                formatTime(
                                                    remainingSeconds
                                                )
                                            }
                                        </div>

                                        <div className="timerCaption">
                                            Time remaining
                                        </div>

                                        <button
                                            className="secondaryButton"
                                            onClick={
                                                completeRental
                                            }
                                        >
                                            End Rental Now
                                        </button>

                                    </div>
                                )}

                                <div className="auditBox">

                                    <div className="smallLabel">
                                        ROBOT ACTIVITY AUDIT
                                    </div>

                                    <p>
                                        The robot session
                                        data is hashed
                                        off-chain and the
                                        proof is anchored
                                        on MST.
                                    </p>

                                    <div className="auditButtons">

                                        <button
                                            className="secondaryButton"
                                            onClick={
                                                recordDemoActivity
                                            }
                                            disabled={
                                                auditLoading
                                            }
                                        >
                                            {auditLoading
                                                ? "Recording..."
                                                : "Record Session Audit"}
                                        </button>

                                        <button
                                            className="secondaryButton"
                                            onClick={
                                                checkIntegrity
                                            }
                                        >
                                            Check Integrity
                                        </button>

                                    </div>

                                </div>

                                {integrity && (

                                    <div className="integrityBox">

                                        <div className="smallLabel">
                                            DATA INTEGRITY
                                        </div>

                                        <div className="integrityRow">

                                            <span>
                                                Rental record
                                            </span>

                                            <strong
                                                className={
                                                    integrity
                                                        .rentalIntegrity
                                                        ?.match
                                                        ? "pass"
                                                        : "fail"
                                                }
                                            >
                                                {integrity
                                                    .rentalIntegrity
                                                    ?.match
                                                    ? "✓ VERIFIED"
                                                    : "⚠ TAMPERING DETECTED"}
                                            </strong>

                                        </div>

                                        <div className="integrityRow">

                                            <span>
                                                Robot activity
                                            </span>

                                            <strong
                                                className={
                                                    integrity
                                                        .activityIntegrity
                                                        ?.match
                                                        ? "pass"
                                                        : integrity
                                                              .activityIntegrity
                                                              ?.activityRecorded
                                                        ? "fail"
                                                        : "pending"
                                                }
                                            >
                                                {integrity
                                                    .activityIntegrity
                                                    ?.activityRecorded
                                                    ? integrity
                                                          .activityIntegrity
                                                          ?.match
                                                        ? "✓ VERIFIED"
                                                        : "⚠ TAMPERING DETECTED"
                                                    : "NOT RECORDED"}
                                            </strong>

                                        </div>

                                    </div>
                                )}

                            </div>
                        )}

                    </div>

                </section>
            )}

            {(error ||
                successMessage) && (

                <section className="messageSection">

                    {error && (
                        <div className="errorMessage">
                            {error}
                        </div>
                    )}

                    {successMessage &&
                        !error && (
                            <div className="successMessage">
                                {successMessage}
                            </div>
                        )}

                </section>
            )}

            <section className="howSection">

                <div className="sectionEyebrow">
                    THE FOUR BLOCKCHAIN LAYERS
                </div>

                <h2>
                    Why blockchain is actually needed
                </h2>

                <div className="featureGrid">

                    <div className="featureCard">
                        <div>
                            01
                        </div>
                        <h3>
                            Rental Authorization
                        </h3>
                        <p>
                            The smart contract checks
                            robot, package, duration and
                            exact MST payment before a
                            rental becomes active.
                        </p>
                    </div>

                    <div className="featureCard">
                        <div>
                            02
                        </div>
                        <h3>
                            Rental History
                        </h3>
                        <p>
                            Important rental information
                            and integrity proofs remain
                            anchored on-chain.
                        </p>
                    </div>

                    <div className="featureCard">
                        <div>
                            03
                        </div>
                        <h3>
                            Robot Audit Trail
                        </h3>
                        <p>
                            Session data is hashed and its
                            cryptographic proof is recorded
                            on MST.
                        </p>
                    </div>

                    <div className="featureCard">
                        <div>
                            04
                        </div>
                        <h3>
                            Robot State
                        </h3>
                        <p>
                            Ownership and availability are
                            maintained as trusted on-chain
                            robot state.
                        </p>
                    </div>

                </div>

            </section>

            <footer className="footer">

                <div>
                    🤖 RoboPay
                </div>

                <span>
                    Blockchain-Powered Robot-as-a-Service
                </span>

            </footer>

        </main>
    );
}