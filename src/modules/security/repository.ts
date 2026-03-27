import {
  Prisma,
  PrismaClient,
  type Device,
  type Organization,
  type User,
  type SecurityEvent
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
}
