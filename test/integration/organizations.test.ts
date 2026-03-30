import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestHarness } from "../helpers/app";
import { resetDatabase } from "../helpers/db";

describe("organization routes", () => {
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

  async function signIn(email: string) {
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
      payload: {
        email,
        code: harness.emailProvider.latestCodeFor(email)
      }
    });

    return response.json();
  }

  it("returns the current organization and paginates members", async () => {
    const primaryLogin = await signIn("org-owner@example.com");
    const secondaryLogin = await signIn("org-member@example.com");

    const ownerUser = await harness.prisma.user.findFirstOrThrow({
      where: {
        primaryEmail: "org-owner@example.com",
        deletedAt: null
      }
    });
    const memberUser = await harness.prisma.user.findFirstOrThrow({
      where: {
        primaryEmail: "org-member@example.com",
        deletedAt: null
      }
    });
    const organization = await harness.prisma.organization.findFirstOrThrow({
      where: {
        ownerUserId: ownerUser.id
      }
    });

    await harness.prisma.organizationMember.create({
      data: {
        organizationId: organization.id,
        userId: memberUser.id,
        role: "MEMBER"
      }
    });

    const currentResponse = await harness.app.inject({
      method: "GET",
      url: "/v1/organizations/current",
      headers: {
        authorization: `Bearer ${primaryLogin.access_token}`
      }
    });

    expect(currentResponse.statusCode).toBe(200);
    expect(currentResponse.json().id).toBe(organization.id);

    const membersPageOne = await harness.app.inject({
      method: "GET",
      url: "/v1/organizations/members?limit=1",
      headers: {
        authorization: `Bearer ${primaryLogin.access_token}`
      }
    });

    expect(membersPageOne.statusCode).toBe(200);
    const pageOnePayload = membersPageOne.json();
    expect(pageOnePayload.items).toHaveLength(1);
    expect(pageOnePayload.next_cursor).toBeTruthy();

    const membersPageTwo = await harness.app.inject({
      method: "GET",
      url: `/v1/organizations/members?limit=1&cursor=${encodeURIComponent(pageOnePayload.next_cursor)}`,
      headers: {
        authorization: `Bearer ${primaryLogin.access_token}`
      }
    });

    expect(membersPageTwo.statusCode).toBe(200);
    expect(membersPageTwo.json().items).toHaveLength(1);

    const secondaryCurrentResponse = await harness.app.inject({
      method: "GET",
      url: "/v1/organizations/current",
      headers: {
        authorization: `Bearer ${secondaryLogin.access_token}`
      }
    });

    expect(secondaryCurrentResponse.statusCode).toBe(200);
    const secondaryOrganization = await harness.prisma.organization.findFirstOrThrow({
      where: {
        ownerUserId: memberUser.id
      }
    });

    await harness.prisma.organizationMember.update({
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId: memberUser.id
        }
      },
      data: {
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000)
      }
    });

    const deterministicCurrentResponse = await harness.app.inject({
      method: "GET",
      url: "/v1/organizations/current",
      headers: {
        authorization: `Bearer ${secondaryLogin.access_token}`
      }
    });

    expect(deterministicCurrentResponse.statusCode).toBe(200);
    expect(deterministicCurrentResponse.json().id).toBe(secondaryOrganization.id);
  });
});
