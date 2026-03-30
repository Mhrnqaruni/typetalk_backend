import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestHarness } from "../helpers/app";
import { resetDatabase } from "../helpers/db";

describe("refresh token flows", () => {
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

  async function signIn() {
    await harness.app.inject({
      method: "POST",
      url: "/v1/auth/email/request-code",
      payload: {
        email: "refresh@example.com"
      }
    });

    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/email/verify-code",
      headers: {
        "user-agent": "initial-agent",
        "x-country-code": "SG"
      },
      payload: {
        email: "refresh@example.com",
        code: harness.emailProvider.latestCodeFor("refresh@example.com"),
        device: {
          platform: "WINDOWS",
          installation_id: "refresh-device"
        }
      }
    });

    return response.json();
  }

  it("rotates refresh tokens and updates session metadata on success", async () => {
    const loginPayload = await signIn();

    const refreshResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      headers: {
        "user-agent": "refreshed-agent",
        "x-country-code": "US"
      },
      payload: {
        refresh_token: loginPayload.refresh_token
      }
    });

    expect(refreshResponse.statusCode).toBe(200);
    const refreshPayload = refreshResponse.json();
    expect(refreshPayload.refresh_token).not.toBe(loginPayload.refresh_token);

    const session = await harness.prisma.session.findUniqueOrThrow({
      where: {
        id: loginPayload.session.id
      }
    });

    expect(session.userAgent).toBe("refreshed-agent");
    expect(session.lastIpCountryCode).toBe("US");
    expect(session.lastUsedAt.getTime()).toBeGreaterThanOrEqual(session.createdAt.getTime());
  });

  it("revokes the session and records a security event on rotated-token reuse", async () => {
    const loginPayload = await signIn();

    const firstRefresh = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: {
        refresh_token: loginPayload.refresh_token
      }
    });

    expect(firstRefresh.statusCode).toBe(200);

    const replayResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: {
        refresh_token: loginPayload.refresh_token
      }
    });

    expect(replayResponse.statusCode).toBe(401);
    expect(replayResponse.json().error.code).toBe("reauth_required");

    const securityEvents = await harness.prisma.securityEvent.findMany();
    const session = await harness.prisma.session.findUniqueOrThrow({
      where: {
        id: loginPayload.session.id
      }
    });

    expect(securityEvents).toHaveLength(1);
    expect(securityEvents[0]?.eventType).toBe("refresh_token_reuse_detected");
    expect(session.revokedAt).not.toBeNull();

    const rotatedPayload = firstRefresh.json();
    const revokedRefreshResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: {
        refresh_token: rotatedPayload.refresh_token
      }
    });

    expect(revokedRefreshResponse.statusCode).toBe(401);
  });

  it("treats a parallel refresh race as a conflict without revoking the winning session", async () => {
    const loginPayload = await signIn();

    const responses = await Promise.all([
      harness.app.inject({
        method: "POST",
        url: "/v1/auth/refresh",
        headers: {
          "user-agent": "parallel-a"
        },
        payload: {
          refresh_token: loginPayload.refresh_token
        }
      }),
      harness.app.inject({
        method: "POST",
        url: "/v1/auth/refresh",
        headers: {
          "user-agent": "parallel-b"
        },
        payload: {
          refresh_token: loginPayload.refresh_token
        }
      })
    ]);

    const statusCodes = responses.map((response) => response.statusCode).sort((left, right) => left - right);
    const winner = responses.find((response) => response.statusCode === 200);

    expect(statusCodes).toEqual([200, 409]);
    expect(winner).toBeTruthy();
    expect(await harness.prisma.securityEvent.count()).toBe(0);

    const followUpResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: {
        refresh_token: winner?.json().refresh_token
      }
    });

    expect(followUpResponse.statusCode).toBe(200);

    const session = await harness.prisma.session.findUniqueOrThrow({
      where: {
        id: loginPayload.session.id
      }
    });

    expect(session.revokedAt).toBeNull();
  });

  it("rejects random invalid and expired refresh tokens without false-positive security events", async () => {
    const loginPayload = await signIn();

    const invalidResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: {
        refresh_token: "missing-session.invalid-secret"
      }
    });

    expect(invalidResponse.statusCode).toBe(401);
    expect(await harness.prisma.securityEvent.count()).toBe(0);

    await harness.prisma.session.update({
      where: {
        id: loginPayload.session.id
      },
      data: {
        expiresAt: new Date(Date.now() - 60_000)
      }
    });

    const expiredResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: {
        refresh_token: loginPayload.refresh_token
      }
    });

    expect(expiredResponse.statusCode).toBe(401);
    expect(expiredResponse.json().error.code).toBe("expired_refresh_token");
    expect(await harness.prisma.securityEvent.count()).toBe(0);
  });
});
