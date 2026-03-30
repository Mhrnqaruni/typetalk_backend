import type { PrismaClient, Prisma } from "@prisma/client";

import { getConfig } from "../../config/env";
import { encryptSensitiveValue, hashIpAddress } from "../../lib/crypto";
import {
  SecurityRepository,
  type CreateAuditLogInput,
  type CreateSecurityEventInput
} from "./repository";

type DbClient = PrismaClient | Prisma.TransactionClient;

const HASH_KEY_VERSION = 1;

export class SecurityService {
  private readonly config = getConfig();

  constructor(private readonly repository: SecurityRepository) {}

  async recordEvent(input: CreateSecurityEventInput, transaction?: DbClient) {
    return this.repository.createEvent(input, transaction);
  }

  async observeIp(
    input: {
      userId?: string | null;
      organizationId?: string | null;
      deviceId?: string | null;
      ipAddress?: string | null;
      countryCode?: string | null;
      region?: string | null;
      asn?: string | null;
      source: string;
      metadataJson?: Prisma.InputJsonValue | null;
      observedAt?: Date;
    },
    transaction?: DbClient
  ) {
    const ipHash = this.hashIp(input.ipAddress);

    if (!ipHash || !input.ipAddress) {
      return null;
    }

    const observedAt = input.observedAt ?? new Date();

    return this.repository.createIpObservation(
      {
        userId: input.userId ?? null,
        organizationId: input.organizationId ?? null,
        deviceId: input.deviceId ?? null,
        ipHash,
        hashKeyVersion: HASH_KEY_VERSION,
        rawIpCiphertext: encryptSensitiveValue(input.ipAddress, this.config.appEncryptionKey),
        rawIpExpiresAt: new Date(
          observedAt.getTime() + this.config.rawIpRetentionHours * 60 * 60 * 1000
        ),
        countryCode: this.normalizeCountryCode(input.countryCode),
        region: input.region ?? null,
        asn: input.asn ?? null,
        source: input.source,
        metadataJson: input.metadataJson ?? null
      },
      transaction
    );
  }

  async writeAuditLog(input: CreateAuditLogInput, transaction?: DbClient) {
    return this.repository.createAuditLog(input, transaction);
  }

  async recordSuspiciousRefreshReuse(
    input: {
      organizationId?: string | null;
      userId?: string | null;
      deviceId?: string | null;
      ipHash?: string | null;
      sessionId: string;
    },
    transaction?: DbClient
  ) {
    return this.recordEvent(
      {
        organizationId: input.organizationId ?? null,
        userId: input.userId ?? null,
        deviceId: input.deviceId ?? null,
        eventType: "refresh_token_reuse_detected",
        severity: "HIGH",
        ipHash: input.ipHash ?? null,
        metadataJson: {
          session_id: input.sessionId
        }
      },
      transaction
    );
  }

  async recordAuthRateLimitHit(
    input: {
      scope: string;
      ipAddress?: string | null;
      countryCode?: string | null;
      limit: number;
      hitCount: number;
      windowStart: Date;
    },
    transaction?: DbClient
  ) {
    const ipHash = this.hashIp(input.ipAddress);

    if (input.ipAddress) {
      await this.observeIp(
        {
          ipAddress: input.ipAddress,
          countryCode: input.countryCode,
          source: input.scope,
          metadataJson: {
            scope: input.scope,
            hit_count: input.hitCount,
            limit: input.limit
          }
        },
        transaction
      );
    }

    return this.recordEvent(
      {
        eventType: "auth_rate_limit_hit",
        severity: "MEDIUM",
        ipHash,
        metadataJson: {
          scope: input.scope,
          hit_count: input.hitCount,
          limit: input.limit,
          window_start: input.windowStart.toISOString()
        }
      },
      transaction
    );
  }

  async recordOtpRequestEmailThrottle(
    input: {
      purpose: string;
      recentChallengeCount: number;
      maxAllowed: number;
      ipAddress?: string | null;
      countryCode?: string | null;
    },
    transaction?: DbClient
  ) {
    const ipHash = this.hashIp(input.ipAddress);

    if (input.ipAddress) {
      await this.observeIp(
        {
          ipAddress: input.ipAddress,
          countryCode: input.countryCode,
          source: "otp_request_email_throttled",
          metadataJson: {
            purpose: input.purpose,
            recent_challenge_count: input.recentChallengeCount,
            max_allowed: input.maxAllowed
          }
        },
        transaction
      );
    }

    return this.recordEvent(
      {
        eventType: "otp_request_email_throttled",
        severity: "MEDIUM",
        ipHash,
        metadataJson: {
          purpose: input.purpose,
          recent_challenge_count: input.recentChallengeCount,
          max_allowed: input.maxAllowed
        }
      },
      transaction
    );
  }

  async recordOtpChallengeLocked(
    input: {
      challengeId: string;
      purpose: string;
      attemptCount: number;
      maxAttempts: number;
      ipAddress?: string | null;
      countryCode?: string | null;
    },
    transaction?: DbClient
  ) {
    const ipHash = this.hashIp(input.ipAddress);

    if (input.ipAddress) {
      await this.observeIp(
        {
          ipAddress: input.ipAddress,
          countryCode: input.countryCode,
          source: "otp_challenge_locked",
          metadataJson: {
            challenge_id: input.challengeId,
            attempt_count: input.attemptCount,
            max_attempts: input.maxAttempts
          }
        },
        transaction
      );
    }

    return this.recordEvent(
      {
        eventType: "otp_challenge_locked",
        severity: "MEDIUM",
        ipHash,
        metadataJson: {
          challenge_id: input.challengeId,
          purpose: input.purpose,
          attempt_count: input.attemptCount,
          max_attempts: input.maxAttempts
        }
      },
      transaction
    );
  }

  async recordAdminAccessDenied(
    input: {
      userId?: string | null;
      organizationId?: string | null;
      deviceId?: string | null;
      requestId: string;
      method: string;
      path: string;
      actorEmail: string;
      ipAddress?: string | null;
      countryCode?: string | null;
    },
    transaction?: DbClient
  ) {
    const ipHash = this.hashIp(input.ipAddress);

    if (input.ipAddress) {
      await this.observeIp(
        {
          userId: input.userId ?? null,
          organizationId: input.organizationId ?? null,
          deviceId: input.deviceId ?? null,
          ipAddress: input.ipAddress,
          countryCode: input.countryCode,
          source: "admin_access_denied",
          metadataJson: {
            request_id: input.requestId,
            method: input.method,
            path: input.path
          }
        },
        transaction
      );
    }

    return this.recordEvent(
      {
        organizationId: input.organizationId ?? null,
        userId: input.userId ?? null,
        deviceId: input.deviceId ?? null,
        eventType: "admin_access_denied",
        severity: "MEDIUM",
        ipHash,
        metadataJson: {
          actor_email: input.actorEmail,
          request_id: input.requestId,
          method: input.method,
          path: input.path
        }
      },
      transaction
    );
  }

  async purgeExpiredRawIpData(limit = this.config.securityRetentionBatchSize, before = new Date()) {
    return this.repository.clearExpiredRawIpData(before, limit);
  }

  hashIp(ipAddress?: string | null): string | null {
    if (!ipAddress) {
      return null;
    }

    return hashIpAddress(ipAddress, this.config.ipHashKeyV1);
  }

  private normalizeCountryCode(countryCode?: string | null): string | null {
    if (!countryCode) {
      return null;
    }

    const normalized = countryCode.trim().toUpperCase();

    return normalized.length === 2 ? normalized : null;
  }
}
