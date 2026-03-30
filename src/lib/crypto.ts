import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual
} from "node:crypto";

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

function deriveEncryptionKey(key: string): Buffer {
  return createHash("sha256")
    .update(`encrypt:${key}`)
    .digest();
}

export function encryptSensitiveValue(value: string, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveEncryptionKey(key), iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, ciphertext]).toString("base64url");
}

export function decryptSensitiveValue(payload: string, key: string): string {
  const buffer = Buffer.from(payload, "base64url");
  const iv = buffer.subarray(0, 12);
  const authTag = buffer.subarray(12, 28);
  const ciphertext = buffer.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", deriveEncryptionKey(key), iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]).toString("utf8");
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
