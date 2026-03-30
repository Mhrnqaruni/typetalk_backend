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

describe("web google auth flows", () => {
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

  it("uses the web google audience, sets the refresh cookie, and omits refresh_token", async () => {
    harness.googleVerifier.setProfile("web-google-token", {
      sub: "web-google-sub",
      email: "web-google@example.com",
      emailVerified: true,
      name: "Web Google",
      picture: null
    }, "web");

    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/web-auth/google",
      headers: {
        origin: allowedOrigin
      },
      payload: {
        id_token: "web-google-token"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().refresh_token).toBeUndefined();
    expect(getSetCookieHeaders(response).find((value) => value.startsWith(`${getConfig().webAuthRefreshCookieName}=`))).toBeTruthy();
  });

  it("keeps the explicit link-required conflict for email-first users on web google sign-in", async () => {
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

    harness.googleVerifier.setProfile("web-google-conflict", {
      sub: "web-google-conflict-sub",
      email: "merge@example.com",
      emailVerified: true,
      name: "Merge Risk",
      picture: null
    }, "web");

    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/web-auth/google",
      headers: {
        origin: allowedOrigin
      },
      payload: {
        id_token: "web-google-conflict"
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("google_link_required");
  });
});
