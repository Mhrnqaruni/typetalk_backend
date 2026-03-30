import {
  type AuditLog,
  type AuthRateLimitBucket,
  type Device,
  type IpObservation,
  type Organization,
  Prisma,
  PrismaClient,
  type SecurityEvent,
  type User
} from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface CreateSecurityEventInput {
  organizationId?: string | null;
  userId?: string | null;
  deviceId?: string | null;
  eventType: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  ipHash?: string | null;
  metadataJson?: Prisma.InputJsonValue | null;
}

export interface CreateIpObservationInput {
  userId?: string | null;
  organizationId?: string | null;
  deviceId?: string | null;
  ipHash: string;
  hashKeyVersion: number;
  rawIpCiphertext?: string | null;
  rawIpExpiresAt?: Date | null;
  countryCode?: string | null;
  region?: string | null;
  asn?: string | null;
  source: string;
  metadataJson?: Prisma.InputJsonValue | null;
}

export interface CreateAuditLogInput {
  organizationId?: string | null;
  actorUserId?: string | null;
  actorType: string;
  actorId: string;
  targetType: string;
  targetId?: string | null;
  targetUserId?: string | null;
  action: string;
  requestId?: string | null;
  metadataJson?: Prisma.InputJsonValue | null;
}

export class SecurityRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createEvent(
    input: CreateSecurityEventInput,
    transaction?: DbClient
  ): Promise<
    SecurityEvent & {
      organization?: Organization | null;
      user?: User | null;
      device?: Device | null;
    }
  > {
    const client = transaction ?? this.prisma;

    return client.securityEvent.create({
      data: {
        organizationId: input.organizationId ?? null,
        userId: input.userId ?? null,
        deviceId: input.deviceId ?? null,
        eventType: input.eventType,
        severity: input.severity,
        ipHash: input.ipHash ?? null,
        metadataJson: input.metadataJson ?? Prisma.JsonNull
      }
    });
  }

  async createIpObservation(
    input: CreateIpObservationInput,
    transaction?: DbClient
  ): Promise<IpObservation> {
    const client = transaction ?? this.prisma;

    return client.ipObservation.create({
      data: {
        userId: input.userId ?? null,
        organizationId: input.organizationId ?? null,
        deviceId: input.deviceId ?? null,
        ipHash: input.ipHash,
        hashKeyVersion: input.hashKeyVersion,
        rawIpCiphertext: input.rawIpCiphertext ?? null,
        rawIpExpiresAt: input.rawIpExpiresAt ?? null,
        countryCode: input.countryCode ?? null,
        region: input.region ?? null,
        asn: input.asn ?? null,
        source: input.source,
        metadataJson: input.metadataJson ?? Prisma.JsonNull
      }
    });
  }

  async createAuditLog(
    input: CreateAuditLogInput,
    transaction?: DbClient
  ): Promise<AuditLog> {
    const client = transaction ?? this.prisma;

    return client.auditLog.create({
      data: {
        organizationId: input.organizationId ?? null,
        actorUserId: input.actorUserId ?? null,
        actorType: input.actorType,
        actorId: input.actorId,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        targetUserId: input.targetUserId ?? null,
        action: input.action,
        requestId: input.requestId ?? null,
        metadataJson: input.metadataJson ?? Prisma.JsonNull
      }
    });
  }

  async incrementAuthRateLimitBucket(
    input: {
      scope: string;
      ipHash: string;
      windowStart: Date;
    },
    transaction?: DbClient
  ): Promise<AuthRateLimitBucket> {
    const client = transaction ?? this.prisma;
    const [bucket] = await client.$queryRaw<AuthRateLimitBucket[]>`
      INSERT INTO "auth_rate_limit_buckets" (
        "scope",
        "ip_hash",
        "window_start",
        "hit_count",
        "created_at",
        "updated_at"
      )
      VALUES (
        ${input.scope},
        ${input.ipHash},
        ${input.windowStart},
        1,
        NOW(),
        NOW()
      )
      ON CONFLICT ("scope", "ip_hash", "window_start")
      DO UPDATE SET
        "hit_count" = "auth_rate_limit_buckets"."hit_count" + 1,
        "updated_at" = NOW()
      RETURNING
        "scope",
        "ip_hash" AS "ipHash",
        "window_start" AS "windowStart",
        "hit_count" AS "hitCount",
        "created_at" AS "createdAt",
        "updated_at" AS "updatedAt"
    `;

    return bucket;
  }

  async clearExpiredRawIpData(
    before: Date,
    limit: number,
    transaction?: DbClient
  ): Promise<number> {
    const client = transaction ?? this.prisma;
    const expiredRows = await client.ipObservation.findMany({
      where: {
        rawIpCiphertext: {
          not: null
        },
        rawIpExpiresAt: {
          lte: before
        }
      },
      select: {
        id: true
      },
      orderBy: {
        rawIpExpiresAt: "asc"
      },
      take: limit
    });

    if (expiredRows.length === 0) {
      return 0;
    }

    const result = await client.ipObservation.updateMany({
      where: {
        id: {
          in: expiredRows.map((row) => row.id)
        }
      },
      data: {
        rawIpCiphertext: null,
        rawIpExpiresAt: null
      }
    });

    return result.count;
  }

  async resetAuthRateLimitBuckets(): Promise<void> {
    await this.prisma.authRateLimitBucket.deleteMany();
  }
}
