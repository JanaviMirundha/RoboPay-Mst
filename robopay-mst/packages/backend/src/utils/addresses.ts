import { getAddress, isAddress } from "ethers";
import { ERRORS } from "./errors.js";

export function normalizeAddress(value: string): string {
  if (!isAddress(value)) throw ERRORS.INVALID_ADDRESS();
  return getAddress(value);
}