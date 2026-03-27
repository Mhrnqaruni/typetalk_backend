import type { PrismaClient, Prisma } from "@prisma/client";

import {
  SecurityRepository,
  type CreateSecurityEventInput
} from "./repository";

type DbClient = PrismaClient | Prisma.TransactionClient;

export class SecurityService {
  constructor(private readonly repository: SecurityRepository) {}

  async recordEvent(input: CreateSecurityEventInput, transaction?: DbClient) {
    return this.repository.createEvent(input, transaction);
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
}
