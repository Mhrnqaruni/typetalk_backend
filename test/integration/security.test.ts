import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getConfig } from "../../src/config/env";
import { decryptSensitiveValue } from "../../src/lib/crypto";
import { runSecurityRetentionJob } from "../../src/jobs/security-retention";
import { SecurityRepository } from "../../src/modules/security/repository";
import { SecurityService } from "../../src/modules/security/service";
import { createTestHarness } from "../helpers/app";
import { resetDatabase } from "../helpers/db";

describe("security hardening", () => {
  let harness: Awaited<ReturnType<typeof createTestHarness>>;

  beforeAll(async () => {
    harness = await createTestHarness();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
    await harness.authRateLimiter.reset();
  });

  afterAll(async () => {
    await harness.app.close();
    await harness.prisma.$disconnect();
  });

  it("stores encrypted short-lived raw IP while keeping a stable hashed IP", async () => {
    const securityService = new SecurityService(new SecurityRepository(harness.prisma));
    const observation = await securityService.observeIp({
      ipAddress: "203.0.113.10",
      countryCode: "sg",
      source: "test_observation"
    });

    expect(observation).not.toBeNull();
    expect(observation?.ipHash).toBe(securityService.hashIp("203.0.113.10"));
    expect(observation?.rawIpCiphertext).not.toBe("203.0.113.10");
    expect(
      decryptSensitiveValue(observation?.rawIpCiphertext ?? "", getConfig().appEncryptionKey)
    ).toBe("203.0.113.10");
    expect(observation?.countryCode).toBe("SG");
    expect(observation?.rawIpExpiresAt).not.toBeNull();
  });

  it("clears expired raw IP ciphertext through the retention runner while keeping hashed correlation data", async () => {
    const securityService = new SecurityService(new SecurityRepository(harness.prisma));
    const observation = await securityService.observeIp({
      ipAddress: "198.51.100.25",
      countryCode: "US",
      source: "retention_test"
    });

    await harness.prisma.ipObservation.update({
      where: {
        id: observation?.id
      },
      data: {
        rawIpExpiresAt: new Date(Date.now() - 60_000)
      }
    });

    const result = await runSecurityRetentionJob(harness.prisma);
    const stored = await harness.prisma.ipObservation.findUniqueOrThrow({
      where: {
        id: observation?.id
      }
    });

    expect(result.cleared_observations).toBe(1);
    expect(stored.ipHash).toBe(securityService.hashIp("198.51.100.25"));
    expect(stored.rawIpCiphertext).toBeNull();
    expect(stored.rawIpExpiresAt).toBeNull();
  });

  it("ships a Railway-cron-compatible package script for the retention runner", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8")
    ) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["security:retention"]).toBe("tsx src/jobs/security-retention.ts");
  });
});
