import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getConfig } from "../../src/config/env";
import { createTestHarness } from "../helpers/app";
import { resetDatabase } from "../helpers/db";

const allowedOrigin = "http://localhost:3000";
type InjectResponse = Awaited<ReturnType<Awaited<ReturnType<typeof createTestHarness>>["app"]["inject"]>>;

function getSetCookieHeaders(
  response: InjectResponse
): string[] {
  const header = response.headers["set-cookie"];

  if (Array.isArray(header)) {
    return header;
  }

  return typeof header === "string" ? [header] : [];
}

function getCookieValue(
  response: InjectResponse,
  cookieName: string
): string | null {
  const header = getSetCookieHeaders(response).find((value) => value.startsWith(`${cookieName}=`));

  if (!header) {
    return null;
  }

  return header.slice(cookieName.length + 1).split(";")[0] ?? null;
}

describe("web email auth flows", () => {
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

  it("sets a secure refresh cookie and omits refresh_token from web verify responses", async () => {
    const requestResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/web-auth/email/request-code",
      payload: {
        email: "browser@example.com"
      }
    });

    expect(requestResponse.statusCode).toBe(202);
    expect(requestResponse.headers["x-typetalk-debug-otp-code"]).toBe(
      harness.emailProvider.latestCodeFor("browser@example.com")
    );

    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/web-auth/email/verify-code",
      headers: {
        origin: allowedOrigin,
        "user-agent": "browser-agent/1"
      },
      payload: {
        email: "browser@example.com",
        code: harness.emailProvider.latestCodeFor("browser@example.com")
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(allowedOrigin);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");

    const payload = response.json();
    expect(payload.access_token).toBeTruthy();
    expect(payload.refresh_token).toBeUndefined();

    const cookieName = getConfig().webAuthRefreshCookieName;
    const cookieHeader = getSetCookieHeaders(response).find((value) => value.startsWith(`${cookieName}=`));

    expect(cookieHeader).toContain("HttpOnly");
    expect(cookieHeader).toContain("Secure");
    expect(cookieHeader).toContain("SameSite=Lax");
    expect(cookieHeader).toContain("Path=/");
    expect(getCookieValue(response, cookieName)).toBeTruthy();
  });

  it("reuses the durable per-email issuance throttle and per-ip limiter on web request-code", async () => {
    const throttleHarness = await createTestHarness({
      requestCodeMaxPerIp: 20,
      verifyCodeMaxPerIp: 10
    });

    try {
      await resetDatabase(throttleHarness.prisma);
      await throttleHarness.authRateLimiter.reset();

      const headerResponse = await throttleHarness.app.inject({
        method: "POST",
        url: "/v1/web-auth/email/request-code",
        payload: {
          email: "fresh-header@example.com"
        }
      });

      expect(headerResponse.headers["x-typetalk-debug-otp-code"]).toBe(
        throttleHarness.emailProvider.latestCodeFor("fresh-header@example.com")
      );

      const statuses: number[] = [];

      for (let index = 0; index < 6; index += 1) {
        const response = await throttleHarness.app.inject({
          method: "POST",
          url: "/v1/web-auth/email/request-code",
          payload: {
            email: "throttle@example.com"
          }
        });

        statuses.push(response.statusCode);
      }

      expect(statuses).toEqual([202, 202, 202, 202, 202, 429]);
      expect(await throttleHarness.prisma.securityEvent.count({
        where: {
          eventType: "otp_request_email_throttled"
        }
      })).toBe(1);

      await resetDatabase(throttleHarness.prisma);
      await throttleHarness.authRateLimiter.reset();

      const ipStatuses: number[] = [];

      for (let index = 0; index < 5; index += 1) {
        const response = await throttleHarness.app.inject({
          method: "POST",
          url: "/v1/web-auth/email/request-code",
          payload: {
            email: `web-limit-${index}@example.com`
          }
        });

        ipStatuses.push(response.statusCode);
      }

      expect(ipStatuses).toEqual([202, 202, 202, 202, 202]);
    } finally {
      await throttleHarness.app.close();
      await throttleHarness.prisma.$disconnect();
    }

    const limitedHarness = await createTestHarness({
      requestCodeMaxPerIp: 4,
      verifyCodeMaxPerIp: 10
    });

    try {
      await resetDatabase(limitedHarness.prisma);
      await limitedHarness.authRateLimiter.reset();

      const statuses: number[] = [];

      for (let index = 0; index < 5; index += 1) {
        const response = await limitedHarness.app.inject({
          method: "POST",
          url: "/v1/web-auth/email/request-code",
          payload: {
            email: `ip-limit-${index}@example.com`
          }
        });

        statuses.push(response.statusCode);
      }

      expect(statuses).toEqual([202, 202, 202, 202, 429]);
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
    } finally {
      await limitedHarness.app.close();
      await limitedHarness.prisma.$disconnect();
    }
  }, 20_000);

  it("rejects missing-origin web verify and records otp lockout on repeated bad codes", async () => {
    await harness.app.inject({
      method: "POST",
      url: "/v1/web-auth/email/request-code",
      payload: {
        email: "missing-origin@example.com"
      }
    });

    const missingOriginResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/web-auth/email/verify-code",
      payload: {
        email: "missing-origin@example.com",
        code: harness.emailProvider.latestCodeFor("missing-origin@example.com")
      }
    });

    expect(missingOriginResponse.statusCode).toBe(403);
    expect(missingOriginResponse.json().error.code).toBe("missing_browser_origin");

    await resetDatabase(harness.prisma);
    harness.emailProvider.sentOtps.length = 0;
    await harness.authRateLimiter.reset();

    await harness.app.inject({
      method: "POST",
      url: "/v1/web-auth/email/request-code",
      payload: {
        email: "locked-web@example.com"
      }
    });

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await harness.app.inject({
        method: "POST",
        url: "/v1/web-auth/email/verify-code",
        headers: {
          origin: allowedOrigin
        },
        payload: {
          email: "locked-web@example.com",
          code: "000000"
        }
      });

      expect(response.statusCode).toBe(401);
    }

    const lockedResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/web-auth/email/verify-code",
      headers: {
        origin: allowedOrigin
      },
      payload: {
        email: "locked-web@example.com",
        code: "000000"
      }
    });

    expect(lockedResponse.statusCode).toBe(429);
    expect(await harness.prisma.securityEvent.count({
      where: {
        eventType: "otp_challenge_locked"
      }
    })).toBe(1);
  }, 20_000);
});
