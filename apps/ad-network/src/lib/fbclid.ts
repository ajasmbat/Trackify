import { randomBytes } from "node:crypto";

const FBCLID_PREFIX = "IwAR";
const FBCLID_RANDOM_BYTES = 27;

export const FBCLID_PATTERN = /^IwAR[A-Za-z0-9_-]{36}$/;

export function generateFbclid(): string {
  const raw = randomBytes(FBCLID_RANDOM_BYTES).toString("base64url");
  return `${FBCLID_PREFIX}${raw}`;
}

export function generateGclid(): string {
  return randomBytes(30).toString("base64url");
}
