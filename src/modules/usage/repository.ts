import { Prisma, PrismaClient, type RealtimeSession, type UsageEvent, type UsageRollupWeekly } from "@prisma/client";

export type UsageDbClient = PrismaClient | Prisma.TransactionClient;

export interface CreateRealtimeSessionInput {
  organizationId: string;
  userId: string;
  deviceId: string;
  featureCode: string;
  provider: string;
  providerSessionRef?: string | null;
}

export interface UpdateTrustedRealtimeSessionInput {
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

export interface UpsertQuotaWindowInput {
  organizationId: string;
  userId: string;
  featureCode: string;
  windowStart: Date;
  wordLimit: number;
}

export interface CreateUsageEventInput {
  organizationId: string;
  userId: string;
  deviceId?: string | null;
  realtimeSessionId?: string | null;
  idempotencyKey?: string | null;
  featureCode: string;
  provider: string;
  wordCount: number;
  audioSeconds: number;
  requestCount: number;
  status: "FINALIZED" | "TELEMETRY";
  metadataJson?: Prisma.InputJsonValue | null;
  occurredAt?: Date;
}

export interface UpsertWeeklyRollupInput {
  organizationId: string;
  userId: string;
  weekStart: Date;
  totalWords: number;
  totalAudioSeconds: number;
  totalRequests: number;
}

export class UsageRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async lockUserRow(userId: string, transaction: Prisma.TransactionClient): Promise<void> {
    await transaction.$queryRaw`SELECT id FROM "users" WHERE id = ${userId} FOR UPDATE`;
  }

  async createRealtimeSession(input: CreateRealtimeSessionInput, transaction?: UsageDbClient) {
    return this.getClient(transaction).realtimeSession.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId,
        deviceId: input.deviceId,
        featureCode: input.featureCode,
        provider: input.provider,
        providerSessionRef: input.providerSessionRef ?? null
      }
    });
  }

  async findOwnedRealtimeSession(
    organizationId: string,
    userId: string,
    realtimeSessionId: string,
    transaction?: UsageDbClient
  ): Promise<RealtimeSession | null> {
    return this.getClient(transaction).realtimeSession.findFirst({
      where: {
        id: realtimeSessionId,
        organizationId,
        userId
      }
    });
  }

  async updateTrustedRealtimeSession(input: UpdateTrustedRealtimeSessionInput, transaction?: UsageDbClient) {
    const client = this.getClient(transaction);
    const updateResult = await client.realtimeSession.updateMany({
      where: {
        id: input.realtimeSessionId,
        organizationId: input.organizationId,
        userId: input.userId,
        status: "OPEN",
        trustedResultSource: null,
        finalizedAt: null,
        provider: input.provider
      },
      data: {
        providerSessionRef: input.providerSessionRef ?? null,
        status: input.status,
        endedAt: input.endedAt,
        finalWordCount: input.finalWordCount ?? null,
        audioSeconds: input.audioSeconds ?? null,
        requestCount: input.requestCount ?? null,
        trustedResultSource: input.trustedResultSource
      }
    });

    if (updateResult.count !== 1) {
      return null;
    }

    return client.realtimeSession.findUnique({
      where: {
        id: input.realtimeSessionId
      }
    });
  }

  async markRealtimeSessionExpired(
    organizationId: string,
    userId: string,
    realtimeSessionId: string,
    transaction?: UsageDbClient
  ): Promise<void> {
    await this.getClient(transaction).realtimeSession.updateMany({
      where: {
        id: realtimeSessionId,
        organizationId,
        userId,
        status: "OPEN"
      },
      data: {
        status: "EXPIRED"
      }
    });
  }

  async markRealtimeSessionFinalized(
    organizationId: string,
    userId: string,
    realtimeSessionId: string,
    finalizedAt: Date,
    transaction?: UsageDbClient
  ): Promise<boolean> {
    const updateResult = await this.getClient(transaction).realtimeSession.updateMany({
      where: {
        id: realtimeSessionId,
        organizationId,
        userId,
        status: "COMPLETED",
        finalizedAt: null
      },
      data: {
        finalizedAt
      }
    });

    return updateResult.count === 1;
  }

  async upsertQuotaWindow(input: UpsertQuotaWindowInput, transaction?: UsageDbClient) {
    return this.getClient(transaction).quotaWindow.upsert({
      where: {
        organizationId_userId_featureCode_windowStart: {
          organizationId: input.organizationId,
          userId: input.userId,
          featureCode: input.featureCode,
          windowStart: input.windowStart
        }
      },
      create: {
        organizationId: input.organizationId,
        userId: input.userId,
        featureCode: input.featureCode,
        windowStart: input.windowStart,
        wordLimit: input.wordLimit
      },
      update: {
        wordLimit: input.wordLimit
      }
    });
  }

  async incrementQuotaWindowUsage(
    quotaWindowId: string,
    wordLimit: number,
    wordCount: number,
    transaction?: UsageDbClient
  ) {
    return this.getClient(transaction).quotaWindow.update({
      where: {
        id: quotaWindowId
      },
      data: {
        wordLimit,
        usedWords: {
          increment: wordCount
        }
      }
    });
  }

  async findQuotaWindow(
    organizationId: string,
    userId: string,
    featureCode: string,
    windowStart: Date,
    transaction?: UsageDbClient
  ) {
    return this.getClient(transaction).quotaWindow.findUnique({
      where: {
        organizationId_userId_featureCode_windowStart: {
          organizationId,
          userId,
          featureCode,
          windowStart
        }
      }
    });
  }

  async createUsageEvent(input: CreateUsageEventInput, transaction?: UsageDbClient): Promise<UsageEvent> {
    return this.getClient(transaction).usageEvent.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId,
        deviceId: input.deviceId ?? null,
        realtimeSessionId: input.realtimeSessionId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        featureCode: input.featureCode,
        provider: input.provider,
        wordCount: input.wordCount,
        audioSeconds: input.audioSeconds,
        requestCount: input.requestCount,
        status: input.status,
        metadataJson: input.metadataJson ?? Prisma.JsonNull,
        occurredAt: input.occurredAt ?? new Date()
      }
    });
  }

  async upsertWeeklyRollup(
    input: UpsertWeeklyRollupInput,
    transaction?: UsageDbClient
  ): Promise<UsageRollupWeekly> {
    return this.getClient(transaction).usageRollupWeekly.upsert({
      where: {
        organizationId_userId_weekStart: {
          organizationId: input.organizationId,
          userId: input.userId,
          weekStart: input.weekStart
        }
      },
      create: {
        organizationId: input.organizationId,
        userId: input.userId,
        weekStart: input.weekStart,
        totalWords: input.totalWords,
        totalAudioSeconds: input.totalAudioSeconds,
        totalRequests: input.totalRequests
      },
      update: {
        totalWords: {
          increment: input.totalWords
        },
        totalAudioSeconds: {
          increment: input.totalAudioSeconds
        },
        totalRequests: {
          increment: input.totalRequests
        }
      }
    });
  }

  async findWeeklyRollup(
    organizationId: string,
    userId: string,
    weekStart: Date,
    transaction?: UsageDbClient
  ): Promise<UsageRollupWeekly | null> {
    return this.getClient(transaction).usageRollupWeekly.findUnique({
      where: {
        organizationId_userId_weekStart: {
          organizationId,
          userId,
          weekStart
        }
      }
    });
  }

  private getClient(transaction?: UsageDbClient): UsageDbClient {
    return transaction ?? this.prisma;
  }
}
