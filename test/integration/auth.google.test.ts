import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestHarness } from "../helpers/app";
import { resetDatabase } from "../helpers/db";

describe("google auth flows", () => {
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

  it("creates a new user and google identity on first google sign-in", async () => {
    harness.googleVerifier.setProfile("google-new-token", {
      sub: "google-sub-1",
      email: "google@example.com",
      emailVerified: true,
      name: "Google User",
      picture: "https://example.com/avatar.png"
    });

    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/google",
      payload: {
        id_token: "google-new-token"
      }
    });

    expect(response.statusCode).toBe(200);

    const identity = await harness.prisma.authIdentity.findUnique({
      where: {
        provider_providerUserId: {
          provider: "GOOGLE",
          providerUserId: "google-sub-1"
        }
      }
    });

    expect(identity?.providerEmail).toBe("google@example.com");
  });

  it("rejects silent google sign-in when the email already exists without a google identity", async () => {
    await harness.app.inject({
      method: "POST",
      url: "/v1/auth/email/request-code",
      payload: {
        email: "merge@example.com"
      }
    });
    await harness.app.inject({
      method: "POST",
      url: "/v1/auth/email/verify-code",
      payload: {
        email: "merge@example.com",
        code: harness.emailProvider.latestCodeFor("merge@example.com")
      }
    });

    harness.googleVerifier.setProfile("google-collision-token", {
      sub: "google-sub-2",
      email: "merge@example.com",
      emailVerified: true,
      name: "Merge Risk",
      picture: null
    });

    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/google",
      payload: {
        id_token: "google-collision-token"
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("google_link_required");
  });

  it("allows explicit authenticated linking when recent re-auth is fresh and rejects stale sessions", async () => {
    await harness.app.inject({
      method: "POST",
      url: "/v1/auth/email/request-code",
      payload: {
        email: "link@example.com"
      }
    });
    const loginResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/email/verify-code",
      payload: {
        email: "link@example.com",
        code: harness.emailProvider.latestCodeFor("link@example.com")
      }
    });
    const loginPayload = loginResponse.json();

    harness.googleVerifier.setProfile("google-link-token", {
      sub: "google-sub-3",
      email: "link@example.com",
      emailVerified: true,
      name: "Linked User",
      picture: null
    });

    const freshLinkResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/link/google",
      headers: {
        authorization: `Bearer ${loginPayload.access_token}`
      },
      payload: {
        id_token: "google-link-token"
      }
    });

    expect(freshLinkResponse.statusCode).toBe(200);

    await harness.prisma.session.update({
      where: {
        id: loginPayload.session.id
      },
      data: {
        reauthenticatedAt: new Date(Date.now() - 11 * 60_000)
      }
    });

    harness.googleVerifier.setProfile("google-link-stale-token", {
      sub: "google-sub-4",
      email: "link@example.com",
      emailVerified: true,
      name: "Stale Link",
      picture: null
    });

    const staleLinkResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/link/google",
      headers: {
        authorization: `Bearer ${loginPayload.access_token}`
      },
      payload: {
        id_token: "google-link-stale-token"
      }
    });

    expect(staleLinkResponse.statusCode).toBe(403);
    expect(staleLinkResponse.json().error.code).toBe("reauth_required");
  });

  it("enforces the active-device cap under concurrent sign-ins", async () => {
    harness.googleVerifier.setProfile("google-device-token", {
      sub: "google-device-sub",
      email: "device-cap@example.com",
      emailVerified: true,
      name: "Device Cap User",
      picture: null
    });

    const seedLogin = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/google",
      payload: {
        id_token: "google-device-token"
      }
    });

    expect(seedLogin.statusCode).toBe(200);

    const user = await harness.prisma.user.findFirstOrThrow({
      where: {
        primaryEmail: "device-cap@example.com",
        deletedAt: null
      }
    });

    const seededDevices = Array.from({ length: 9 }, (_, index) => ({
      userId: user.id,
      platform: "WINDOWS" as const,
      installationId: `seed-device-${index}`,
      lastSeenAt: new Date()
    }));

    await harness.prisma.device.createMany({
      data: seededDevices
    });

    const responses = await Promise.all([
      harness.app.inject({
        method: "POST",
        url: "/v1/auth/google",
        payload: {
          id_token: "google-device-token",
          device: {
            platform: "WINDOWS",
            installation_id: "parallel-device-a"
          }
        }
      }),
      harness.app.inject({
        method: "POST",
        url: "/v1/auth/google",
        payload: {
          id_token: "google-device-token",
          device: {
            platform: "WINDOWS",
            installation_id: "parallel-device-b"
          }
        }
      })
    ]);

    const statusCodes = responses.map((response) => response.statusCode).sort((left, right) => left - right);
    const deviceCount = await harness.prisma.device.count({
      where: {
        userId: user.id
      }
    });

    expect(statusCodes).toEqual([200, 400]);
    expect(deviceCount).toBe(10);
  });
});
