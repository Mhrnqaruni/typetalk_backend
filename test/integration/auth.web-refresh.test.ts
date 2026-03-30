import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getConfig } from "../../src/config/env";
import { createTestHarness } from "../helpers/app";
import { resetDatabase } from "../helpers/db";

const allowedOrigin = "http://localhost:3000";
const blockedOrigin = "https://preview.typetalk.vercel.app";
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

async function signInWeb(harness: Awaited<ReturnType<typeof createTestHarness>>) {
  await harness.app.inject({
    method: "POST",
    url: "/v1/web-auth/email/request-code",
    payload: {
      email: "refresh-web@example.com"
    }
  });

  const verifyResponse = await harness.app.inject({
    method: "POST",
    url: "/v1/web-auth/email/verify-code",
    headers: {
      origin: allowedOrigin
    },
    payload: {
      email: "refresh-web@example.com",
      code: harness.emailProvider.latestCodeFor("refresh-web@example.com")
    }
  });

  return {
    payload: verifyResponse.json(),
    cookie: getCookieValue(verifyResponse, getConfig().webAuthRefreshCookieName)
  };
}

describe("web refresh auth flows", () => {
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

  it("rotates the refresh cookie on web refresh and clears it on logout", async () => {
    const login = await signInWeb(harness);
    const cookieName = getConfig().webAuthRefreshCookieName;

    const refreshResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/web-auth/refresh",
      headers: {
        origin: allowedOrigin,
        cookie: `${cookieName}=${login.cookie}`,
        "user-agent": "web-refresh-agent"
      }
    });

    expect(refreshResponse.statusCode).toBe(200);
    expect(refreshResponse.json().refresh_token).toBeUndefined();
    expect(getCookieValue(refreshResponse, cookieName)).toBeTruthy();
    expect(getCookieValue(refreshResponse, cookieName)).not.toBe(login.cookie);

    const logoutResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/web-auth/logout",
      headers: {
        origin: allowedOrigin,
        cookie: `${cookieName}=${getCookieValue(refreshResponse, cookieName)}`
      }
    });

    expect(logoutResponse.statusCode).toBe(204);
    const clearedCookie = getSetCookieHeaders(logoutResponse).find((value) => value.startsWith(`${cookieName}=`));
    expect(clearedCookie).toContain("Expires=");

    const session = await harness.prisma.session.findUniqueOrThrow({
      where: {
        id: login.payload.session.id
      }
    });

    expect(session.revokedAt).not.toBeNull();
  });

  it("rejects blocked-origin, missing-origin, and missing-cookie refresh requests", async () => {
    const login = await signInWeb(harness);
    const cookieName = getConfig().webAuthRefreshCookieName;

    const blockedOriginResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/web-auth/refresh",
      headers: {
        origin: blockedOrigin,
        cookie: `${cookieName}=${login.cookie}`
      }
    });

    expect(blockedOriginResponse.statusCode).toBe(403);
    expect(blockedOriginResponse.json().error.code).toBe("origin_not_allowed");

    const missingOriginResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/web-auth/refresh",
      headers: {
        cookie: `${cookieName}=${login.cookie}`
      }
    });

    expect(missingOriginResponse.statusCode).toBe(403);
    expect(missingOriginResponse.json().error.code).toBe("missing_browser_origin");

    const missingCookieResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/web-auth/refresh",
      headers: {
        origin: allowedOrigin
      }
    });

    expect(missingCookieResponse.statusCode).toBe(401);
    expect(missingCookieResponse.json().error.code).toBe("missing_refresh_cookie");
  });
});
