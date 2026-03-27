import {
  EntitlementCode,
  EntitlementStatus,
  Prisma,
  PrismaClient,
  RealtimeSessionStatus,
  UsageEventStatus,
  type QuotaWindow,
  type RealtimeSession,
  type UsageEvent,
  type UsageRollupWeekly
} from "@prisma/client";

import { getConfig } from "../../config/env";
import { AppError } from "../../lib/app-error";
import {
  buildUserScopedIdempotencyScope,
  createIdempotencyRequestHash,
  executeIdempotentRequest
} from "../../lib/idempotency";
import { BillingRepository } from "../billing/repository";
import { DeviceRepository } from "../devices/repository";
import { EntitlementService } from "../entitlements/service";
import { type UsageDbClient, UsageRepository } from "./repository";
import { getUtcWeekWindow } from "./window";

const MAX_REALTIME_SESSION_AGE_MS = 24 * 60 * 60 * 1000;

function toApiRealtimeSessionStatus(status: RealtimeSessionStatus): string {
  return status.toLowerCase();
}

function toApiUsageEventStatus(status: UsageEventStatus): string {
  return status.toLowerCase();
}

function toApiEntitlementCode(code: EntitlementCode): string {
  return code.toLowerCase();
}

function toApiEntitlementStatus(status: EntitlementStatus): string {
  return status.toLowerCase();
}

interface PlanContext {
  planCode: string;
  wordLimit: number;
  entitlementCode: string;
  entitlementStatus: string;
}

export interface TrustedRealtimeSessionResultInput {
  organizationId: string;
  userId: string;
  realtimeSessionId: string;
  provider: string;
  providerSessionRef?: string | null;
  status: "COMPLETED" | "FAILED";
  endedAt: Date;
  finalWordCount?: number | null;
  audioSeconds?: number | null;
  requestCount?: number | null;
  trustedResultSource: string;
}

interface FinalizeUsageInput {
  organizationId: string;
  userId: string;
  realtimeSessionId: string;
  clientRequestId?: string | null;
  idempotencyKey: string;
}

interface RecordTelemetryInput {
  organizationId: string;
  userId: string;
  realtimeSessionId?: string | null;
  deviceId?: string | null;
  featureCode?: string | null;
  provider: string;
  wordCount: number;
  audioSeconds: number;
  requestCount: number;
  metadataJson?: Record<string, unknown>;
}

interface TrustedUsageSnapshot {
  occurredAt: Date;
  finalWordCount: number;
  audioSeconds: number;
  requestCount: number;
}

export class UsageService {
  private readonly config = getConfig();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly usageRepository: UsageRepository,
    private readonly deviceRepository: DeviceRepository,
    private readonly billingRepository: BillingRepository,
    private readonly entitlementService: EntitlementService
  ) {}

  async createRealtimeSession(input: {
    organizationId: string;
    userId: string;
    deviceId: string;
    featureCode: string;
    provider: string;
    providerSessionRef?: string | null;
  }) {
    const device = await this.deviceRepository.findOwnedDevice(input.userId, input.deviceId);

    if (!device) {
      throw new AppError(404, "device_not_found", "Device was not found.");
    }

    const realtimeSession = await this.usageRepository.createRealtimeSession({
      organizationId: input.organizationId,
      userId: input.userId,
      deviceId: input.deviceId,
      featureCode: input.featureCode,
      provider: input.provider,
      providerSessionRef: input.providerSessionRef ?? null
    });

    return {
      realtime_session: this.serializeRealtimeSession(realtimeSession)
    };
  }

  async settleTrustedRealtimeSession(input: TrustedRealtimeSessionResultInput) {
    if (!input.trustedResultSource.trim()) {
      throw new AppError(
        400,
        "invalid_trusted_result",
        "Trusted result source is required."
      );
    }

    const completedTrustedUsage = this.getCompletedTrustedUsage(input);

    const existingSession = await this.usageRepository.findOwnedRealtimeSession(
      input.organizationId,
      input.userId,
      input.realtimeSessionId
    );

    if (!existingSession) {
      throw new AppError(
        404,
        "realtime_session_not_found",
        "Realtime session was not found."
      );
    }

    await this.assertSessionNotExpired(existingSession);

    if (existingSession.finalizedAt) {
      throw new AppError(
        409,
        "realtime_session_consumed",
        "Realtime session was already finalized."
      );
    }

    if (
      existingSession.status !== RealtimeSessionStatus.OPEN
      || existingSession.trustedResultSource !== null
    ) {
      throw new AppError(
        409,
        "realtime_session_already_settled",
        "Realtime session already has a trusted result."
      );
    }

    if (existingSession.provider !== input.provider) {
      throw new AppError(
        409,
        "realtime_session_provider_mismatch",
        "Realtime session provider does not match the trusted result."
      );
    }

    if (
      existingSession.providerSessionRef
      && input.providerSessionRef
      && existingSession.providerSessionRef !== input.providerSessionRef
    ) {
      throw new AppError(
        409,
        "realtime_session_provider_mismatch",
        "Realtime session provider reference does not match the trusted result."
      );
    }

    const updatedSession = await this.usageRepository.updateTrustedRealtimeSession({
      organizationId: input.organizationId,
      userId: input.userId,
      realtimeSessionId: input.realtimeSessionId,
      provider: input.provider,
      providerSessionRef: input.providerSessionRef ?? existingSession.providerSessionRef ?? null,
      status: input.status,
      endedAt: input.endedAt,
      finalWordCount: completedTrustedUsage?.finalWordCount ?? 0,
      audioSeconds: completedTrustedUsage?.audioSeconds ?? 0,
      requestCount: completedTrustedUsage?.requestCount ?? 0,
      trustedResultSource: input.trustedResultSource.trim()
    });

    if (!updatedSession) {
      throw new AppError(
        409,
        "realtime_session_already_settled",
        "Realtime session already has a trusted result."
      );
    }

    return {
      realtime_session: this.serializeRealtimeSession(updatedSession)
    };
  }

  async finalizeUsage(input: FinalizeUsageInput) {
    const requestHash = createIdempotencyRequestHash({
      realtime_session_id: input.realtimeSessionId,
      client_request_id: input.clientRequestId ?? null
    }, this.config.appEncryptionKey);
    const scope = buildUserScopedIdempotencyScope(
      "usage.finalize",
      input.userId,
      input.organizationId
    );
    const result = await executeIdempotentRequest({
      prisma: this.prisma,
      scope,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      execute: async (transaction) => {
        await this.usageRepository.lockUserRow(input.userId, transaction);

        const realtimeSession = await this.usageRepository.findOwnedRealtimeSession(
          input.organizationId,
          input.userId,
          input.realtimeSessionId,
          transaction
        );

        if (!realtimeSession) {
          throw new AppError(
            404,
            "realtime_session_not_found",
            "Realtime session was not found."
          );
        }

        await this.assertSessionNotExpired(realtimeSession, transaction);

        if (realtimeSession.finalizedAt) {
          throw new AppError(
            409,
            "realtime_session_consumed",
            "Realtime session was already finalized."
          );
        }

        const trustedUsage = this.getTrustedUsageSnapshot(realtimeSession);

        if (!trustedUsage) {
          throw new AppError(
            409,
            "trusted_usage_unavailable",
            "Trusted final usage is not available for this realtime session."
          );
        }

        const planContext = await this.resolvePlanContext(
          input.organizationId,
          input.userId,
          transaction
        );
        const weekWindow = getUtcWeekWindow(trustedUsage.occurredAt);
        const quotaWindow = await this.usageRepository.upsertQuotaWindow({
          organizationId: input.organizationId,
          userId: input.userId,
          featureCode: realtimeSession.featureCode,
          windowStart: weekWindow.windowStart,
          wordLimit: planContext.wordLimit
        }, transaction);

        if (quotaWindow.usedWords + trustedUsage.finalWordCount > planContext.wordLimit) {
          throw new AppError(
            403,
            "quota_exceeded",
            "Weekly free quota exceeded."
          );
        }

        const updatedQuotaWindow = await this.usageRepository.incrementQuotaWindowUsage(
          quotaWindow.id,
          planContext.wordLimit,
          trustedUsage.finalWordCount,
          transaction
        );
        const usageEvent = await this.usageRepository.createUsageEvent({
          organizationId: input.organizationId,
          userId: input.userId,
          deviceId: realtimeSession.deviceId,
          realtimeSessionId: realtimeSession.id,
          idempotencyKey: input.idempotencyKey,
          featureCode: realtimeSession.featureCode,
          provider: realtimeSession.provider,
          wordCount: trustedUsage.finalWordCount,
          audioSeconds: trustedUsage.audioSeconds,
          requestCount: trustedUsage.requestCount,
          status: "FINALIZED",
          metadataJson: input.clientRequestId
            ? {
                client_request_id: input.clientRequestId
              }
            : null,
          occurredAt: trustedUsage.occurredAt
        }, transaction);
        const finalized = await this.usageRepository.markRealtimeSessionFinalized(
          input.organizationId,
          input.userId,
          realtimeSession.id,
          new Date(),
          transaction
        );

        if (!finalized) {
          throw new AppError(
            409,
            "realtime_session_consumed",
            "Realtime session was already finalized."
          );
        }

        const weeklyRollup = await this.usageRepository.upsertWeeklyRollup({
          organizationId: input.organizationId,
          userId: input.userId,
          weekStart: weekWindow.windowStart,
          totalWords: usageEvent.wordCount,
          totalAudioSeconds: usageEvent.audioSeconds,
          totalRequests: usageEvent.requestCount
        }, transaction);

        return {
          statusCode: 200,
          body: {
            usage: this.serializeUsageEvent(usageEvent),
            quota: this.serializeQuota(updatedQuotaWindow, planContext, weekWindow),
            summary: this.serializeSummary(weeklyRollup, weekWindow)
          }
        };
      }
    });

    return {
      statusCode: result.statusCode,
      body: result.body
    };
  }

  async recordTelemetryEvent(input: RecordTelemetryInput) {
    let realtimeSession: RealtimeSession | null = null;

    if (input.realtimeSessionId) {
      realtimeSession = await this.usageRepository.findOwnedRealtimeSession(
        input.organizationId,
        input.userId,
        input.realtimeSessionId
      );

      if (!realtimeSession) {
        throw new AppError(
          404,
          "realtime_session_not_found",
          "Realtime session was not found."
        );
      }

      if (realtimeSession.provider !== input.provider) {
        throw new AppError(
          409,
          "realtime_session_provider_mismatch",
          "Realtime session provider does not match the telemetry event."
        );
      }
    } else if (!input.deviceId || !input.featureCode) {
      throw new AppError(
        400,
        "invalid_usage_event",
        "Telemetry usage events require realtime_session_id or device_id plus feature_code."
      );
    }

    const deviceId = realtimeSession?.deviceId ?? input.deviceId ?? null;
    const featureCode = realtimeSession?.featureCode ?? input.featureCode ?? null;

    if (deviceId) {
      const device = await this.deviceRepository.findOwnedDevice(input.userId, deviceId);

      if (!device) {
        throw new AppError(404, "device_not_found", "Device was not found.");
      }
    }

    if (!featureCode) {
      throw new AppError(
        400,
        "invalid_usage_event",
        "Telemetry usage events require a feature code."
      );
    }

    const usageEvent = await this.usageRepository.createUsageEvent({
      organizationId: input.organizationId,
      userId: input.userId,
      deviceId,
      realtimeSessionId: realtimeSession?.id ?? null,
      featureCode,
      provider: input.provider,
      wordCount: input.wordCount,
      audioSeconds: input.audioSeconds,
      requestCount: input.requestCount,
      status: "TELEMETRY",
      metadataJson: input.metadataJson
        ? input.metadataJson as Prisma.InputJsonValue
        : null
    });

    return {
      usage_event: this.serializeUsageEvent(usageEvent)
    };
  }

  async getQuota(
    organizationId: string,
    userId: string,
    featureCode = "dictation",
    now = new Date()
  ) {
    const weekWindow = getUtcWeekWindow(now);
    const [planContext, quotaWindow] = await Promise.all([
      this.resolvePlanContext(organizationId, userId),
      this.usageRepository.findQuotaWindow(organizationId, userId, featureCode, weekWindow.windowStart)
    ]);

    return {
      quota: this.serializeQuota(quotaWindow, planContext, weekWindow, featureCode)
    };
  }

  async getSummary(organizationId: string, userId: string, now = new Date()) {
    const weekWindow = getUtcWeekWindow(now);
    const weeklyRollup = await this.usageRepository.findWeeklyRollup(
      organizationId,
      userId,
      weekWindow.windowStart
    );

    return {
      summary: this.serializeSummary(weeklyRollup, weekWindow)
    };
  }

  private async resolvePlanContext(
    organizationId: string,
    userId: string,
    transaction?: UsageDbClient
  ): Promise<PlanContext> {
    const entitlement = transaction
      ? await this.entitlementService.recomputeForOrganization(organizationId, userId, transaction)
      : await this.entitlementService.getCurrentEntitlementRecord(organizationId);
    const plan = entitlement.primarySubscription?.plan
      ?? await this.billingRepository.findPlanByCode("free", transaction);

    if (!plan) {
      throw new Error("Seeded free plan is missing.");
    }

    return {
      planCode: plan.code,
      wordLimit: plan.weeklyWordLimit,
      entitlementCode: toApiEntitlementCode(entitlement.code),
      entitlementStatus: toApiEntitlementStatus(entitlement.status)
    };
  }

  private serializeRealtimeSession(realtimeSession: RealtimeSession) {
    return {
      id: realtimeSession.id,
      device_id: realtimeSession.deviceId,
      feature_code: realtimeSession.featureCode,
      provider: realtimeSession.provider,
      provider_session_ref: realtimeSession.providerSessionRef,
      status: toApiRealtimeSessionStatus(realtimeSession.status),
      started_at: realtimeSession.startedAt.toISOString(),
      ended_at: realtimeSession.endedAt?.toISOString() ?? null,
      final_word_count: realtimeSession.finalWordCount,
      audio_seconds: realtimeSession.audioSeconds,
      request_count: realtimeSession.requestCount,
      trusted_result_source: realtimeSession.trustedResultSource,
      finalized_at: realtimeSession.finalizedAt?.toISOString() ?? null,
      created_at: realtimeSession.createdAt.toISOString(),
      updated_at: realtimeSession.updatedAt.toISOString()
    };
  }

  private serializeUsageEvent(usageEvent: UsageEvent) {
    return {
      id: usageEvent.id,
      realtime_session_id: usageEvent.realtimeSessionId,
      device_id: usageEvent.deviceId,
      feature_code: usageEvent.featureCode,
      provider: usageEvent.provider,
      word_count: usageEvent.wordCount,
      audio_seconds: usageEvent.audioSeconds,
      request_count: usageEvent.requestCount,
      status: toApiUsageEventStatus(usageEvent.status),
      occurred_at: usageEvent.occurredAt.toISOString()
    };
  }

  private serializeQuota(
    quotaWindow: QuotaWindow | null,
    planContext: PlanContext,
    weekWindow: { windowStart: Date; windowEnd: Date },
    featureCode = quotaWindow?.featureCode ?? "dictation"
  ) {
    const usedWords = quotaWindow?.usedWords ?? 0;

    return {
      feature_code: featureCode,
      window_start: weekWindow.windowStart.toISOString(),
      window_end: weekWindow.windowEnd.toISOString(),
      word_limit: planContext.wordLimit,
      used_words: usedWords,
      remaining_words: Math.max(planContext.wordLimit - usedWords, 0),
      plan_code: planContext.planCode,
      entitlement_code: planContext.entitlementCode,
      entitlement_status: planContext.entitlementStatus
    };
  }

  private serializeSummary(
    weeklyRollup: UsageRollupWeekly | null,
    weekWindow: { windowStart: Date; windowEnd: Date }
  ) {
    return {
      week_start: weekWindow.windowStart.toISOString(),
      week_end: weekWindow.windowEnd.toISOString(),
      total_words: weeklyRollup?.totalWords ?? 0,
      total_audio_seconds: weeklyRollup?.totalAudioSeconds ?? 0,
      total_requests: weeklyRollup?.totalRequests ?? 0
    };
  }

  private async assertSessionNotExpired(
    realtimeSession: RealtimeSession,
    transaction?: UsageDbClient
  ): Promise<void> {
    if (realtimeSession.status === RealtimeSessionStatus.EXPIRED) {
      throw new AppError(
        409,
        "realtime_session_expired",
        "Realtime session has expired."
      );
    }

    if (realtimeSession.startedAt.getTime() + MAX_REALTIME_SESSION_AGE_MS < Date.now()) {
      await this.usageRepository.markRealtimeSessionExpired(
        realtimeSession.organizationId,
        realtimeSession.userId,
        realtimeSession.id,
        transaction
      );

      throw new AppError(
        409,
        "realtime_session_expired",
        "Realtime session has expired."
      );
    }
  }

  private isTrustedUsageReady(realtimeSession: RealtimeSession): boolean {
    return realtimeSession.status === RealtimeSessionStatus.COMPLETED
      && realtimeSession.trustedResultSource !== null
      && realtimeSession.endedAt !== null
      && realtimeSession.finalWordCount !== null
      && realtimeSession.audioSeconds !== null
      && realtimeSession.requestCount !== null;
  }

  private getCompletedTrustedUsage(
    input: TrustedRealtimeSessionResultInput
  ): Omit<TrustedUsageSnapshot, "occurredAt"> | null {
    if (input.status !== "COMPLETED") {
      return null;
    }

    if (input.finalWordCount == null) {
      throw new AppError(
        400,
        "invalid_trusted_result",
        "Completed trusted results require a final word count."
      );
    }

    if (input.audioSeconds == null) {
      throw new AppError(
        400,
        "invalid_trusted_result",
        "Completed trusted results require audio seconds."
      );
    }

    if (input.requestCount == null) {
      throw new AppError(
        400,
        "invalid_trusted_result",
        "Completed trusted results require a request count."
      );
    }

    return {
      finalWordCount: input.finalWordCount,
      audioSeconds: input.audioSeconds,
      requestCount: input.requestCount
    };
  }

  private getTrustedUsageSnapshot(realtimeSession: RealtimeSession): TrustedUsageSnapshot | null {
    if (!this.isTrustedUsageReady(realtimeSession)) {
      return null;
    }

    const { endedAt, finalWordCount, audioSeconds, requestCount } = realtimeSession;

    if (
      endedAt === null
      || finalWordCount === null
      || audioSeconds === null
      || requestCount === null
    ) {
      return null;
    }

    return {
      occurredAt: endedAt,
      finalWordCount,
      audioSeconds,
      requestCount
    };
  }
}
