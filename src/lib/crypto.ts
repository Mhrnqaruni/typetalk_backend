import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

function hashValue(prefix: string, value: string, key: string): string {
  return createHmac("sha256", key)
    .update(`${prefix}:${value}`)
    .digest("hex");
}

export function hashOtpCode(code: string, key: string): string {
  return hashValue("otp", code, key);
}

export function hashRefreshSecret(secret: string, key: string): string {
  return hashValue("refresh", secret, key);
}

export function hashIpAddress(ipAddress: string, key: string): string {
  return hashValue("ip", ipAddress, key);
}

export function hashIdempotencyPayload(payload: string, key: string): string {
  return hashValue("idempotency", payload, key);
}

export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function generateOpaqueSecret(): string {
  return randomBytes(32).toString("hex");
}

export function hashesMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
