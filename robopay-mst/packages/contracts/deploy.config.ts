import type { HardhatRuntimeEnvironment } from "hardhat/types";

export async function deployAll(hre: HardhatRuntimeEnvironment) {
  const [deployer] = await hre.ethers.getSigners();

  console.log("========================================");
  console.log("RoboPay MST Deployment");
  console.log("Deployer:", deployer.address);
  console.log("========================================");

  const paymentRecipient = deployer.address;

  const RoboPay = await hre.ethers.getContractFactory("RoboPay");

  const roboPay = await RoboPay.deploy(paymentRecipient);

  await roboPay.waitForDeployment();

  const address = await roboPay.getAddress();

  console.log("RoboPay contract:", address);

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
  ];

  for (const robot of robots) {
    console.log(`Registering ${robot.id}...`);

    const tx = await roboPay.registerRobot(
      robot.id,
      robot.name,
      robot.service
    );

    await tx.wait();

    console.log(`✓ ${robot.id} registered`);
  }

  return {
    RoboPay: {
      address,
      constructorArguments: [paymentRecipient],
    },
  };
}