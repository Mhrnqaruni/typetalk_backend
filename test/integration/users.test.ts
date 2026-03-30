import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestHarness } from "../helpers/app";
import { resetDatabase } from "../helpers/db";

describe("user and session routes", () => {
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

  async function signIn(email: string, installationId: string) {
    await harness.app.inject({
      method: "POST",
      url: "/v1/auth/email/request-code",
      payload: {
        email
      }
    });

    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/email/verify-code",
      headers: {
        "user-agent": `agent-${installationId}`,
        "x-country-code": "SG"
      },
      payload: {
        email,
        code: harness.emailProvider.latestCodeFor(email),
        device: {
          platform: "WINDOWS",
          installation_id: installationId
        }
      }
    });

    return response.json();
  }

  it("returns profile data, paginates sessions, and revokes owned sessions safely", async () => {
    const primarySession = await signIn("user@example.com", "device-1");
    await signIn("user@example.com", "device-2");

    const meResponse = await harness.app.inject({
      method: "GET",
      url: "/v1/me",
      headers: {
        authorization: `Bearer ${primarySession.access_token}`
      }
    });

    expect(meResponse.statusCode).toBe(200);
    expect(meResponse.json().primary_email).toBe("user@example.com");

    const patchResponse = await harness.app.inject({
      method: "PATCH",
      url: "/v1/me",
      headers: {
        authorization: `Bearer ${primarySession.access_token}`
      },
      payload: {
        display_name: "Updated Name"
      }
    });

    expect(patchResponse.statusCode).toBe(200);
    expect(patchResponse.json().display_name).toBe("Updated Name");

    const sessionsResponse = await harness.app.inject({
      method: "GET",
      url: "/v1/sessions?limit=1",
      headers: {
        authorization: `Bearer ${primarySession.access_token}`
      }
    });

    expect(sessionsResponse.statusCode).toBe(200);
    const sessionsPayload = sessionsResponse.json();
    expect(sessionsPayload.items).toHaveLength(1);
    expect(sessionsPayload.next_cursor).toBeTruthy();
    expect("refresh_token_hash" in sessionsPayload.items[0]).toBe(false);
    expect("last_ip_hash" in sessionsPayload.items[0]).toBe(false);

    const secondPageResponse = await harness.app.inject({
      method: "GET",
      url: `/v1/sessions?limit=1&cursor=${encodeURIComponent(sessionsPayload.next_cursor)}`,
      headers: {
        authorization: `Bearer ${primarySession.access_token}`
      }
    });

    expect(secondPageResponse.statusCode).toBe(200);
    expect(secondPageResponse.json().items).toHaveLength(1);

    const allSessions = await harness.prisma.session.findMany({
      orderBy: {
        createdAt: "asc"
      }
    });
    const otherSession = allSessions.find((session) => session.id !== primarySession.session.id);

    expect(otherSession).toBeTruthy();

    const revokeResponse = await harness.app.inject({
      method: "DELETE",
      url: `/v1/sessions/${otherSession?.id}`,
      headers: {
        authorization: `Bearer ${primarySession.access_token}`
      }
    });

    expect(revokeResponse.statusCode).toBe(204);

    const revokedSession = await harness.prisma.session.findUniqueOrThrow({
      where: {
        id: otherSession?.id
      }
    });

    expect(revokedSession.revokedAt).not.toBeNull();

    const activeSessionsResponse = await harness.app.inject({
      method: "GET",
      url: "/v1/sessions?limit=10",
      headers: {
        authorization: `Bearer ${primarySession.access_token}`
      }
    });

    expect(activeSessionsResponse.statusCode).toBe(200);
    expect(activeSessionsResponse.json().items).toHaveLength(1);
    expect(activeSessionsResponse.json().items[0]?.id).toBe(primarySession.session.id);
    expect(activeSessionsResponse.json().items[0]?.revoked_at).toBeNull();
  });

  it("soft deletes the user, allows clean re-signup, and revokes old sessions", async () => {
    const loginPayload = await signIn("delete@example.com", "delete-device");

    const deleteResponse = await harness.app.inject({
      method: "DELETE",
      url: "/v1/me",
      headers: {
        authorization: `Bearer ${loginPayload.access_token}`
      }
    });

    expect(deleteResponse.statusCode).toBe(204);

    const deletedUsers = await harness.prisma.user.findMany({
      where: {
        primaryEmail: "delete@example.com"
      },
      orderBy: {
        createdAt: "asc"
      }
    });
    const user = deletedUsers[0];
    const sessions = await harness.prisma.session.findMany({
      where: {
        userId: user?.id
      }
    });

    expect(user.deletedAt).not.toBeNull();
    expect(user.status).toBe("DELETED");
    expect(sessions.every((session) => session.revokedAt !== null)).toBe(true);

    const meResponse = await harness.app.inject({
      method: "GET",
      url: "/v1/me",
      headers: {
        authorization: `Bearer ${loginPayload.access_token}`
      }
    });

    expect(meResponse.statusCode).toBe(401);

    const refreshResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: {
        refresh_token: loginPayload.refresh_token
      }
    });

    expect(refreshResponse.statusCode).toBe(401);

    await harness.app.inject({
      method: "POST",
      url: "/v1/auth/email/request-code",
      payload: {
        email: "delete@example.com"
      }
    });

    const recreatedResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/email/verify-code",
      headers: {
        "user-agent": "agent-recreated",
        "x-country-code": "US"
      },
      payload: {
        email: "delete@example.com",
        code: harness.emailProvider.latestCodeFor("delete@example.com"),
        device: {
          platform: "WINDOWS",
          installation_id: "delete-device-recreated"
        }
      }
    });

    expect(recreatedResponse.statusCode).toBe(200);

    const allUsers = await harness.prisma.user.findMany({
      where: {
        primaryEmail: "delete@example.com"
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    expect(allUsers).toHaveLength(2);
    expect(allUsers[0]?.deletedAt).not.toBeNull();
    expect(allUsers[1]?.deletedAt).toBeNull();
    expect(allUsers[1]?.id).not.toBe(allUsers[0]?.id);
  });
});
