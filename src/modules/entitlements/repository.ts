import {
  BillingProvider,
  EntitlementCode,
  EntitlementStatus,
  PrismaClient
} from "@prisma/client";

import type { DbClient } from "../billing/repository";

export interface UpsertEntitlementInput {
  organizationId: string;
  userId: string | null;
  code: EntitlementCode;
  status: EntitlementStatus;
  billingOverlap: boolean;
  primarySubscriptionId: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  sourceProvider: BillingProvider | null;
}

export class EntitlementRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByOrganization(organizationId: string, transaction?: DbClient) {
    return this.getClient(transaction).entitlement.findUnique({
      where: {
        organizationId
      },
      include: {
        primarySubscription: {
          include: {
            plan: true
          }
        }
      }
    });
  }

  async upsertByOrganization(input: UpsertEntitlementInput, transaction?: DbClient) {
    return this.getClient(transaction).entitlement.upsert({
      where: {
        organizationId: input.organizationId
      },
      create: {
        organizationId: input.organizationId,
        userId: input.userId,
        code: input.code,
        status: input.status,
        billingOverlap: input.billingOverlap,
        primarySubscriptionId: input.primarySubscriptionId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        sourceProvider: input.sourceProvider
      },
      update: {
        userId: input.userId,
        code: input.code,
        status: input.status,
        billingOverlap: input.billingOverlap,
        primarySubscriptionId: input.primarySubscriptionId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        sourceProvider: input.sourceProvider
      },
      include: {
        primarySubscription: {
          include: {
            plan: true
          }
        }
      }
    });
  }

  private getClient(transaction?: DbClient): DbClient {
    return transaction ?? this.prisma;
  }
}
