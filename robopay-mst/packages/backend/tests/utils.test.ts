import { describe, expect, it } from "vitest";
import { addressUrl, contractUrl, transactionUrl } from "../src/utils/mstscan.js";
import { normalizeAddress } from "../src/utils/addresses.js";
import { AppError, ERRORS } from "../src/utils/errors.js";

describe("backend utilities", () => {
  it("validates and checksum-normalizes Ethereum-compatible addresses", () => {
    expect(normalizeAddress("0xa2f79ec629674ffbc1814f93a89bff06ade01661")).toBe("0xa2f79Ec629674fFbC1814F93a89BfF06aDe01661");
    expect(() => normalizeAddress("not-an-address")).toThrow(AppError);
  });

  it("builds MST Testnet explorer links", () => {
    const address = "0xfcc52AEFF244EE2e3fc39D53048229518FeE7C08";
    const hash = `0x${"a".repeat(64)}`;
    expect(contractUrl(address)).toBe(`https://testnet.mstscan.com/address/${address}`);
    expect(addressUrl(address)).toBe(`https://testnet.mstscan.com/address/${address}`);
    expect(transactionUrl(hash)).toBe(`https://testnet.mstscan.com/tx/${hash}`);
  });

  it("maps missing escrow capability to an explicit unsupported error", () => {
    const error = ERRORS.ESCROW_NOT_SUPPORTED("settleRental absent");
    expect(error).toMatchObject({ code: "ESCROW_NOT_SUPPORTED", statusCode: 501 });
  });
});
