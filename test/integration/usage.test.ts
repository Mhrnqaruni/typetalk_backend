import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { seedPlans } from "../../prisma/seed";
import { createTestHarness } from "../helpers/app";
import { resetDatabase } from "../helpers/db";

describe("usage routes", () => {
  let harness: Awaited<ReturnType<typeof createTestHarness>>;

  beforeAll(async () => {
    harness = await createTestHarness();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
    await seedPlans(harness.prisma);
    harness.emailProvider.sentOtps.length = 0;
    harness.authRateLimiter.reset();
    harness.stripeProvider.createdCustomers.length = 0;
    harness.stripeProvider.checkoutSessions.length = 0;
    harness.stripeProvider.portalSessions.length = 0;
    harness.stripeProvider.invoicePages.clear();
    harness.stripeProvider.webhookEvents.clear();
    harness.googlePlayProvider.subscriptionStates.clear();
    harness.googlePlayProvider.acknowledgedSubscriptions.length = 0;
    harness.googlePlayProvider.acknowledgmentFailures.clear();
    harness.googlePlayProvider.verifiedPurchaseTokens.length = 0;
  });

  afterAll(async () => {
    await harness.app.close();
    await harness.prisma.$disconnect();
  });

  async function signIn(email: string) {
    await harness.app.inject({
      method: "POST",
      url: "/v1/auth/email/request-code",
      payload: { email }
    });

    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/email/verify-code",
      payload: {
        email,
        code: harness.emailProvider.latestCodeFor(email)
      }
    });

    expect(response.statusCode).toBe(200);
    return response.json();
  }

  async function registerDevice(
    session: Awaited<ReturnType<typeof signIn>>,
    installationId: string
  ) {
    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/devices/register",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": `device-${installationId}`
      },
      payload: {
        platform: "WINDOWS",
        installation_id: installationId,
        device_name: "Usage Test Device",
        app_version: "1.0.0"
      }
    });

    expect(response.statusCode).toBe(200);
    return response.json().device;
  }

  async function createRealtimeSession(
    session: Awaited<ReturnType<typeof signIn>>,
    deviceId: string,
    overrides?: Partial<{
      feature_code: string;
      provider: string;
      provider_session_ref: string | null;
    }>
  ) {
    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/realtime/session",
      headers: {
        authorization: `Bearer ${session.access_token}`
      },
      payload: {
        device_id: deviceId,
        feature_code: overrides?.feature_code ?? "dictation",
        provider: overrides?.provider ?? "openai_realtime",
        ...(overrides?.provider_session_ref !== undefined
          ? { provider_session_ref: overrides.provider_session_ref }
          : {})
      }
    });

    expect(response.statusCode).toBe(201);
    return response.json().realtime_session;
  }

  async function settleRealtimeSession(
    session: Awaited<ReturnType<typeof signIn>>,
    realtimeSessionId: string,
    overrides?: Partial<{
      provider: string;
      providerSessionRef: string | null;
      status: "COMPLETED" | "FAILED";
      endedAt: Date;
      finalWordCount: number;
      audioSeconds: number;
      requestCount: number;
      trustedResultSource: string;
    }>
  ) {
    return harness.usageService.settleTrustedRealtimeSession({
      organizationId: session.organization_id,
      userId: session.user.id,
      realtimeSessionId,
      provider: overrides?.provider ?? "openai_realtime",
      status: overrides?.status ?? "COMPLETED",
      endedAt: overrides?.endedAt ?? new Date("2026-03-26T10:00:00.000Z"),
      trustedResultSource: overrides?.trustedResultSource ?? "provider_callback",
      ...(
        overrides && "providerSessionRef" in overrides
          ? { providerSessionRef: overrides.providerSessionRef }
          : { providerSessionRef: "rt-session-1" }
      ),
      ...(
        overrides && "finalWordCount" in overrides
          ? { finalWordCount: overrides.finalWordCount }
          : { finalWordCount: 321 }
      ),
      ...(
        overrides && "audioSeconds" in overrides
          ? { audioSeconds: overrides.audioSeconds }
          : { audioSeconds: 27 }
      ),
      ...(
        overrides && "requestCount" in overrides
          ? { requestCount: overrides.requestCount }
          : { requestCount: 1 }
      )
    });
  }

  it("creates server-owned realtime sessions for owned devices and rejects foreign devices", async () => {
    const owner = await signIn("usage-session-owner@example.com");
    const foreignUser = await signIn("usage-session-foreign@example.com");
    const device = await registerDevice(owner, "usage-session-owner");

    const createResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/realtime/session",
      headers: {
        authorization: `Bearer ${owner.access_token}`
      },
      payload: {
        device_id: device.id,
        feature_code: "dictation",
        provider: "openai_realtime"
      }
    });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json()).toEqual({
      realtime_session: {
        id: expect.any(String) as string,
        device_id: device.id,
        feature_code: "dictation",
        provider: "openai_realtime",
        provider_session_ref: null,
        status: "open",
        started_at: expect.any(String) as string,
        ended_at: null,
        final_word_count: null,
        audio_seconds: null,
        request_count: null,
        trusted_result_source: null,
        finalized_at: null,
        created_at: expect.any(String) as string,
        updated_at: expect.any(String) as string
      }
    });

    const storedRealtimeSession = await harness.prisma.realtimeSession.findUniqueOrThrow({
      where: {
        id: createResponse.json().realtime_session.id
      }
    });

    expect(storedRealtimeSession.organizationId).toBe(owner.organization_id);
    expect(storedRealtimeSession.userId).toBe(owner.user.id);
    expect(storedRealtimeSession.deviceId).toBe(device.id);
    expect(storedRealtimeSession.status).toBe("OPEN");
    expect(await harness.prisma.quotaWindow.count()).toBe(0);

    const foreignResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/realtime/session",
      headers: {
        authorization: `Bearer ${foreignUser.access_token}`
      },
      payload: {
        device_id: device.id,
        feature_code: "dictation",
        provider: "openai_realtime"
      }
    });

    expect(foreignResponse.statusCode).toBe(404);
    expect(foreignResponse.json().error.code).toBe("device_not_found");
  });

  it.each([
    [
      "finalWordCount",
      "final-word-count",
      "Completed trusted results require a final word count.",
      { finalWordCount: undefined }
    ],
    [
      "audioSeconds",
      "audio-seconds",
      "Completed trusted results require audio seconds.",
      { audioSeconds: undefined }
    ],
    [
      "requestCount",
      "request-count",
      "Completed trusted results require a request count.",
      { requestCount: undefined }
    ]
  ])(
    "rejects completed trusted settlements when %s is omitted and keeps finalize blocked",
    async (missingField, missingFieldSlug, expectedMessage, overrides) => {
      const session = await signIn(`usage-missing-trusted-${missingFieldSlug}@example.com`);
      const device = await registerDevice(session, `usage-missing-trusted-${missingFieldSlug}`);
      const realtimeSession = await createRealtimeSession(session, device.id);

      await expect(
        settleRealtimeSession(session, realtimeSession.id, overrides)
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "invalid_trusted_result",
        message: expectedMessage
      });

      const storedRealtimeSession = await harness.prisma.realtimeSession.findUniqueOrThrow({
        where: {
          id: realtimeSession.id
        }
      });

      expect(storedRealtimeSession.status).toBe("OPEN");
      expect(storedRealtimeSession.endedAt).toBeNull();
      expect(storedRealtimeSession.finalWordCount).toBeNull();
      expect(storedRealtimeSession.audioSeconds).toBeNull();
      expect(storedRealtimeSession.requestCount).toBeNull();
      expect(storedRealtimeSession.trustedResultSource).toBeNull();

      const finalizeResponse = await harness.app.inject({
        method: "POST",
        url: "/v1/usage/finalize",
        headers: {
          authorization: `Bearer ${session.access_token}`,
          "idempotency-key": `usage-missing-trusted-${missingFieldSlug}`
        },
        payload: {
          realtime_session_id: realtimeSession.id
        }
      });

      expect(finalizeResponse.statusCode).toBe(409);
      expect(finalizeResponse.json().error.code).toBe("trusted_usage_unavailable");
      expect(await harness.prisma.usageEvent.count()).toBe(0);
      expect(await harness.prisma.quotaWindow.count()).toBe(0);
    }
  );

  it("settles trusted results through service code and finalizes idempotently from trusted session data only", async () => {
    const session = await signIn("usage-finalize@example.com");
    const device = await registerDevice(session, "usage-finalize-device");
    const realtimeSession = await createRealtimeSession(session, device.id);

    const missingTrustedResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/usage/finalize",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": "usage-finalize-before-trusted"
      },
      payload: {
        realtime_session_id: realtimeSession.id
      }
    });

    expect(missingTrustedResponse.statusCode).toBe(409);
    expect(missingTrustedResponse.json().error.code).toBe("trusted_usage_unavailable");

    const settled = await settleRealtimeSession(session, realtimeSession.id, {
      providerSessionRef: "rt-session-finalize-1",
      endedAt: new Date("2026-03-26T11:00:00.000Z"),
      finalWordCount: 321,
      audioSeconds: 27,
      requestCount: 1
    });

    expect(settled).toEqual({
      realtime_session: {
        id: realtimeSession.id,
        device_id: device.id,
        feature_code: "dictation",
        provider: "openai_realtime",
        provider_session_ref: "rt-session-finalize-1",
        status: "completed",
        started_at: expect.any(String) as string,
        ended_at: "2026-03-26T11:00:00.000Z",
        final_word_count: 321,
        audio_seconds: 27,
        request_count: 1,
        trusted_result_source: "provider_callback",
        finalized_at: null,
        created_at: expect.any(String) as string,
        updated_at: expect.any(String) as string
      }
    });

    await expect(settleRealtimeSession(session, realtimeSession.id)).rejects.toMatchObject({
      code: "realtime_session_already_settled"
    });

    const missingKeyResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/usage/finalize",
      headers: {
        authorization: `Bearer ${session.access_token}`
      },
      payload: {
        realtime_session_id: realtimeSession.id
      }
    });

    expect(missingKeyResponse.statusCode).toBe(400);
    expect(missingKeyResponse.json().error.code).toBe("missing_idempotency_key");

    const firstFinalizeResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/usage/finalize",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": "usage-finalize-1"
      },
      payload: {
        realtime_session_id: realtimeSession.id,
        client_request_id: "client-req-1"
      }
    });

    expect(firstFinalizeResponse.statusCode).toBe(200);
    expect(firstFinalizeResponse.json()).toEqual({
      usage: {
        id: expect.any(String) as string,
        realtime_session_id: realtimeSession.id,
        device_id: device.id,
        feature_code: "dictation",
        provider: "openai_realtime",
        word_count: 321,
        audio_seconds: 27,
        request_count: 1,
        status: "finalized",
        occurred_at: "2026-03-26T11:00:00.000Z"
      },
      quota: {
        feature_code: "dictation",
        window_start: "2026-03-23T00:00:00.000Z",
        window_end: "2026-03-30T00:00:00.000Z",
        word_limit: 10000,
        used_words: 321,
        remaining_words: 9679,
        plan_code: "free",
        entitlement_code: "free",
        entitlement_status: "active"
      },
      summary: {
        week_start: "2026-03-23T00:00:00.000Z",
        week_end: "2026-03-30T00:00:00.000Z",
        total_words: 321,
        total_audio_seconds: 27,
        total_requests: 1
      }
    });

    const replayResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/usage/finalize",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": "usage-finalize-1"
      },
      payload: {
        realtime_session_id: realtimeSession.id,
        client_request_id: "client-req-1"
      }
    });

    expect(replayResponse.statusCode).toBe(200);
    expect(replayResponse.json()).toEqual(firstFinalizeResponse.json());

    const conflictResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/usage/finalize",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": "usage-finalize-1"
      },
      payload: {
        realtime_session_id: realtimeSession.id,
        client_request_id: "client-req-2"
      }
    });

    expect(conflictResponse.statusCode).toBe(409);
    expect(conflictResponse.json().error.code).toBe("idempotency_key_conflict");

    const storedUsageEvents = await harness.prisma.usageEvent.findMany({
      where: {
        organizationId: session.organization_id
      }
    });
    const storedQuotaWindow = await harness.prisma.quotaWindow.findFirstOrThrow({
      where: {
        organizationId: session.organization_id,
        userId: session.user.id,
        featureCode: "dictation"
      }
    });
    const storedRealtimeSession = await harness.prisma.realtimeSession.findUniqueOrThrow({
      where: {
        id: realtimeSession.id
      }
    });

    expect(storedUsageEvents).toHaveLength(1);
    expect(storedUsageEvents[0]?.status).toBe("FINALIZED");
    expect(storedUsageEvents[0]?.idempotencyKey).toBe("usage-finalize-1");
    expect(storedQuotaWindow.usedWords).toBe(321);
    expect(storedQuotaWindow.wordLimit).toBe(10000);
    expect(storedRealtimeSession.providerSessionRef).toBe("rt-session-finalize-1");
    expect(storedRealtimeSession.trustedResultSource).toBe("provider_callback");
    expect(storedRealtimeSession.finalizedAt).not.toBeNull();
  });

  it("rejects free-plan overages without partial writes", async () => {
    const session = await signIn("usage-quota-free@example.com");
    const device = await registerDevice(session, "usage-quota-free-device");
    const firstRealtimeSession = await createRealtimeSession(session, device.id);
    const secondRealtimeSession = await createRealtimeSession(session, device.id, {
      provider_session_ref: "rt-session-free-2"
    });

    await settleRealtimeSession(session, firstRealtimeSession.id, {
      providerSessionRef: "rt-session-free-1",
      endedAt: new Date("2026-03-26T12:00:00.000Z"),
      finalWordCount: 8000,
      audioSeconds: 100,
      requestCount: 1
    });
    await settleRealtimeSession(session, secondRealtimeSession.id, {
      providerSessionRef: "rt-session-free-2",
      endedAt: new Date("2026-03-26T12:05:00.000Z"),
      finalWordCount: 2501,
      audioSeconds: 60,
      requestCount: 1
    });

    const firstFinalizeResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/usage/finalize",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": "usage-free-first"
      },
      payload: {
        realtime_session_id: firstRealtimeSession.id
      }
    });

    expect(firstFinalizeResponse.statusCode).toBe(200);

    const secondFinalizeResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/usage/finalize",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": "usage-free-second"
      },
      payload: {
        realtime_session_id: secondRealtimeSession.id
      }
    });

    expect(secondFinalizeResponse.statusCode).toBe(403);
    expect(secondFinalizeResponse.json().error.code).toBe("quota_exceeded");

    const usageEventCount = await harness.prisma.usageEvent.count({
      where: {
        organizationId: session.organization_id,
        status: "FINALIZED"
      }
    });
    const quotaWindow = await harness.prisma.quotaWindow.findFirstOrThrow({
      where: {
        organizationId: session.organization_id,
        userId: session.user.id,
        featureCode: "dictation"
      }
    });
    const secondStoredSession = await harness.prisma.realtimeSession.findUniqueOrThrow({
      where: {
        id: secondRealtimeSession.id
      }
    });

    expect(usageEventCount).toBe(1);
    expect(quotaWindow.usedWords).toBe(8000);
    expect(secondStoredSession.finalizedAt).toBeNull();
  });

  it("uses the seeded paid-plan limit in quota reads and trusted summaries", async () => {
    const session = await signIn("usage-paid@example.com");
    const device = await registerDevice(session, "usage-paid-device");
    const paidPlan = await harness.prisma.plan.findUniqueOrThrow({
      where: {
        code: "pro_monthly"
      }
    });

    await harness.prisma.subscription.create({
      data: {
        organizationId: session.organization_id,
        planId: paidPlan.id,
        providerCustomerId: null,
        provider: "STRIPE",
        externalSubscriptionId: "sub_usage_paid_1",
        status: "ACTIVE",
        isTrial: false,
        conflictFlag: false,
        currentPeriodStart: new Date("2026-03-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-04-01T00:00:00.000Z")
      }
    });
    await harness.prisma.entitlement.deleteMany({
      where: {
        organizationId: session.organization_id
      }
    });

    const realtimeSession = await createRealtimeSession(session, device.id);
    await settleRealtimeSession(session, realtimeSession.id, {
      providerSessionRef: "rt-session-paid-1",
      endedAt: new Date("2026-03-26T13:00:00.000Z"),
      finalWordCount: 50000,
      audioSeconds: 600,
      requestCount: 3
    });

    const finalizeResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/usage/finalize",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": "usage-paid-finalize"
      },
      payload: {
        realtime_session_id: realtimeSession.id
      }
    });

    expect(finalizeResponse.statusCode).toBe(200);

    const quotaResponse = await harness.app.inject({
      method: "GET",
      url: "/v1/usage/quota",
      headers: {
        authorization: `Bearer ${session.access_token}`
      }
    });
    const summaryResponse = await harness.app.inject({
      method: "GET",
      url: "/v1/usage/summary",
      headers: {
        authorization: `Bearer ${session.access_token}`
      }
    });

    expect(quotaResponse.statusCode).toBe(200);
    expect(quotaResponse.json()).toEqual({
      quota: {
        feature_code: "dictation",
        window_start: expect.any(String) as string,
        window_end: expect.any(String) as string,
        word_limit: 1000000,
        used_words: 50000,
        remaining_words: 950000,
        plan_code: "pro_monthly",
        entitlement_code: "pro_active",
        entitlement_status: "active"
      }
    });
    expect(summaryResponse.statusCode).toBe(200);
    expect(summaryResponse.json()).toEqual({
      summary: {
        week_start: expect.any(String) as string,
        week_end: expect.any(String) as string,
        total_words: 50000,
        total_audio_seconds: 600,
        total_requests: 3
      }
    });
  });

  it("stores telemetry without mutating quota or trusted rollups", async () => {
    const session = await signIn("usage-telemetry@example.com");
    const device = await registerDevice(session, "usage-telemetry-device");

    const initialQuotaResponse = await harness.app.inject({
      method: "GET",
      url: "/v1/usage/quota",
      headers: {
        authorization: `Bearer ${session.access_token}`
      }
    });
    const initialSummaryResponse = await harness.app.inject({
      method: "GET",
      url: "/v1/usage/summary",
      headers: {
        authorization: `Bearer ${session.access_token}`
      }
    });

    expect(initialQuotaResponse.json().quota.used_words).toBe(0);
    expect(initialSummaryResponse.json().summary.total_words).toBe(0);

    const telemetryResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/usage/events",
      headers: {
        authorization: `Bearer ${session.access_token}`
      },
      payload: {
        device_id: device.id,
        feature_code: "dictation",
        provider: "openai_realtime",
        word_count: 400,
        audio_seconds: 30,
        request_count: 2,
        metadata_json: {
          source: "client"
        }
      }
    });

    expect(telemetryResponse.statusCode).toBe(201);
    expect(telemetryResponse.json()).toEqual({
      usage_event: {
        id: expect.any(String) as string,
        realtime_session_id: null,
        device_id: device.id,
        feature_code: "dictation",
        provider: "openai_realtime",
        word_count: 400,
        audio_seconds: 30,
        request_count: 2,
        status: "telemetry",
        occurred_at: expect.any(String) as string
      }
    });

    const quotaResponse = await harness.app.inject({
      method: "GET",
      url: "/v1/usage/quota",
      headers: {
        authorization: `Bearer ${session.access_token}`
      }
    });
    const summaryResponse = await harness.app.inject({
      method: "GET",
      url: "/v1/usage/summary",
      headers: {
        authorization: `Bearer ${session.access_token}`
      }
    });
    const telemetryRow = await harness.prisma.usageEvent.findFirstOrThrow({
      where: {
        organizationId: session.organization_id,
        status: "TELEMETRY"
      }
    });

    expect(quotaResponse.json().quota.used_words).toBe(0);
    expect(summaryResponse.json().summary.total_words).toBe(0);
    expect(telemetryRow.provider).toBe("openai_realtime");
    expect(telemetryRow.audioSeconds).toBe(30);
    expect(telemetryRow.requestCount).toBe(2);
    expect(telemetryRow.metadataJson).toEqual({
      source: "client"
    });
  });

  it("rolls quota windows and weekly rollups at Monday 00:00 UTC", async () => {
    const session = await signIn("usage-rollover@example.com");
    const device = await registerDevice(session, "usage-rollover-device");
    const sundaySession = await createRealtimeSession(session, device.id);
    const mondaySession = await createRealtimeSession(session, device.id);

    await settleRealtimeSession(session, sundaySession.id, {
      providerSessionRef: "rt-session-sunday",
      endedAt: new Date("2026-03-29T23:59:59.000Z"),
      finalWordCount: 100,
      audioSeconds: 10,
      requestCount: 1
    });
    await settleRealtimeSession(session, mondaySession.id, {
      providerSessionRef: "rt-session-monday",
      endedAt: new Date("2026-03-30T00:00:00.000Z"),
      finalWordCount: 200,
      audioSeconds: 20,
      requestCount: 1
    });

    const sundayFinalizeResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/usage/finalize",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": "usage-rollover-sunday"
      },
      payload: {
        realtime_session_id: sundaySession.id
      }
    });
    const mondayFinalizeResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/usage/finalize",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": "usage-rollover-monday"
      },
      payload: {
        realtime_session_id: mondaySession.id
      }
    });

    expect(sundayFinalizeResponse.statusCode).toBe(200);
    expect(mondayFinalizeResponse.statusCode).toBe(200);

    const quotaWindows = await harness.prisma.quotaWindow.findMany({
      where: {
        organizationId: session.organization_id,
        userId: session.user.id
      },
      orderBy: {
        windowStart: "asc"
      }
    });
    const weeklyRollups = await harness.prisma.usageRollupWeekly.findMany({
      where: {
        organizationId: session.organization_id,
        userId: session.user.id
      },
      orderBy: {
        weekStart: "asc"
      }
    });

    expect(quotaWindows.map((window) => ({
      window_start: window.windowStart.toISOString(),
      used_words: window.usedWords
    }))).toEqual([
      {
        window_start: "2026-03-23T00:00:00.000Z",
        used_words: 100
      },
      {
        window_start: "2026-03-30T00:00:00.000Z",
        used_words: 200
      }
    ]);
    expect(weeklyRollups.map((rollup) => ({
      week_start: rollup.weekStart.toISOString(),
      total_words: rollup.totalWords,
      total_audio_seconds: rollup.totalAudioSeconds,
      total_requests: rollup.totalRequests
    }))).toEqual([
      {
        week_start: "2026-03-23T00:00:00.000Z",
        total_words: 100,
        total_audio_seconds: 10,
        total_requests: 1
      },
      {
        week_start: "2026-03-30T00:00:00.000Z",
        total_words: 200,
        total_audio_seconds: 20,
        total_requests: 1
      }
    ]);
  });

  it("prevents concurrent finalize requests from spending the same free quota twice", async () => {
    const session = await signIn("usage-concurrency@example.com");
    const device = await registerDevice(session, "usage-concurrency-device");
    const firstRealtimeSession = await createRealtimeSession(session, device.id);
    const secondRealtimeSession = await createRealtimeSession(session, device.id, {
      provider_session_ref: "rt-session-concurrency-2"
    });

    await settleRealtimeSession(session, firstRealtimeSession.id, {
      providerSessionRef: "rt-session-concurrency-1",
      endedAt: new Date("2026-03-26T14:00:00.000Z"),
      finalWordCount: 6000,
      audioSeconds: 50,
      requestCount: 1
    });
    await settleRealtimeSession(session, secondRealtimeSession.id, {
      providerSessionRef: "rt-session-concurrency-2",
      endedAt: new Date("2026-03-26T14:00:01.000Z"),
      finalWordCount: 6000,
      audioSeconds: 55,
      requestCount: 1
    });

    const [firstResponse, secondResponse] = await Promise.all([
      harness.app.inject({
        method: "POST",
        url: "/v1/usage/finalize",
        headers: {
          authorization: `Bearer ${session.access_token}`,
          "idempotency-key": "usage-concurrency-1"
        },
        payload: {
          realtime_session_id: firstRealtimeSession.id
        }
      }),
      harness.app.inject({
        method: "POST",
        url: "/v1/usage/finalize",
        headers: {
          authorization: `Bearer ${session.access_token}`,
          "idempotency-key": "usage-concurrency-2"
        },
        payload: {
          realtime_session_id: secondRealtimeSession.id
        }
      })
    ]);

    const statuses = [firstResponse.statusCode, secondResponse.statusCode].sort((left, right) => left - right);
    const usageEventCount = await harness.prisma.usageEvent.count({
      where: {
        organizationId: session.organization_id,
        status: "FINALIZED"
      }
    });
    const quotaWindow = await harness.prisma.quotaWindow.findFirstOrThrow({
      where: {
        organizationId: session.organization_id,
        userId: session.user.id,
        featureCode: "dictation"
      }
    });
    const weeklyRollup = await harness.prisma.usageRollupWeekly.findFirstOrThrow({
      where: {
        organizationId: session.organization_id,
        userId: session.user.id
      }
    });

    expect(statuses).toEqual([200, 403]);
    expect(usageEventCount).toBe(1);
    expect(quotaWindow.usedWords).toBe(6000);
    expect(weeklyRollup.totalWords).toBe(6000);
  });
});
