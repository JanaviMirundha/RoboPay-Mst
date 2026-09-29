import { expect } from "chai";
import { ethers } from "hardhat";
import { Hello__factory } from "../typechain-types";

describe("Hello", () => {
  async function deployFixture() {
    const [owner, other] = await ethers.getSigners();
    const hello = await new Hello__factory(owner).deploy("Hello, MST!");
    await hello.waitForDeployment();
    return { hello, owner, other };
  }

  it("sets the initial message", async () => {
    const { hello } = await deployFixture();
    expect(await hello.getMessage()).to.equal("Hello, MST!");
  });

  it("lets the owner update the message", async () => {
    const { hello, owner } = await deployFixture();
    await expect(hello.connect(owner).setMessage("gm"))
      .to.emit(hello, "MessageChanged")
      .withArgs("Hello, MST!", "gm", owner.address);
    expect(await hello.getMessage()).to.equal("gm");
  });

  it("reverts when a non-owner tries to update the message", async () => {
    const { hello, other } = await deployFixture();
    await expect(hello.connect(other).setMessage("nope")).to.be.revertedWithCustomError(
      hello,
      "OwnableUnauthorizedAccount"
    );
  });
});
