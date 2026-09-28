import { expect } from "chai";
import { ethers } from "hardhat";

describe("RoboPay", function () {

    async function deployRoboPay() {

        const [
            owner,
            customer,
            other
        ] = await ethers.getSigners();

        const RoboPay =
            await ethers.getContractFactory(
                "RoboPay"
            );

        const roboPay =
            await RoboPay.deploy(
                owner.address
            );

        await roboPay.waitForDeployment();

        return {
            roboPay,
            owner,
            customer,
            other
        };
    }

    // ============================================================
    // DEPLOYMENT
    // ============================================================

    it(
        "sets owner and payment recipient",
        async function () {

            const {
                roboPay,
                owner
            } = await deployRoboPay();

            expect(
                await roboPay.owner()
            ).to.equal(
                owner.address
            );

            expect(
                await roboPay.paymentRecipient()
            ).to.equal(
                owner.address
            );
        }
    );

    // ============================================================
    // ROBOT REGISTRATION
    // ============================================================

    it(
        "registers a robot",
        async function () {

            const {
                roboPay,
                owner
            } = await deployRoboPay();

            await roboPay.registerRobot(
                "RF-01",
                "RoboFollow",
                "Human Following"
            );

            const robot =
                await roboPay.getRobot(
                    "RF-01"
                );

            expect(robot[0]).to.equal(
                "RF-01"
            );

            expect(robot[1]).to.equal(
                "RoboFollow"
            );

            expect(robot[2]).to.equal(
                "Human Following"
            );

            expect(robot[3]).to.equal(
                owner.address
            );

            // AVAILABLE
            expect(robot[4]).to.equal(0);

            expect(robot[5]).to.equal(
                true
            );
        }
    );

    // ============================================================
    // ONLY OWNER
    // ============================================================

    it(
        "prevents non-owner from registering robots",
        async function () {

            const {
                roboPay,
                customer
            } = await deployRoboPay();

            await expect(
                roboPay
                    .connect(customer)
                    .registerRobot(
                        "RF-01",
                        "RoboFollow",
                        "Human Following"
                    )
            ).to.be.revertedWithCustomError(
                roboPay,
                "OwnableUnauthorizedAccount"
            );
        }
    );

    // ============================================================
    // PRICING
    // ============================================================

    it(
        "returns correct INR pricing",
        async function () {

            const {
                roboPay
            } = await deployRoboPay();

            expect(
                await roboPay.requiredAmountInr(
                    "RF-01",
                    10
                )
            ).to.equal(20);

            expect(
                await roboPay.requiredAmountInr(
                    "RF-01",
                    20
                )
            ).to.equal(40);

            expect(
                await roboPay.requiredAmountInr(
                    "RF-01",
                    30
                )
            ).to.equal(60);

            expect(
                await roboPay.requiredAmountInr(
                    "FC-01",
                    10
                )
            ).to.equal(20);

            expect(
                await roboPay.requiredAmountInr(
                    "ST-01",
                    30
                )
            ).to.equal(30);
        }
    );

    // ============================================================
    // MST PAYMENT PRICING
    // ============================================================

    it(
        "returns correct MST payment requirement",
        async function () {

            const {
                roboPay
            } = await deployRoboPay();

            expect(
                await roboPay.requiredPayment(
                    "RF-01",
                    10
                )
            ).to.equal(
                ethers.parseEther("0.01")
            );

            expect(
                await roboPay.requiredPayment(
                    "RF-01",
                    20
                )
            ).to.equal(
                ethers.parseEther("0.02")
            );

            expect(
                await roboPay.requiredPayment(
                    "ST-01",
                    30
                )
            ).to.equal(
                ethers.parseEther("0.015")
            );
        }
    );

    // ============================================================
    // INVALID PACKAGE
    // ============================================================

    it(
        "rejects invalid package",
        async function () {

            const {
                roboPay
            } = await deployRoboPay();

            await expect(
                roboPay.requiredAmountInr(
                    "RF-01",
                    15
                )
            ).to.be.revertedWith(
                "Invalid robot/package"
            );
        }
    );

    // ============================================================
    // RENTAL AUTHORIZATION
    // ============================================================

    it(
        "creates a valid rental",
        async function () {

            const {
                roboPay,
                customer
            } = await deployRoboPay();

            await roboPay.registerRobot(
                "RF-01",
                "RoboFollow",
                "Human Following"
            );

            const payment =
                ethers.parseEther(
                    "0.01"
                );

            const orderId =
                "RP1001";

            await expect(
                roboPay
                    .connect(customer)
                    .rentRobot(
                        orderId,
                        "RF-01",
                        "Human Following",
                        10,
                        20,
                        {
                            value: payment
                        }
                    )
            ).to.emit(
                roboPay,
                "RentalCreated"
            );

            const rental =
                await roboPay.getRental(
                    orderId
                );

            expect(rental[0]).to.equal(
                orderId
            );

            expect(rental[1]).to.equal(
                "RF-01"
            );

            expect(rental[2]).to.equal(
                "Human Following"
            );

            expect(rental[3]).to.equal(10);

            expect(rental[4]).to.equal(20);

            expect(rental[5]).to.equal(
                payment
            );

            expect(rental[6]).to.equal(
                customer.address
            );

            expect(rental[9]).to.equal(
                true
            );

            expect(rental[10]).to.equal(
                false
            );

            expect(rental[11]).to.not.equal(
                ethers.ZeroHash
            );

            expect(rental[12]).to.not.equal(
                ethers.ZeroHash
            );

            const robot =
                await roboPay.getRobot(
                    "RF-01"
                );

            // IN_USE
            expect(robot[4]).to.equal(1);
        }
    );

    // ============================================================
    // WRONG PAYMENT
    // ============================================================

    it(
        "rejects incorrect MST payment",
        async function () {

            const {
                roboPay,
                customer
            } = await deployRoboPay();

            await roboPay.registerRobot(
                "RF-01",
                "RoboFollow",
                "Human Following"
            );

            await expect(
                roboPay
                    .connect(customer)
                    .rentRobot(
                        "RP1002",
                        "RF-01",
                        "Human Following",
                        10,
                        20,
                        {
                            value:
                                ethers.parseEther(
                                    "0.005"
                                )
                        }
                    )
            ).to.be.revertedWith(
                "Incorrect payment amount"
            );
        }
    );

    // ============================================================
    // WRONG PACKAGE
    // ============================================================

    it(
        "rejects incorrect INR package",
        async function () {

            const {
                roboPay,
                customer
            } = await deployRoboPay();

            await roboPay.registerRobot(
                "RF-01",
                "RoboFollow",
                "Human Following"
            );

            await expect(
                roboPay
                    .connect(customer)
                    .rentRobot(
                        "RP1003",
                        "RF-01",
                        "Human Following",
                        10,
                        40,
                        {
                            value:
                                ethers.parseEther(
                                    "0.01"
                                )
                        }
                    )
            ).to.be.revertedWith(
                "Incorrect INR package"
            );
        }
    );

    // ============================================================
    // ROBOT UNAVAILABLE
    // ============================================================

    it(
        "rejects a second rental while robot is in use",
        async function () {

            const {
                roboPay,
                customer,
                other
            } = await deployRoboPay();

            await roboPay.registerRobot(
                "RF-01",
                "RoboFollow",
                "Human Following"
            );

            await roboPay
                .connect(customer)
                .rentRobot(
                    "RP1004",
                    "RF-01",
                    "Human Following",
                    10,
                    20,
                    {
                        value:
                            ethers.parseEther(
                                "0.01"
                            )
                    }
                );

            await expect(
                roboPay
                    .connect(other)
                    .rentRobot(
                        "RP1005",
                        "RF-01",
                        "Human Following",
                        10,
                        20,
                        {
                            value:
                                ethers.parseEther(
                                    "0.01"
                                )
                        }
                    )
            ).to.be.revertedWith(
                "Robot is not available"
            );
        }
    );

    // ============================================================
    // DUPLICATE ORDER
    // ============================================================

    it(
        "rejects duplicate orders",
        async function () {

            const {
                roboPay,
                customer
            } = await deployRoboPay();

            await roboPay.registerRobot(
                "RF-01",
                "RoboFollow",
                "Human Following"
            );

            await roboPay
                .connect(customer)
                .rentRobot(
                    "RP1006",
                    "RF-01",
                    "Human Following",
                    10,
                    20,
                    {
                        value:
                            ethers.parseEther(
                                "0.01"
                            )
                    }
                );

            await roboPay.endRental(
                "RP1006"
            );

            await expect(
                roboPay
                    .connect(customer)
                    .rentRobot(
                        "RP1006",
                        "RF-01",
                        "Human Following",
                        10,
                        20,
                        {
                            value:
                                ethers.parseEther(
                                    "0.01"
                                )
                        }
                    )
            ).to.be.revertedWith(
                "Order already exists"
            );
        }
    );

    // ============================================================
    // ACTIVITY HASH
    // ============================================================

    it(
        "records and verifies robot activity",
        async function () {

            const {
                roboPay,
                customer
            } = await deployRoboPay();

            await roboPay.registerRobot(
                "RF-01",
                "RoboFollow",
                "Human Following"
            );

            await roboPay
                .connect(customer)
                .rentRobot(
                    "RP1007",
                    "RF-01",
                    "Human Following",
                    10,
                    20,
                    {
                        value:
                            ethers.parseEther(
                                "0.01"
                            )
                    }
                );

            const activityHash =
                ethers.keccak256(
                    ethers.toUtf8Bytes(
                        "RF-01|RP1007|START|STOP"
                    )
                );

            await expect(
                roboPay.recordActivityHash(
                    "RP1007",
                    activityHash
                )
            ).to.emit(
                roboPay,
                "ActivityHashRecorded"
            );

            expect(
                await roboPay.verifyActivityHash(
                    "RP1007",
                    activityHash
                )
            ).to.equal(true);

            const tamperedHash =
                ethers.keccak256(
                    ethers.toUtf8Bytes(
                        "TAMPERED"
                    )
                );

            expect(
                await roboPay.verifyActivityHash(
                    "RP1007",
                    tamperedHash
                )
            ).to.equal(false);
        }
    );

    // ============================================================
    // RENTAL COMPLETION
    // ============================================================

    it(
        "completes rental and frees robot",
        async function () {

            const {
                roboPay,
                customer
            } = await deployRoboPay();

            await roboPay.registerRobot(
                "RF-01",
                "RoboFollow",
                "Human Following"
            );

            await roboPay
                .connect(customer)
                .rentRobot(
                    "RP1008",
                    "RF-01",
                    "Human Following",
                    10,
                    20,
                    {
                        value:
                            ethers.parseEther(
                                "0.01"
                            )
                    }
                );

            await expect(
                roboPay
                    .connect(customer)
                    .endRental(
                        "RP1008"
                    )
            ).to.emit(
                roboPay,
                "RentalCompleted"
            );

            const rental =
                await roboPay.getRental(
                    "RP1008"
                );

            expect(rental[9]).to.equal(
                false
            );

            expect(rental[10]).to.equal(
                true
            );

            const robot =
                await roboPay.getRobot(
                    "RF-01"
                );

            // AVAILABLE
            expect(robot[4]).to.equal(0);
        }
    );

    // ============================================================
    // THREE ROBOTS
    // ============================================================

    it(
        "supports all three RoboPay robots",
        async function () {

            const {
                roboPay
            } = await deployRoboPay();

            await roboPay.registerRobot(
                "RF-01",
                "RoboFollow",
                "Human Following"
            );

            await roboPay.registerRobot(
                "FC-01",
                "RoboClean",
                "Floor Cleaning"
            );

            await roboPay.registerRobot(
                "ST-01",
                "RoboTrolley",
                "Smart Shopping Trolley"
            );

            const ids =
                await roboPay.getRobotIds();

            expect(ids.length).to.equal(3);

            expect(ids[0]).to.equal(
                "RF-01"
            );

            expect(ids[1]).to.equal(
                "FC-01"
            );

            expect(ids[2]).to.equal(
                "ST-01"
            );
        }
    );

});