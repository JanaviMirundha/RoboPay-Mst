import { expect } from "chai";
import { ethers } from "hardhat";
import { RoboPayEscrow__factory } from "../typechain-types";

const ADMIN = "0xa2f79Ec629674fFbC1814F93a89BfF06aDe01661";
const PRICE_1 = ethers.parseEther("0.001");
const PRICE_2 = ethers.parseEther("0.002");
const PRICE_3 = ethers.parseEther("0.003");
const ACTIVITY_HASH = ethers.keccak256(ethers.toUtf8Bytes("verified session evidence"));
const FAILURE_HASH = ethers.keccak256(ethers.toUtf8Bytes("verified failure evidence"));

describe("RoboPayEscrow", () => {
  async function deployFixture() {
    const [deployer, customer, other] = await ethers.getSigners();
    await ethers.provider.send("hardhat_setBalance", [ADMIN, "0x56BC75E2D63100000"]);
    await ethers.provider.send("hardhat_impersonateAccount", [ADMIN]);
    const operator = await ethers.getSigner(ADMIN);
    const escrow = await new RoboPayEscrow__factory(deployer).deploy(ADMIN);
    await escrow.waitForDeployment();

    return { escrow, deployer, customer, other, operator };
  }

  async function createRental(escrow: Awaited<ReturnType<typeof deployFixture>>["escrow"], customer: Awaited<ReturnType<typeof deployFixture>>["customer"], orderId = "order-1") {
    return escrow.connect(customer).rentRobot(
      orderId,
      "RF-01",
      "Human Following",
      1,
      2,
      { value: PRICE_1 },
    );
  }

  function createRentalWithPackage(
    escrow: Awaited<ReturnType<typeof deployFixture>>["escrow"],
    customer: Awaited<ReturnType<typeof deployFixture>>["customer"],
    durationMinutes: number,
    amountInr: number,
    orderId = "order-1",
  ) {
    const expectedPayment = durationMinutes === 1 ? PRICE_1 : durationMinutes === 2 ? PRICE_2 : PRICE_3;
    return escrow.connect(customer).rentRobot(
      orderId,
      "RF-01",
      "Human Following",
      durationMinutes,
      amountInr,
      { value: expectedPayment },
    );
  }

  it("assigns the configured admin as owner and recipient and registers all robots", async () => {
    const { escrow } = await deployFixture();
    expect(await escrow.owner()).to.equal(ADMIN);
    expect(await escrow.paymentRecipient()).to.equal(ADMIN);
    expect(await escrow.getRobotIds()).to.deep.equal(["RF-01", "FC-01", "ST-01", "RC-01"]);
    const newRobot = await escrow.getRobot("RC-01");
    expect(newRobot.name).to.equal("RoboCourier");
    expect(newRobot.service).to.equal("Autonomous Parcel Delivery");
    expect(newRobot.status).to.equal(0);
  });

  it("escrows the exact rental payment and marks the rental and robot active", async () => {
    const { escrow, customer } = await deployFixture();
    const adminBefore = await ethers.provider.getBalance(ADMIN);
    await createRentalWithPackage(escrow, customer, 1, 2);

    expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(PRICE_1);
    expect(await ethers.provider.getBalance(ADMIN)).to.equal(adminBefore);
    expect(await escrow.escrowedAmount("order-1")).to.equal(PRICE_1);
    expect((await escrow.getRental("order-1")).status).to.equal(0);
    expect((await escrow.getRobot("RF-01")).status).to.equal(1);
  });

  it("applies the exact 1/2/3-minute packages to RoboCourier and marks it in use only after booking", async () => {
    const { escrow, customer } = await deployFixture();
    for (const [minutes, inr, payment] of [[1, 2, PRICE_1], [2, 4, PRICE_2], [3, 6, PRICE_3]] as const) {
      expect(await escrow.requiredAmountInr("RC-01", minutes)).to.equal(inr);
      expect(await escrow.requiredPayment("RC-01", minutes)).to.equal(payment);
    }

    expect((await escrow.getRobot("RC-01")).status).to.equal(0);
    await escrow.connect(customer).rentRobot("courier-rental", "RC-01", "Autonomous Parcel Delivery", 1, 2, { value: PRICE_1 });
    expect((await escrow.getRobot("RC-01")).status).to.equal(1);
    expect((await escrow.getRental("courier-rental")).status).to.equal(0);
  });

  it("settles successful activity to admin only after the rental end time", async () => {
    const { escrow, customer, operator } = await deployFixture();
    await createRentalWithPackage(escrow, customer, 1, 2);
    await escrow.connect(operator).recordActivityHash("order-1", ACTIVITY_HASH);
    const rental = await escrow.getRental("order-1");
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(rental.endTime)]);
    await ethers.provider.send("evm_mine", []);

    const adminBefore = await ethers.provider.getBalance(ADMIN);
    const settlement = await escrow.connect(operator).settleRental("order-1");
    const receipt = await settlement.wait();
    const gasCost = receipt!.gasUsed * BigInt(receipt!.gasPrice);
    expect(await ethers.provider.getBalance(ADMIN)).to.equal(adminBefore + PRICE_1 - gasCost);
    expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0n);
    expect(await escrow.escrowedAmount("order-1")).to.equal(0n);
    expect((await escrow.getRental("order-1")).status).to.equal(1);
    expect((await escrow.getRobot("RF-01")).status).to.equal(0);
    await expect(settlement).to.emit(escrow, "RentalSettled").withArgs(
      "order-1", "RF-01", ADMIN, PRICE_1, (await escrow.getRental("order-1")).settledAt,
    );
  });

  it("refunds escrow to the original customer and stores evidence", async () => {
    const { escrow, customer, operator } = await deployFixture();
    await createRentalWithPackage(escrow, customer, 1, 2);
    await escrow.connect(operator).recordActivityHash("order-1", ACTIVITY_HASH);
    const customerBeforeRefund = await ethers.provider.getBalance(customer.address);
    const refund = await escrow.connect(operator).refundRental("order-1", FAILURE_HASH);
    await refund.wait();

    expect(await ethers.provider.getBalance(customer.address)).to.equal(customerBeforeRefund + PRICE_1);
    expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0n);
    const rental = await escrow.getRental("order-1");
    expect(rental.status).to.equal(2);
    expect(rental.failureReasonHash).to.equal(FAILURE_HASH);
    expect(rental.activityHash).to.equal(ACTIVITY_HASH);
    expect(rental.settledAt).to.be.greaterThan(0n);
    expect((await escrow.getRobot("RF-01")).status).to.equal(0);
    await expect(refund).to.emit(escrow, "RentalRefunded").withArgs(
      "order-1", "RF-01", customer.address, PRICE_1, FAILURE_HASH, ACTIVITY_HASH, rental.settledAt,
    );
  });

  it("prevents settlement before end time and requires activity evidence", async () => {
    const { escrow, customer, operator } = await deployFixture();
    await createRentalWithPackage(escrow, customer, 1, 2);
    await expect(escrow.connect(operator).settleRental("order-1")).to.be.revertedWith("Rental has not ended");
    const rental = await escrow.getRental("order-1");
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(rental.endTime)]);
    await ethers.provider.send("evm_mine", []);
    await expect(escrow.connect(operator).settleRental("order-1")).to.be.revertedWith("Activity hash required");
    await escrow.connect(operator).recordActivityHash("order-1", ACTIVITY_HASH);
    await escrow.connect(operator).settleRental("order-1");
  });

  it("rejects unauthorized outcome decisions and activity writes", async () => {
    const { escrow, customer, other, operator } = await deployFixture();
    await createRental(escrow, customer);
    await expect(escrow.connect(other).settleRental("order-1")).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    await expect(escrow.connect(other).refundRental("order-1", FAILURE_HASH)).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    await expect(escrow.connect(other).recordActivityHash("order-1", ACTIVITY_HASH)).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    await expect(escrow.connect(customer).refundRental("order-1", FAILURE_HASH)).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    await expect(escrow.connect(operator).renounceOwnership()).to.be.revertedWith("Ownership renouncement disabled");
    await escrow.connect(operator).recordActivityHash("order-1", ACTIVITY_HASH);
  });

  it("prevents duplicate orders, wrong payments, wrong packages, and unregistered robots", async () => {
    const { escrow, customer, operator } = await deployFixture();
    await expect(escrow.connect(customer).rentRobot("bad-payment", "RF-01", "Human Following", 1, 2, { value: PRICE_1 + 1n }))
      .to.be.revertedWith("Incorrect payment amount");
    await expect(escrow.connect(customer).rentRobot("bad-package", "RF-01", "Human Following", 1, 21, { value: PRICE_1 }))
      .to.be.revertedWith("Incorrect INR package");
    await expect(escrow.connect(customer).rentRobot("unknown-robot", "ZZ-01", "Unknown", 1, 2, { value: PRICE_1 }))
      .to.be.revertedWith("Robot not registered");
    await createRental(escrow, customer);
    await expect(createRental(escrow, customer)).to.be.revertedWith("Order already exists");
    await expect(escrow.connect(customer).rentRobot("other-order", "RF-01", "Human Following", 1, 2, { value: PRICE_1 }))
      .to.be.revertedWith("Robot is not available");
  });

  it("blocks both outcome transitions after either settlement or refund", async () => {
    const { escrow, customer, operator } = await deployFixture();
    await createRentalWithPackage(escrow, customer, 1, 2, "settled");
    await escrow.connect(operator).recordActivityHash("settled", ACTIVITY_HASH);
    const settlementRental = await escrow.getRental("settled");
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(settlementRental.endTime)]);
    await ethers.provider.send("evm_mine", []);
    await escrow.connect(operator).settleRental("settled");
    await expect(escrow.connect(operator).refundRental("settled", FAILURE_HASH)).to.be.revertedWith("Rental is not active");
    await expect(escrow.connect(operator).settleRental("settled")).to.be.revertedWith("Rental is not active");

    await createRentalWithPackage(escrow, customer, 1, 2, "refunded");
    await escrow.connect(operator).recordActivityHash("refunded", ACTIVITY_HASH);
    await escrow.connect(operator).refundRental("refunded", FAILURE_HASH);
    await expect(escrow.connect(operator).settleRental("refunded")).to.be.revertedWith("Rental is not active");
    await expect(escrow.connect(operator).refundRental("refunded", FAILURE_HASH)).to.be.revertedWith("Rental is not active");
  });

  it("blocks a second customer while in use and permits them after verified refund", async () => {
    const { escrow, customer, other, operator } = await deployFixture();
    await createRentalWithPackage(escrow, customer, 1, 2, "customer-a");
    await expect(
      escrow.connect(other).rentRobot("customer-b-early", "RF-01", "Human Following", 1, 2, { value: PRICE_1 }),
    ).to.be.revertedWith("Robot is not available");

    await escrow.connect(operator).recordActivityHash("customer-a", ACTIVITY_HASH);
    await escrow.connect(operator).refundRental("customer-a", FAILURE_HASH);
    await escrow.connect(other).rentRobot("customer-b-after-refund", "RF-01", "Human Following", 1, 2, { value: PRICE_1 });
    expect((await escrow.getRobot("RF-01")).status).to.equal(1);
    expect((await escrow.getRental("customer-b-after-refund")).customer).to.equal(other.address);
  });
});
