import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestHarness } from "../helpers/app";
import { resetDatabase } from "../helpers/db";

describe("email auth flows", () => {
  let harness: Awaited<ReturnType<typeof createTestHarness>>;

  beforeAll(async () => {
    harness = await createTestHarness();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
    harness.emailProvider.sentOtps.length = 0;
    await harness.authRateLimiter.reset();
  });

  afterAll(async () => {
    await harness.app.close();
    await harness.prisma.$disconnect();
  });

  it("requests and resends OTP codes while superseding the previous challenge", async () => {
    const requestResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/email/request-code",
      payload: {
        email: "Test@Example.com"
      }
    });

    expect(requestResponse.statusCode).toBe(202);
    expect(harness.emailProvider.sentOtps).toHaveLength(1);

    const firstCode = harness.emailProvider.latestCodeFor("test@example.com");
    const firstChallenge = await harness.prisma.emailChallenge.findFirstOrThrow({
      where: {
        email: "test@example.com"
      }
    });

    expect(firstChallenge.codeHash).not.toBe(firstCode);
    expect(firstChallenge.requestedIpHash).toBeTruthy();

    const resendResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/email/resend-code",
      payload: {
        email: "test@example.com"
      }
    });

    expect(resendResponse.statusCode).toBe(202);
    expect(harness.emailProvider.sentOtps).toHaveLength(2);

    const challenges = await harness.prisma.emailChallenge.findMany({
      where: {
        email: "test@example.com"
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    expect(challenges).toHaveLength(2);
    expect(challenges[0]?.supersededAt).not.toBeNull();
    expect(challenges[1]?.supersededAt).toBeNull();
  });

  it("keeps only one active challenge when request-code is called in parallel", async () => {
    const responses = await Promise.all([
      harness.app.inject({
        method: "POST",
        url: "/v1/auth/email/request-code",
        payload: {
          email: "parallel@example.com"
        }
      }),
      harness.app.inject({
        method: "POST",
        url: "/v1/auth/email/request-code",
        payload: {
          email: "parallel@example.com"
        }
      })
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([202, 202]);

    const activeChallenges = await harness.prisma.emailChallenge.findMany({
      where: {
        email: "parallel@example.com",
        purpose: "SIGN_IN",
        usedAt: null,
        supersededAt: null
      }
    });

    expect(activeChallenges).toHaveLength(1);
  });

  it("preserves the durable per-email OTP issuance throttle and records a security event", async () => {
    const throttleHarness = await createTestHarness({
      requestCodeMaxPerIp: 20,
      verifyCodeMaxPerIp: 10
    });

    try {
      await resetDatabase(throttleHarness.prisma);
      await throttleHarness.authRateLimiter.reset();

      const statuses: number[] = [];

      for (let index = 0; index < 6; index += 1) {
        const response = await throttleHarness.app.inject({
          method: "POST",
          url: "/v1/auth/email/request-code",
          payload: {
            email: "throttle@example.com"
          }
        });

        statuses.push(response.statusCode);
      }

      const securityEvents = await throttleHarness.prisma.securityEvent.findMany({
        where: {
          eventType: "otp_request_email_throttled"
        }
      });

      expect(statuses).toEqual([202, 202, 202, 202, 202, 429]);
      expect(throttleHarness.emailProvider.sentOtps).toHaveLength(5);
      expect(securityEvents).toHaveLength(1);
    } finally {
      await throttleHarness.app.close();
      await throttleHarness.prisma.$disconnect();
    }
  });

  it("verifies OTP codes, creates the user workspace, and stores session metadata", async () => {
    await harness.app.inject({
      method: "POST",
      url: "/v1/auth/email/request-code",
      payload: {
        email: "person@example.com"
      }
    });

    const verifyResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/email/verify-code",
      headers: {
        "user-agent": "vitest-agent/1",
        "x-country-code": "SG"
      },
      payload: {
        email: "person@example.com",
        code: harness.emailProvider.latestCodeFor("person@example.com"),
        device: {
          platform: "WINDOWS",
          installation_id: "install-1",
          device_name: "Work Laptop",
          app_version: "1.0.0"
        }
      }
    });

    expect(verifyResponse.statusCode).toBe(200);
    const payload = verifyResponse.json();
    expect(payload.access_token).toBeTruthy();
    expect(payload.refresh_token).toBeTruthy();
    expect(payload.organization_id).toBeTruthy();

    const user = await harness.prisma.user.findFirstOrThrow({
      where: {
        primaryEmail: "person@example.com",
        deletedAt: null
      }
    });
    const organization = await harness.prisma.organization.findFirstOrThrow({
      where: {
        ownerUserId: user.id
      }
    });
    const membership = await harness.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId: user.id
        }
      }
    });
    const session = await harness.prisma.session.findUniqueOrThrow({
      where: {
        id: payload.session.id
      }
    });
    const device = await harness.prisma.device.findFirstOrThrow({
      where: {
        userId: user.id
      }
    });

    expect(user.emailVerifiedAt).not.toBeNull();
    expect(organization.type).toBe("PERSONAL");
    expect(membership?.role).toBe("OWNER");
    expect(session.userAgent).toBe("vitest-agent/1");
    expect(session.lastIpCountryCode).toBe("SG");
    expect(session.lastIpHash).toBeTruthy();
    expect(session.lastUsedAt).toBeInstanceOf(Date);
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(device.installationId).toBe("install-1");
  });

  it("allows only one parallel OTP verification to consume a valid code", async () => {
    await harness.app.inject({
      method: "POST",
      url: "/v1/auth/email/request-code",
      payload: {
        email: "parallel-verify@example.com"
      }
    });

    const code = harness.emailProvider.latestCodeFor("parallel-verify@example.com");
    const responses = await Promise.all([
      harness.app.inject({
        method: "POST",
        url: "/v1/auth/email/verify-code",
        payload: {
          email: "parallel-verify@example.com",
          code
        }
      }),
      harness.app.inject({
        method: "POST",
        url: "/v1/auth/email/verify-code",
        payload: {
          email: "parallel-verify@example.com",
          code
        }
      })
    ]);

    const statusCodes = responses.map((response) => response.statusCode).sort((left, right) => left - right);
    const sessionCount = await harness.prisma.session.count();

    expect(statusCodes).toEqual([200, 401]);
    expect(sessionCount).toBe(1);
  });

  it("locks after repeated bad OTP attempts and rejects expired codes", async () => {
    await harness.app.inject({
      method: "POST",
      url: "/v1/auth/email/request-code",
      payload: {
        email: "locked@example.com"
      }
    });

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await harness.app.inject({
        method: "POST",
        url: "/v1/auth/email/verify-code",
        payload: {
          email: "locked@example.com",
          code: "000000"
        }
      });

      expect(response.statusCode).toBe(401);
    }

    const lockedResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/email/verify-code",
      payload: {
        email: "locked@example.com",
        code: "000000"
      }
    });

    expect(lockedResponse.statusCode).toBe(429);
    expect(await harness.prisma.securityEvent.count({
      where: {
        eventType: "otp_challenge_locked"
      }
    })).toBe(1);

    await resetDatabase(harness.prisma);
    harness.emailProvider.sentOtps.length = 0;

    await harness.app.inject({
      method: "POST",
      url: "/v1/auth/email/request-code",
      payload: {
        email: "expired@example.com"
      }
    });

    const challenge = await harness.prisma.emailChallenge.findFirstOrThrow({
      where: {
        email: "expired@example.com"
      }
    });

    await harness.prisma.emailChallenge.update({
      where: {
        id: challenge.id
      },
      data: {
        expiresAt: new Date(Date.now() - 60_000)
      }
    });

    const expiredResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/email/verify-code",
      payload: {
        email: "expired@example.com",
        code: harness.emailProvider.latestCodeFor("expired@example.com")
      }
    });

    expect(expiredResponse.statusCode).toBe(401);
    expect(expiredResponse.json().error.code).toBe("expired_otp");
  });

  it("rate limits request-code and verify-code per IP", async () => {
    const limitedHarness = await createTestHarness({
      requestCodeMaxPerIp: 4,
      verifyCodeMaxPerIp: 3
    });

    try {
      await resetDatabase(limitedHarness.prisma);
      limitedHarness.emailProvider.sentOtps.length = 0;
      await limitedHarness.authRateLimiter.reset();

      const requestStatuses: number[] = [];

      for (let index = 0; index < 5; index += 1) {
        const response = await limitedHarness.app.inject({
          method: "POST",
          url: "/v1/auth/email/request-code",
          payload: {
            email: `request-limit-${index}@example.com`
          }
        });

        requestStatuses.push(response.statusCode);
      }

      expect(requestStatuses).toEqual([202, 202, 202, 202, 429]);
      expect(limitedHarness.emailProvider.sentOtps).toHaveLength(4);
      expect(await limitedHarness.prisma.authRateLimitBucket.count({
        where: {
          scope: "auth_email_request"
        }
      })).toBe(1);
      expect(await limitedHarness.prisma.securityEvent.count({
        where: {
          eventType: "auth_rate_limit_hit"
        }
      })).toBe(1);
      expect(await limitedHarness.prisma.ipObservation.count({
        where: {
          source: "auth_email_request"
        }
      })).toBe(1);

      await resetDatabase(limitedHarness.prisma);
      limitedHarness.emailProvider.sentOtps.length = 0;
      await limitedHarness.authRateLimiter.reset();

      for (let index = 0; index < 4; index += 1) {
        await limitedHarness.app.inject({
          method: "POST",
          url: "/v1/auth/email/request-code",
          payload: {
            email: `verify-limit-${index}@example.com`
          }
        });
      }

      await limitedHarness.authRateLimiter.reset();

      const verifyStatuses: number[] = [];

      for (let index = 0; index < 4; index += 1) {
        const response = await limitedHarness.app.inject({
          method: "POST",
          url: "/v1/auth/email/verify-code",
          payload: {
            email: `verify-limit-${index}@example.com`,
            code: "000000"
          }
        });

        verifyStatuses.push(response.statusCode);
      }

      expect(verifyStatuses).toEqual([401, 401, 401, 429]);
      expect(await limitedHarness.prisma.authRateLimitBucket.count({
        where: {
          scope: "auth_email_verify"
        }
      })).toBe(1);
      expect(await limitedHarness.prisma.securityEvent.count({
        where: {
          eventType: "auth_rate_limit_hit"
        }
      })).toBe(1);
      expect(await limitedHarness.prisma.ipObservation.count({
        where: {
          source: "auth_email_verify"
        }
      })).toBe(1);
    } finally {
      await limitedHarness.app.close();
      await limitedHarness.prisma.$disconnect();
    }
  });

  it("keeps the durable per-IP request limiter active across app recreation", async () => {
    const firstHarness = await createTestHarness({
      requestCodeMaxPerIp: 2,
      verifyCodeMaxPerIp: 3
    });

    try {
      await resetDatabase(firstHarness.prisma);
      await firstHarness.authRateLimiter.reset();

      const first = await firstHarness.app.inject({
        method: "POST",
        url: "/v1/auth/email/request-code",
        payload: {
          email: "restart-1@example.com"
        }
      });
      const second = await firstHarness.app.inject({
        method: "POST",
        url: "/v1/auth/email/request-code",
        payload: {
          email: "restart-2@example.com"
        }
      });

      expect(first.statusCode).toBe(202);
      expect(second.statusCode).toBe(202);

      await firstHarness.app.close();
      await firstHarness.prisma.$disconnect();

      const secondHarness = await createTestHarness({
        requestCodeMaxPerIp: 2,
        verifyCodeMaxPerIp: 3
      });

      try {
        const limited = await secondHarness.app.inject({
          method: "POST",
          url: "/v1/auth/email/request-code",
          payload: {
            email: "restart-3@example.com"
          }
        });

        expect(limited.statusCode).toBe(429);
        expect(await secondHarness.prisma.authRateLimitBucket.count({
          where: {
            scope: "auth_email_request"
          }
        })).toBe(1);
      } finally {
        await secondHarness.app.close();
        await secondHarness.prisma.$disconnect();
      }
    } catch (error) {
      await firstHarness.app.close().catch(() => undefined);
      await firstHarness.prisma.$disconnect().catch(() => undefined);
      throw error;
    }
  });
});
