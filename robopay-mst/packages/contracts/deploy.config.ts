import type { HardhatRuntimeEnvironment } from "hardhat/types";
import { RoboPayEscrow__factory } from "./typechain-types";

export const ADMIN_ADDRESS = "0xa2f79Ec629674fFbC1814F93a89BfF06aDe01661";

export async function deployAll(hre: HardhatRuntimeEnvironment) {
  const [deployer] = await hre.ethers.getSigners();

  if (hre.network.name !== "testnet" || hre.network.config.chainId !== 91562037) {
    throw new Error("RoboPayEscrow deployment is restricted to MST Testnet (chain ID 91562037).");
  }
  console.log("========================================");
  console.log("RoboPay MST Escrow Deployment");
  console.log("Gas payer:", deployer.address);
  console.log("Contract owner/payment recipient:", ADMIN_ADDRESS);
  console.log("========================================");

  const paymentRecipient = ADMIN_ADDRESS;
  const roboPay = await new RoboPayEscrow__factory(deployer).deploy(paymentRecipient);

  await roboPay.waitForDeployment();

  const address = await roboPay.getAddress();

  const [owner, recipient] = await Promise.all([
    roboPay.owner(),
    roboPay.paymentRecipient(),
  ]);
  if (owner.toLowerCase() !== ADMIN_ADDRESS.toLowerCase()) {
    throw new Error(`Escrow owner validation failed: ${owner}`);
  }
  if (recipient.toLowerCase() !== ADMIN_ADDRESS.toLowerCase()) {
    throw new Error(`Escrow payment recipient validation failed: ${recipient}`);
  }
  console.log("RoboPayEscrow contract:", address);
  console.log("Verified owner and payment recipient:", ADMIN_ADDRESS);

  const robots = [
    {
      id: "RF-01",
      name: "RoboFollow",
      service: "Human Following",
    },
    {
      id: "FC-01",
      name: "RoboClean",
      service: "Floor Cleaning",
    },
    {
      id: "ST-01",
      name: "RoboTrolley",
      service: "Smart Shopping Trolley",
    },
    {
      id: "RC-01",
      name: "RoboCourier",
      service: "Autonomous Parcel Delivery",
    },
  ];

  const registeredIds = await roboPay.getRobotIds();
  if (registeredIds.join(",") !== robots.map((robot) => robot.id).join(",")) {
    throw new Error(`Escrow robot registry validation failed: ${registeredIds.join(",")}`);
  }
  for (const robot of robots) {
    const registered = await roboPay.getRobot(robot.id);
    if (!registered.registered || registered.name !== robot.name || registered.service !== robot.service) {
      throw new Error(`Escrow robot metadata validation failed for ${robot.id}.`);
    }
    console.log(`✓ ${robot.id} registered in escrow constructor`);
  }

  return {
    RoboPayEscrow: {
      address,
      constructorArguments: [paymentRecipient],
    },
  };
}