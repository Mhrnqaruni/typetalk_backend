import {
  BillingInterval,
  BillingProvider,
  EntitlementCode,
  EntitlementStatus,
  SubscriptionStatus,
  UsageEventStatus
} from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SecurityRepository } from "../../src/modules/security/repository";
import { SecurityService } from "../../src/modules/security/service";
import { createTestHarness } from "../helpers/app";
import { resetDatabase } from "../helpers/db";

describe("admin routes", () => {
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

  async function signInEmail(email: string) {
    await harness.app.inject({
      method: "POST",
      url: "/v1/auth/email/request-code",
      payload: {
        email
      }
    });

    const verifyResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/email/verify-code",
      payload: {
        email,
        code: harness.emailProvider.latestCodeFor(email)
      }
    });

    const payload = verifyResponse.json();
    const user = await harness.prisma.user.findFirstOrThrow({
      where: {
        primaryEmail: email
      }
    });

    expect(verifyResponse.statusCode).toBe(200);

    return {
      accessToken: payload.access_token as string,
      organizationId: payload.organization_id as string,
      userId: user.id
    };
  }

  it("allows an allowlisted admin to read curated user details and records an audit log", async () => {
    const admin = await signInEmail("admin@example.com");
    const target = await signInEmail("person@example.com");
    const securityService = new SecurityService(new SecurityRepository(harness.prisma));

    await securityService.observeIp({
      userId: target.userId,
      organizationId: target.organizationId,
      ipAddress: "203.0.113.99",
      countryCode: "US",
      source: "admin_test"
    });

    const response = await harness.app.inject({
      method: "GET",
      url: `/v1/admin/users/${target.userId}`,
      headers: {
        authorization: `Bearer ${admin.accessToken}`
      }
    });

    expect(response.statusCode).toBe(200);

    const payload = response.json();
    const serialized = JSON.stringify(payload);

    expect(payload.user.id).toBe(target.userId);
    expect(payload.sessions[0]).not.toHaveProperty("refresh_token_hash");
    expect(payload.ip_observations[0]).not.toHaveProperty("raw_ip_ciphertext");
    expect(serialized).not.toContain("refresh_token_hash");
    expect(serialized).not.toContain("raw_ip_ciphertext");
    expect(serialized).not.toContain("payload_json");

    const auditLogs = await harness.prisma.auditLog.findMany({
      where: {
        action: "admin.user.read"
      }
    });

    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]?.actorUserId).toBe(admin.userId);
    expect(auditLogs[0]?.targetUserId).toBe(target.userId);
  });

  it("denies non-admin access and records a security event", async () => {
    const user = await signInEmail("non-admin@example.com");

    const response = await harness.app.inject({
      method: "GET",
      url: "/v1/admin/usage",
      headers: {
        authorization: `Bearer ${user.accessToken}`
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("admin_forbidden");

    const securityEvents = await harness.prisma.securityEvent.findMany({
      where: {
        eventType: "admin_access_denied"
      }
    });

    expect(securityEvents).toHaveLength(1);
    expect(securityEvents[0]?.userId).toBe(user.userId);
  });

  it("pages admin subscription and usage views and audits successful reads", async () => {
    const admin = await signInEmail("admin@example.com");
    const ownerOne = await signInEmail("owner-one@example.com");
    const ownerTwo = await signInEmail("owner-two@example.com");
    const plan = await harness.prisma.plan.findUniqueOrThrow({
      where: {
        code: "pro_monthly"
      }
    });

    const providerCustomerOne = await harness.prisma.providerCustomer.create({
      data: {
        organizationId: ownerOne.organizationId,
        provider: BillingProvider.PADDLE,
        externalCustomerId: "ctm_admin_1"
      }
    });
    const providerCustomerTwo = await harness.prisma.providerCustomer.create({
      data: {
        organizationId: ownerTwo.organizationId,
        provider: BillingProvider.PADDLE,
        externalCustomerId: "ctm_admin_2"
      }
    });

    await harness.prisma.subscription.createMany({
      data: [
        {
          id: "sub_admin_1",
          organizationId: ownerOne.organizationId,
          planId: plan.id,
          providerCustomerId: providerCustomerOne.id,
          provider: BillingProvider.PADDLE,
          externalSubscriptionId: "sub_ext_admin_1",
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: new Date("2026-03-01T00:00:00.000Z"),
          currentPeriodEnd: new Date("2026-04-01T00:00:00.000Z")
        },
        {
          id: "sub_admin_2",
          organizationId: ownerTwo.organizationId,
          planId: plan.id,
          providerCustomerId: providerCustomerTwo.id,
          provider: BillingProvider.PADDLE,
          externalSubscriptionId: "sub_ext_admin_2",
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: new Date("2026-03-02T00:00:00.000Z"),
          currentPeriodEnd: new Date("2026-04-02T00:00:00.000Z")
        }
      ]
    });

    await harness.prisma.entitlement.createMany({
      data: [
        {
          organizationId: ownerOne.organizationId,
          userId: ownerOne.userId,
          code: EntitlementCode.PRO_ACTIVE,
          status: EntitlementStatus.ACTIVE,
          sourceProvider: BillingProvider.PADDLE
        },
        {
          organizationId: ownerTwo.organizationId,
          userId: ownerTwo.userId,
          code: EntitlementCode.PRO_ACTIVE,
          status: EntitlementStatus.ACTIVE,
          sourceProvider: BillingProvider.PADDLE
        }
      ]
    });

    await harness.prisma.usageEvent.createMany({
      data: [
        {
          id: "usage_admin_1",
          organizationId: ownerOne.organizationId,
          userId: ownerOne.userId,
          featureCode: "dictation",
          provider: "openai",
          wordCount: 120,
          audioSeconds: 45,
          requestCount: 1,
          status: UsageEventStatus.FINALIZED,
          occurredAt: new Date("2026-03-03T00:00:00.000Z")
        },
        {
          id: "usage_admin_2",
          organizationId: ownerTwo.organizationId,
          userId: ownerTwo.userId,
          featureCode: "dictation",
          provider: "openai",
          wordCount: 220,
          audioSeconds: 65,
          requestCount: 1,
          status: UsageEventStatus.FINALIZED,
          occurredAt: new Date("2026-03-04T00:00:00.000Z")
        }
      ]
    });

    const firstSubscriptionsPage = await harness.app.inject({
      method: "GET",
      url: "/v1/admin/subscriptions?limit=1",
      headers: {
        authorization: `Bearer ${admin.accessToken}`
      }
    });

    expect(firstSubscriptionsPage.statusCode).toBe(200);
    expect(firstSubscriptionsPage.json().items).toHaveLength(1);
    expect(firstSubscriptionsPage.json().next_cursor).toBeTruthy();

    const secondSubscriptionsPage = await harness.app.inject({
      method: "GET",
      url: `/v1/admin/subscriptions?limit=1&cursor=${encodeURIComponent(firstSubscriptionsPage.json().next_cursor)}`,
      headers: {
        authorization: `Bearer ${admin.accessToken}`
      }
    });

    expect(secondSubscriptionsPage.statusCode).toBe(200);
    expect(secondSubscriptionsPage.json().items).toHaveLength(1);
    expect(secondSubscriptionsPage.json().next_cursor).toBeNull();

    const firstUsagePage = await harness.app.inject({
      method: "GET",
      url: "/v1/admin/usage?limit=1",
      headers: {
        authorization: `Bearer ${admin.accessToken}`
      }
    });

    expect(firstUsagePage.statusCode).toBe(200);
    expect(firstUsagePage.json().items).toHaveLength(1);
    expect(firstUsagePage.json().next_cursor).toBeTruthy();

    const secondUsagePage = await harness.app.inject({
      method: "GET",
      url: `/v1/admin/usage?limit=1&cursor=${encodeURIComponent(firstUsagePage.json().next_cursor)}`,
      headers: {
        authorization: `Bearer ${admin.accessToken}`
      }
    });

    expect(secondUsagePage.statusCode).toBe(200);
    expect(secondUsagePage.json().items).toHaveLength(1);
    expect(secondUsagePage.json().next_cursor).toBeNull();

    const auditLogs = await harness.prisma.auditLog.findMany({
      orderBy: {
        createdAt: "asc"
      }
    });

    expect(auditLogs.map((entry) => entry.action)).toEqual([
      "admin.subscriptions.read",
      "admin.subscriptions.read",
      "admin.usage.read",
      "admin.usage.read"
    ]);
  });
});
