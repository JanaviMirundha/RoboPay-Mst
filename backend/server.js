const express =
    require("express");

const cors =
    require("cors");

const fs =
    require("fs");

const path =
    require("path");

const crypto =
    require("crypto");

const dotenv =
    require("dotenv");

const {
    ethers
} =
    require("ethers");

dotenv.config({
    path:
        path.resolve(
            __dirname,
            "../.env.local"
        )
});

const app =
    express();

const PORT =
    process.env.PORT ||
    5000;

const RPC_URL =
    "https://testnetrpc.mstblockchain.com";

const CHAIN_ID =
    91562037;

const DATA_DIR =
    path.join(
        __dirname,
        "data"
    );

const ORDERS_FILE =
    path.join(
        DATA_DIR,
        "orders.json"
    );

const ROBOTS = [
    {
        id: "RF-01",
        name: "RoboFollow",
        service: "Human Following"
    },
    {
        id: "FC-01",
        name: "RoboClean",
        service: "Floor Cleaning"
    },
    {
        id: "ST-01",
        name: "RoboTrolley",
        service:
            "Smart Shopping Trolley"
    }
];

const ABI = [
    "function owner() view returns (address)",
    "function paymentRecipient() view returns (address)",
    "function requiredPayment(string robotId, uint256 durationMinutes) view returns (uint256)",
    "function requiredAmountInr(string robotId, uint256 durationMinutes) view returns (uint256)",
    "function getRobot(string robotId) view returns (string,string,string,address,uint8,bool)",
    "function getRental(string orderId) view returns (string,string,string,uint256,uint256,uint256,address,uint256,uint256,bool,bool,bytes32,bytes32)",
    "function verifyActivityHash(string orderId, bytes32 currentHash) view returns (bool)",
    "function verifyRentalDataHash(string orderId, bytes32 currentHash) view returns (bool)",
    "function rentRobot(string orderId,string robotId,string service,uint256 durationMinutes,uint256 amountInr) payable",
    "function recordActivityHash(string orderId,bytes32 activityHash)",
    "function endRental(string orderId)"
];

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(
        DATA_DIR,
        {
            recursive: true
        }
    );
}

if (!fs.existsSync(ORDERS_FILE)) {
    fs.writeFileSync(
        ORDERS_FILE,
        "{}",
        "utf8"
    );
}

app.use(
    cors()
);

app.use(
    express.json({
        limit: "1mb"
    })
);

function readOrders() {

    try {

        const raw =
            fs.readFileSync(
                ORDERS_FILE,
                "utf8"
            );

        return JSON.parse(
            raw || "{}"
        );

    } catch (error) {

        console.error(
            "Failed to read orders:",
            error
        );

        return {};
    }
}

function writeOrders(
    orders
) {

    fs.writeFileSync(
        ORDERS_FILE,
        JSON.stringify(
            orders,
            null,
            2
        ),
        "utf8"
    );
}

function getProvider() {

    return new ethers.JsonRpcProvider(
        RPC_URL,
        {
            name: "mst-testnet",
            chainId: CHAIN_ID
        }
    );
}

function getAdminWallet() {

    const privateKey =
        process.env.PRIVATE_KEY;

    if (!privateKey) {
        throw new Error(
            "PRIVATE_KEY is missing from root .env.local"
        );
    }

    return new ethers.Wallet(
        privateKey,
        getProvider()
    );
}

function findAddressDeep(
    value
) {

    if (
        !value ||
        typeof value !==
            "object"
    ) {
        return null;
    }

    for (
        const [key, child]
        of Object.entries(
            value
        )
    ) {

        if (
            key ===
                "RoboPay" &&
            child &&
            typeof child ===
                "object" &&
            typeof child.address ===
                "string"
        ) {

            return child.address;
        }

        const nested =
            findAddressDeep(
                child
            );

        if (nested) {
            return nested;
        }
    }

    return null;
}

function getContractAddress() {

    if (
        process.env.ROBO_PAY_CONTRACT_ADDRESS
    ) {

        return (
            process.env
                .ROBO_PAY_CONTRACT_ADDRESS
        );
    }

    const deploymentFile =
        path.resolve(
            __dirname,
            "../packages/contracts/deployments.json"
        );

    if (
        fs.existsSync(
            deploymentFile
        )
    ) {

        try {

            const deployment =
                JSON.parse(
                    fs.readFileSync(
                        deploymentFile,
                        "utf8"
                    )
                );

            const address =
                findAddressDeep(
                    deployment
                );

            if (address) {
                return address;
            }

        } catch (error) {

            console.error(
                "Failed to read deployments.json:",
                error
            );
        }
    }

    const contractsFile =
        path.resolve(
            __dirname,
            "../packages/shared/src/contracts.ts"
        );

    if (
        fs.existsSync(
            contractsFile
        )
    ) {

        try {

            const source =
                fs.readFileSync(
                    contractsFile,
                    "utf8"
                );

            const match =
                source.match(
                    /RoboPay[\s\S]{0,500}?address\s*:\s*["'](0x[a-fA-F0-9]{40})["']/
                );

            if (match) {
                return match[1];
            }

        } catch (error) {

            console.error(
                "Failed to inspect shared contracts:",
                error
            );
        }
    }

    throw new Error(
        "RoboPay contract address not found. Deploy the contract first."
    );
}

function getReadContract() {

    return new ethers.Contract(
        getContractAddress(),
        ABI,
        getProvider()
    );
}

function getWriteContract() {

    return new ethers.Contract(
        getContractAddress(),
        ABI,
        getAdminWallet()
    );
}

function canonicalJson(
    value
) {

    if (
        value === null ||
        typeof value !==
            "object"
    ) {
        return JSON.stringify(
            value
        );
    }

    if (
        Array.isArray(value)
    ) {
        return (
            "[" +
            value
                .map(
                    canonicalJson
                )
                .join(",") +
            "]"
        );
    }

    return (
        "{" +
        Object.keys(value)
            .sort()
            .map(
                (key) =>
                    JSON.stringify(
                        key
                    ) +
                    ":" +
                    canonicalJson(
                        value[key]
                    )
            )
            .join(",") +
        "}"
    );
}

function sha256Hex(
    value
) {

    return crypto
        .createHash(
            "sha256"
        )
        .update(
            value,
            "utf8"
        )
        .digest("hex");
}

function hashToBytes32(
    hex
) {

    return (
        "0x" +
        hex
    );
}

function toIso(
    unixSeconds
) {

    return new Date(
        Number(
            unixSeconds
        ) * 1000
    ).toISOString();
}

function sameAddress(
    a,
    b
) {

    return (
        String(a).toLowerCase() ===
        String(b).toLowerCase()
    );
}

function calculateRentalHash(
    rental
) {

    return ethers.solidityPackedKeccak256(
        [
            "string",
            "string",
            "string",
            "uint256",
            "uint256",
            "address",
            "uint256",
            "uint256"
        ],
        [
            rental.orderId,
            rental.robotId,
            rental.service,
            rental.durationMinutes,
            rental.amountInr,
            rental.customer,
            rental.startTime,
            rental.endTime
        ]
    );
}

// ============================================================
// HEALTH
// ============================================================

app.get(
    "/",
    (req, res) => {

        res.json({
            success: true,
            service:
                "RoboPay Backend",
            network:
                "MST Testnet",
            chainId:
                CHAIN_ID
        });
    }
);

// ============================================================
// CONFIG
// ============================================================

app.get(
    "/api/config",
    (req, res) => {

        try {

            res.json({
                success: true,
                contractAddress:
                    getContractAddress(),
                chainId:
                    CHAIN_ID,
                rpcUrl:
                    RPC_URL,
                explorer:
                    "https://testnet.mstscan.com"
            });

        } catch (error) {

            res.status(500)
                .json({
                    success: false,
                    error:
                        error.message
                });
        }
    }
);

// ============================================================
// ROBOTS
// ============================================================

app.get(
    "/api/robots",
    async (req, res) => {

        try {

            const contract =
                getReadContract();

            const robots =
                await Promise.all(
                    ROBOTS.map(
                        async (robot) => {

                            const onChain =
                                await contract.getRobot(
                                    robot.id
                                );

                            const status =
                                Number(
                                    onChain[4]
                                ) === 0
                                    ? "AVAILABLE"
                                    : "IN_USE";

                            return {
                                id:
                                    onChain[0],
                                name:
                                    onChain[1],
                                service:
                                    onChain[2],
                                owner:
                                    onChain[3],
                                status
                            };
                        }
                    )
                );

            res.json({
                success: true,
                robots
            });

        } catch (error) {

            console.error(
                error
            );

            res.status(500)
                .json({
                    success:
                        false,
                    error:
                        error.message
                });
        }
    }
);

// ============================================================
// CREATE BOOKING
// ============================================================

app.post(
    "/api/bookings",
    async (req, res) => {

        try {

            const {
                robotId,
                durationMinutes
            } = req.body;

            if (
                !robotId ||
                !durationMinutes
            ) {

                return res
                    .status(400)
                    .json({
                        success:
                            false,
                        error:
                            "robotId and durationMinutes are required"
                    });
            }

            const robot =
                ROBOTS.find(
                    (item) =>
                        item.id ===
                        robotId
                );

            if (!robot) {

                return res
                    .status(404)
                    .json({
                        success:
                            false,
                        error:
                            "Robot not found"
                    });
            }

            const contract =
                getReadContract();

            const robotData =
                await contract.getRobot(
                    robotId
                );

            const status =
                Number(
                    robotData[4]
                ) === 0
                    ? "AVAILABLE"
                    : "IN_USE";

            if (
                status !==
                "AVAILABLE"
            ) {

                return res
                    .status(400)
                    .json({
                        success:
                            false,
                        error:
                            "Robot is currently unavailable"
                    });
            }

            const amountInr =
                Number(
                    await contract.requiredAmountInr(
                        robotId,
                        durationMinutes
                    )
                );

            const requiredPayment =
                await contract.requiredPayment(
                    robotId,
                    durationMinutes
                );

            const orderId =
                "RP" +
                Date.now();

            const orders =
                readOrders();

            orders[orderId] = {
                orderId,
                robotId,
                robotName:
                    robot.name,
                service:
                    robot.service,
                durationMinutes:
                    Number(
                        durationMinutes
                    ),
                amountInr,
                requiredPaymentWei:
                    requiredPayment.toString(),
                requiredPaymentTmstc:
                    ethers.formatEther(
                        requiredPayment
                    ),
                paymentStatus:
                    "PENDING",
                blockchainStatus:
                    "WAITING",
                rentalStatus:
                    "PENDING",
                transactionHash:
                    null,
                customerAddress:
                    null,
                startTime:
                    null,
                expiresAt:
                    null,
                completed:
                    false,
                activity:
                    null
            };

            writeOrders(
                orders
            );

            res.json({
                success: true,
                order:
                    orders[orderId]
            });

        } catch (error) {

            console.error(
                "Booking error:",
                error
            );

            res.status(500)
                .json({
                    success:
                        false,
                    error:
                        error.message
                });
        }
    }
);

// ============================================================
// GET ORDER
// ============================================================

app.get(
    "/api/orders/:orderId",
    (req, res) => {

        const orders =
            readOrders();

        const order =
            orders[
                req.params.orderId
            ];

        if (!order) {

            return res
                .status(404)
                .json({
                    success:
                        false,
                    error:
                        "Order not found"
                });
        }

        res.json({
            success: true,
            order
        });
    }
);

// ============================================================
// VERIFY REAL MST RENTAL
// ============================================================

app.post(
    "/api/blockchain/verify-rental",
    async (req, res) => {

        try {

            const {
                orderId,
                transactionHash,
                walletAddress
            } = req.body;

            if (
                !orderId ||
                !transactionHash ||
                !walletAddress
            ) {

                return res
                    .status(400)
                    .json({
                        success:
                            false,
                        error:
                            "orderId, transactionHash and walletAddress are required"
                    });
            }

            const orders =
                readOrders();

            const localOrder =
                orders[orderId];

            if (!localOrder) {

                return res
                    .status(404)
                    .json({
                        success:
                            false,
                        error:
                            "Order not found"
                    });
            }

            const provider =
                getProvider();

            const receipt =
                await provider.getTransactionReceipt(
                    transactionHash
                );

            if (!receipt) {

                return res
                    .status(400)
                    .json({
                        success:
                            false,
                        error:
                            "Transaction does not exist on MST Testnet yet."
                    });
            }

            if (
                receipt.status !==
                1
            ) {

                return res
                    .status(400)
                    .json({
                        success:
                            false,
                        error:
                            "Blockchain transaction failed."
                    });
            }

            const contract =
                getReadContract();

            const rental =
                await contract.getRental(
                    orderId
                );

            const onChainOrderId =
                rental[0];

            const onChainRobotId =
                rental[1];

            const onChainService =
                rental[2];

            const onChainDuration =
                Number(
                    rental[3]
                );

            const onChainAmountInr =
                Number(
                    rental[4]
                );

            const onChainAmountPaidWei =
                rental[5].toString();

            const onChainCustomer =
                rental[6];

            const onChainStartTime =
                Number(
                    rental[7]
                );

            const onChainEndTime =
                Number(
                    rental[8]
                );

            const onChainActive =
                rental[9];

            const onChainCompleted =
                rental[10];

            const onChainActivityHash =
                rental[11];

            const onChainRentalDataHash =
                rental[12];

            const expectedPayment =
                await contract.requiredPayment(
                    onChainRobotId,
                    onChainDuration
                );

            const paymentRecipient =
                await contract.paymentRecipient();

            if (
                onChainOrderId !==
                localOrder.orderId
            ) {
                throw new Error(
                    "Order ID mismatch."
                );
            }

            if (
                onChainRobotId !==
                localOrder.robotId
            ) {
                throw new Error(
                    "Robot ID mismatch."
                );
            }

            if (
                onChainService !==
                localOrder.service
            ) {
                throw new Error(
                    "Service mismatch."
                );
            }

            if (
                onChainDuration !==
                Number(
                    localOrder.durationMinutes
                )
            ) {
                throw new Error(
                    "Duration mismatch."
                );
            }

            if (
                onChainAmountInr !==
                Number(
                    localOrder.amountInr
                )
            ) {
                throw new Error(
                    "INR amount mismatch."
                );
            }

            if (
                onChainAmountPaidWei !==
                expectedPayment.toString()
            ) {
                throw new Error(
                    "On-chain payment amount does not match package."
                );
            }

            if (
                !sameAddress(
                    onChainCustomer,
                    walletAddress
                )
            ) {
                throw new Error(
                    "Customer wallet does not match the on-chain rental."
                );
            }

            if (
                !onChainActive
            ) {
                throw new Error(
                    "Rental is not active."
                );
            }

            if (
                !sameAddress(
                    paymentRecipient,
                    await getAdminWallet().getAddress()
                )
            ) {
                throw new Error(
                    "Payment recipient configuration mismatch."
                );
            }

            localOrder.paymentStatus =
                "CONFIRMED";

            localOrder.blockchainStatus =
                "CONFIRMED";

            localOrder.rentalStatus =
                "ACTIVE";

            localOrder.transactionHash =
                transactionHash;

            localOrder.customerAddress =
                onChainCustomer;

            localOrder.startTime =
                toIso(
                    onChainStartTime
                );

            localOrder.expiresAt =
                toIso(
                    onChainEndTime
                );

            localOrder.completed =
                onChainCompleted;

            localOrder.activityHash =
                onChainActivityHash;

            localOrder.rentalDataHash =
                onChainRentalDataHash;

            localOrder.blockNumber =
                receipt.blockNumber;

            localOrder.verifiedAt =
                new Date()
                    .toISOString();

            writeOrders(
                orders
            );

            res.json({
                success: true,
                message:
                    "MST rental verified successfully.",
                order:
                    localOrder,
                transactionHash
            });

        } catch (error) {

            console.error(
                "Verification error:",
                error
            );

            res.status(500)
                .json({
                    success:
                        false,
                    error:
                        error.message
                });
        }
    }
);

// ============================================================
// RECORD ROBOT ACTIVITY
// ============================================================

app.post(
    "/api/activity/:orderId",
    async (req, res) => {

        try {

            const {
                orderId
            } = req.params;

            const {
                activity
            } = req.body;

            if (
                !activity
            ) {

                return res
                    .status(400)
                    .json({
                        success:
                            false,
                        error:
                            "activity object is required"
                    });
            }

            const orders =
                readOrders();

            const order =
                orders[orderId];

            if (!order) {

                return res
                    .status(404)
                    .json({
                        success:
                            false,
                        error:
                            "Rental order not found"
                    });
            }

            const canonical =
                canonicalJson(
                    activity
                );

            const sha =
                sha256Hex(
                    canonical
                );

            const activityHash =
                hashToBytes32(
                    sha
                );

            const contract =
                getWriteContract();

            const tx =
                await contract.recordActivityHash(
                    orderId,
                    activityHash
                );

            const receipt =
                await tx.wait();

            order.activity =
                activity;

            order.activityHash =
                activityHash;

            order.activityHashAlgorithm =
                "SHA-256";

            order.activityCanonicalData =
                canonical;

            order.activityTransactionHash =
                receipt.hash;

            order.activityRecordedAt =
                new Date()
                    .toISOString();

            writeOrders(
                orders
            );

            res.json({
                success: true,
                orderId,
                activityHash,
                transactionHash:
                    receipt.hash,
                message:
                    "Robot activity hash anchored on MST."
            });

        } catch (error) {

            console.error(
                "Activity error:",
                error
            );

            res.status(500)
                .json({
                    success:
                        false,
                    error:
                        error.message
                });
        }
    }
);

// ============================================================
// INTEGRITY CHECK
// ============================================================

app.get(
    "/api/integrity/:orderId",
    async (req, res) => {

        try {

            const {
                orderId
            } = req.params;

            const orders =
                readOrders();

            const order =
                orders[orderId];

            if (!order) {

                return res
                    .status(404)
                    .json({
                        success:
                            false,
                        error:
                            "Rental order not found"
                    });
            }

            const contract =
                getReadContract();

            const rental =
                await contract.getRental(
                    orderId
                );

            const chainRental = {
                orderId:
                    rental[0],
                robotId:
                    rental[1],
                service:
                    rental[2],
                durationMinutes:
                    Number(
                        rental[3]
                    ),
                amountInr:
                    Number(
                        rental[4]
                    ),
                amountPaidWei:
                    rental[5].toString(),
                customer:
                    rental[6],
                startTime:
                    Number(
                        rental[7]
                    ),
                endTime:
                    Number(
                        rental[8]
                    ),
                active:
                    rental[9],
                completed:
                    rental[10],
                activityHash:
                    rental[11],
                rentalDataHash:
                    rental[12]
            };

            // ----------------------------------------------------
            // RENTAL HASH CHECK
            // ----------------------------------------------------

            const databaseRental =
                {
                    orderId:
                        order.orderId,
                    robotId:
                        order.robotId,
                    service:
                        order.service,
                    durationMinutes:
                        Number(
                            order.durationMinutes
                        ),
                    amountInr:
                        Number(
                            order.amountInr
                        ),
                    customer:
                        order.customerAddress ||
                        ethers.ZeroAddress,
                    startTime:
                        chainRental.startTime,
                    endTime:
                        chainRental.endTime
                };

            const databaseHash =
                calculateRentalHash(
                    databaseRental
                );

            const rentalHashMatch =
                databaseHash.toLowerCase() ===
                chainRental.rentalDataHash.toLowerCase();

            // ----------------------------------------------------
            // ACTIVITY HASH CHECK
            // ----------------------------------------------------

            let activityResult = {
                calculatedHash:
                    ethers.ZeroHash,
                blockchainHash:
                    chainRental.activityHash,
                match: false,
                activityRecorded:
                    false
            };

            if (
                order.activity
            ) {

                const canonical =
                    canonicalJson(
                        order.activity
                    );

                const sha =
                    sha256Hex(
                        canonical
                    );

                const calculatedHash =
                    hashToBytes32(
                        sha
                    );

                const matches =
                    await contract.verifyActivityHash(
                        orderId,
                        calculatedHash
                    );

                activityResult = {
                    calculatedHash,
                    blockchainHash:
                        chainRental.activityHash,
                    match:
                        matches,
                    activityRecorded:
                        chainRental.activityHash !==
                        ethers.ZeroHash
                };

            } else {

                activityResult.activityRecorded =
                    chainRental.activityHash !==
                    ethers.ZeroHash;
            }

            res.json({
                success: true,
                rentalIntegrity: {
                    databaseHash:
                        databaseHash,
                    blockchainHash:
                        chainRental.rentalDataHash,
                    match:
                        rentalHashMatch
                },
                activityIntegrity:
                    activityResult
            });

        } catch (error) {

            console.error(
                "Integrity error:",
                error
            );

            res.status(500)
                .json({
                    success:
                        false,
                    error:
                        error.message
                });
        }
    }
);

// ============================================================
// COMPLETE RENTAL
// ============================================================

app.post(
    "/api/rentals/:orderId/complete",
    async (req, res) => {

        try {

            const {
                orderId
            } = req.params;

            const orders =
                readOrders();

            const order =
                orders[orderId];

            if (!order) {

                return res
                    .status(404)
                    .json({
                        success:
                            false,
                        error:
                            "Rental order not found"
                    });
            }

            if (
                order.rentalStatus !==
                "ACTIVE"
            ) {

                return res.json({
                    success:
                        true,
                    order
                });
            }

            const contract =
                getWriteContract();

            const tx =
                await contract.endRental(
                    orderId
                );

            const receipt =
                await tx.wait();

            order.paymentStatus =
                "CONFIRMED";

            order.blockchainStatus =
                "CONFIRMED";

            order.rentalStatus =
                "COMPLETED";

            order.completed =
                true;

            order.completedAt =
                new Date()
                    .toISOString();

            order.completionTransactionHash =
                receipt.hash;

            writeOrders(
                orders
            );

            res.json({
                success: true,
                order,
                transactionHash:
                    receipt.hash
            });

        } catch (error) {

            console.error(
                "Completion error:",
                error
            );

            res.status(500)
                .json({
                    success:
                        false,
                    error:
                        error.message
                });
        }
    }
);

// ============================================================
// START SERVER
// ============================================================

app.listen(
    PORT,
    () => {

        console.log(
            "========================================"
        );

        console.log(
            "RoboPay Backend"
        );

        console.log(
            "MST Testnet"
        );

        console.log(
            `Server: http://localhost:${PORT}`
        );

        console.log(
            "========================================"
        );

        try {

            console.log(
                "Contract:",
                getContractAddress()
            );

        } catch (error) {

            console.log(
                "Contract:",
                "Not deployed yet"
            );
        }
    }
);