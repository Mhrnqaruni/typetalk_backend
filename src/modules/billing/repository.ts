import {
  BillingProvider,
  Prisma,
  PrismaClient,
  SubscriptionStatus,
  WebhookEventStatus
} from "@prisma/client";

export type DbClient = PrismaClient | Prisma.TransactionClient;

export interface UpsertSubscriptionInput {
  organizationId: string;
  planId: string;
  providerCustomerId: string | null;
  provider: BillingProvider;
  externalSubscriptionId: string;
  status: SubscriptionStatus;
  isTrial: boolean;
  conflictFlag: boolean;
  trialEndsAt: Date | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  canceledAt: Date | null;
}

export interface UpsertPurchaseTokenInput {
  purchaseToken: string;
  organizationId: string;
  subscriptionId: string | null;
  planId: string;
  productId: string;
  basePlanId: string | null;
  linkedPurchaseToken: string | null;
  status: SubscriptionStatus;
  lastVerifiedAt: Date;
}

export interface CreateWebhookEventInput {
  provider: BillingProvider;
  externalEventId: string;
  payloadJson: Prisma.InputJsonValue;
  status?: WebhookEventStatus;
}

export class BillingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listActivePlans(transaction?: DbClient) {
    return this.getClient(transaction).plan.findMany({
      where: {
        isActive: true
      },
      orderBy: [
        { amountCents: "asc" },
        { code: "asc" }
      ]
    });
  }

  async findPlanByCode(code: string, transaction?: DbClient) {
    return this.getClient(transaction).plan.findFirst({
      where: {
        code,
        isActive: true
      }
    });
  }

  async findPlanByStripePriceId(stripePriceId: string, transaction?: DbClient) {
    return this.getClient(transaction).plan.findFirst({
      where: {
        stripePriceId,
        isActive: true
      }
    });
  }

  async findPlanByGoogleProductBasePlan(
    googleProductId: string,
    googleBasePlanId: string | null,
    transaction?: DbClient
  ) {
    return this.getClient(transaction).plan.findFirst({
      where: {
        googleProductId,
        googleBasePlanId,
        isActive: true
      }
    });
  }

  async findProviderCustomerByOrganization(
    organizationId: string,
    provider: BillingProvider,
    transaction?: DbClient
  ) {
    return this.getClient(transaction).providerCustomer.findUnique({
      where: {
        organizationId_provider: {
          organizationId,
          provider
        }
      }
    });
  }

  async findProviderCustomerByExternalId(
    provider: BillingProvider,
    externalCustomerId: string,
    transaction?: DbClient
  ) {
    return this.getClient(transaction).providerCustomer.findUnique({
      where: {
        provider_externalCustomerId: {
          provider,
          externalCustomerId
        }
      }
    });
  }

  async upsertProviderCustomer(
    organizationId: string,
    provider: BillingProvider,
    externalCustomerId: string,
    transaction?: DbClient
  ) {
    return this.getClient(transaction).providerCustomer.upsert({
      where: {
        organizationId_provider: {
          organizationId,
          provider
        }
      },
      create: {
        organizationId,
        provider,
        externalCustomerId
      },
      update: {
        externalCustomerId
      }
    });
  }

  async listSubscriptionsForOrganization(organizationId: string, transaction?: DbClient) {
    return this.getClient(transaction).subscription.findMany({
      where: {
        organizationId
      },
      include: {
        plan: true
      },
      orderBy: [
        { currentPeriodEnd: "desc" },
        { updatedAt: "desc" }
      ]
    });
  }

  async findLatestSubscriptionForOrganization(organizationId: string, transaction?: DbClient) {
    return this.getClient(transaction).subscription.findFirst({
      where: {
        organizationId
      },
      include: {
        plan: true
      },
      orderBy: [
        { currentPeriodEnd: "desc" },
        { updatedAt: "desc" }
      ]
    });
  }

  async findSubscriptionByExternalId(
    provider: BillingProvider,
    externalSubscriptionId: string,
    transaction?: DbClient
  ) {
    return this.getClient(transaction).subscription.findUnique({
      where: {
        provider_externalSubscriptionId: {
          provider,
          externalSubscriptionId
        }
      },
      include: {
        plan: true
      }
    });
  }

  async upsertSubscription(input: UpsertSubscriptionInput, transaction?: DbClient) {
    return this.getClient(transaction).subscription.upsert({
      where: {
        provider_externalSubscriptionId: {
          provider: input.provider,
          externalSubscriptionId: input.externalSubscriptionId
        }
      },
      create: {
        organizationId: input.organizationId,
        planId: input.planId,
        providerCustomerId: input.providerCustomerId,
        provider: input.provider,
        externalSubscriptionId: input.externalSubscriptionId,
        status: input.status,
        isTrial: input.isTrial,
        conflictFlag: input.conflictFlag,
        trialEndsAt: input.trialEndsAt,
        currentPeriodStart: input.currentPeriodStart,
        currentPeriodEnd: input.currentPeriodEnd,
        canceledAt: input.canceledAt
      },
      update: {
        organizationId: input.organizationId,
        planId: input.planId,
        providerCustomerId: input.providerCustomerId,
        status: input.status,
        isTrial: input.isTrial,
        conflictFlag: input.conflictFlag,
        trialEndsAt: input.trialEndsAt,
        currentPeriodStart: input.currentPeriodStart,
        currentPeriodEnd: input.currentPeriodEnd,
        canceledAt: input.canceledAt
      },
      include: {
        plan: true
      }
    });
  }

  async findPurchaseToken(purchaseToken: string, transaction?: DbClient) {
    return this.getClient(transaction).purchaseToken.findUnique({
      where: {
        purchaseToken
      },
      include: {
        plan: true,
        subscription: {
          include: {
            plan: true
          }
        }
      }
    });
  }

  async upsertPurchaseToken(input: UpsertPurchaseTokenInput, transaction?: DbClient) {
    return this.getClient(transaction).purchaseToken.upsert({
      where: {
        purchaseToken: input.purchaseToken
      },
      create: {
        purchaseToken: input.purchaseToken,
        organizationId: input.organizationId,
        subscriptionId: input.subscriptionId,
        planId: input.planId,
        productId: input.productId,
        basePlanId: input.basePlanId,
        linkedPurchaseToken: input.linkedPurchaseToken,
        status: input.status,
        lastVerifiedAt: input.lastVerifiedAt
      },
      update: {
        organizationId: input.organizationId,
        subscriptionId: input.subscriptionId,
        planId: input.planId,
        productId: input.productId,
        basePlanId: input.basePlanId,
        linkedPurchaseToken: input.linkedPurchaseToken,
        status: input.status,
        lastVerifiedAt: input.lastVerifiedAt
      },
      include: {
        plan: true,
        subscription: {
          include: {
            plan: true
          }
        }
      }
    });
  }

  async markPurchaseTokenAcknowledged(
    purchaseToken: string,
    acknowledgedAt: Date,
    transaction?: DbClient
  ) {
    return this.getClient(transaction).purchaseToken.update({
      where: {
        purchaseToken
      },
      data: {
        acknowledgmentStatus: "ACKNOWLEDGED",
        acknowledgedAt,
        acknowledgmentLastError: null,
        acknowledgmentNextRetryAt: null
      }
    });
  }

  async schedulePurchaseTokenAcknowledgmentRetry(
    purchaseToken: string,
    lastError: string,
    nextRetryAt: Date,
    transaction?: DbClient
  ) {
    return this.getClient(transaction).purchaseToken.update({
      where: {
        purchaseToken
      },
      data: {
        acknowledgmentStatus: "FAILED",
        acknowledgmentAttemptCount: {
          increment: 1
        },
        acknowledgmentLastError: lastError,
        acknowledgmentNextRetryAt: nextRetryAt
      }
    });
  }

  async listDuePurchaseTokenAcknowledgmentRetryIds(
    limit: number,
    now: Date,
    transaction?: DbClient
  ): Promise<string[]> {
    const rows = await this.getClient(transaction).purchaseToken.findMany({
      where: {
        acknowledgedAt: null,
        acknowledgmentStatus: {
          in: ["PENDING", "FAILED"]
        },
        acknowledgmentNextRetryAt: {
          lte: now
        }
      },
      orderBy: [
        { acknowledgmentNextRetryAt: "asc" },
        { purchaseToken: "asc" }
      ],
      take: limit
    });

    return rows.map((row) => row.purchaseToken);
  }

  async claimPurchaseTokenAcknowledgmentRetry(
    purchaseToken: string,
    now: Date,
    reclaimAt: Date,
    transaction?: DbClient
  ) {
    const client = this.getClient(transaction);
    const claimed = await client.purchaseToken.updateMany({
      where: {
        purchaseToken,
        acknowledgedAt: null,
        acknowledgmentStatus: {
          in: ["PENDING", "FAILED"]
        },
        acknowledgmentNextRetryAt: {
          lte: now
        }
      },
      data: {
        acknowledgmentStatus: "PENDING",
        acknowledgmentLastError: null,
        acknowledgmentNextRetryAt: reclaimAt
      }
    });

    if (claimed.count === 0) {
      return null;
    }

    return client.purchaseToken.findUnique({
      where: {
        purchaseToken
      },
      include: {
        plan: true,
        subscription: {
          include: {
            plan: true
          }
        }
      }
    });
  }

  async listPurchaseTokensForOrganization(
    organizationId: string,
    limit: number,
    cursor: { updatedAt: Date; purchaseToken: string } | null,
    transaction?: DbClient
  ) {
    return this.getClient(transaction).purchaseToken.findMany({
      where: {
        organizationId,
        ...(cursor
          ? {
              OR: [
                {
                  updatedAt: {
                    lt: cursor.updatedAt
                  }
                },
                {
                  updatedAt: cursor.updatedAt,
                  purchaseToken: {
                    lt: cursor.purchaseToken
                  }
                }
              ]
            }
          : {})
      },
      include: {
        plan: true,
        subscription: {
          include: {
            plan: true
          }
        }
      },
      orderBy: [
        { updatedAt: "desc" },
        { purchaseToken: "desc" }
      ],
      take: limit
    });
  }

  async updateSubscriptionStatusByExternalId(
    provider: BillingProvider,
    externalSubscriptionId: string,
    status: SubscriptionStatus,
    transaction?: DbClient
  ) {
    return this.getClient(transaction).subscription.updateMany({
      where: {
        provider,
        externalSubscriptionId
      },
      data: {
        status
      }
    });
  }

  async setSubscriptionConflictFlags(
    organizationId: string,
    conflictingSubscriptionIds: string[],
    transaction?: DbClient
  ): Promise<void> {
    const client = this.getClient(transaction);

    await client.subscription.updateMany({
      where: {
        organizationId
      },
      data: {
        conflictFlag: false
      }
    });

    if (conflictingSubscriptionIds.length === 0) {
      return;
    }

    await client.subscription.updateMany({
      where: {
        organizationId,
        id: {
          in: conflictingSubscriptionIds
        }
      },
      data: {
        conflictFlag: true
      }
    });
  }

  async createWebhookEvent(input: CreateWebhookEventInput, transaction?: DbClient) {
    return this.getClient(transaction).webhookEvent.create({
      data: {
        provider: input.provider,
        externalEventId: input.externalEventId,
        payloadJson: input.payloadJson,
        status: input.status ?? WebhookEventStatus.RECEIVED
      }
    });
  }

  async findWebhookEventByProviderExternalId(
    provider: BillingProvider,
    externalEventId: string,
    transaction?: DbClient
  ) {
    return this.getClient(transaction).webhookEvent.findUnique({
      where: {
        provider_externalEventId: {
          provider,
          externalEventId
        }
      }
    });
  }

  async findWebhookEventById(id: string, transaction?: DbClient) {
    return this.getClient(transaction).webhookEvent.findUnique({
      where: {
        id
      }
    });
  }

  async claimWebhookEvent(
    eventId: string,
    now: Date,
    lockToken: string,
    staleBefore: Date,
    transaction?: DbClient
  ) {
    const client = this.getClient(transaction);
    const claimed = await client.webhookEvent.updateMany({
      where: {
        id: eventId,
        OR: [
          {
            status: {
              in: [WebhookEventStatus.RECEIVED, WebhookEventStatus.FAILED]
            },
            OR: [
              {
                nextRetryAt: null
              },
              {
                nextRetryAt: {
                  lte: now
                }
              }
            ]
          },
          {
            status: WebhookEventStatus.PROCESSING,
            lockedAt: {
              lte: staleBefore
            }
          }
        ]
      },
      data: {
        status: WebhookEventStatus.PROCESSING,
        lockedAt: now,
        lockToken,
        lastError: null,
        nextRetryAt: null,
        attemptCount: {
          increment: 1
        }
      }
    });

    if (claimed.count === 0) {
      return null;
    }

    return client.webhookEvent.findUnique({
      where: {
        id: eventId
      }
    });
  }

  async markWebhookProcessed(
    eventId: string,
    lockToken: string,
    processedAt: Date,
    transaction?: DbClient
  ): Promise<void> {
    await this.getClient(transaction).webhookEvent.updateMany({
      where: {
        id: eventId,
        lockToken
      },
      data: {
        status: WebhookEventStatus.PROCESSED,
        processedAt,
        lockedAt: null,
        lockToken: null,
        lastError: null,
        nextRetryAt: null
      }
    });
  }

  async markWebhookFailed(
    eventId: string,
    lockToken: string,
    lastError: string,
    nextRetryAt: Date,
    transaction?: DbClient
  ): Promise<void> {
    await this.getClient(transaction).webhookEvent.updateMany({
      where: {
        id: eventId,
        lockToken
      },
      data: {
        status: WebhookEventStatus.FAILED,
        lastError,
        nextRetryAt,
        lockedAt: null,
        lockToken: null
      }
    });
  }

  async listRetryableWebhookEventIds(
    limit: number,
    now: Date,
    staleBefore: Date,
    transaction?: DbClient
  ): Promise<string[]> {
    const rows = await this.getClient(transaction).webhookEvent.findMany({
      where: {
        OR: [
          {
            status: {
              in: [WebhookEventStatus.RECEIVED, WebhookEventStatus.FAILED]
            },
            OR: [
              {
                nextRetryAt: null
              },
              {
                nextRetryAt: {
                  lte: now
                }
              }
            ]
          },
          {
            status: WebhookEventStatus.PROCESSING,
            lockedAt: {
              lte: staleBefore
            }
          }
        ]
      },
      orderBy: [
        { receivedAt: "asc" },
        { id: "asc" }
      ],
      take: limit
    });

    return rows.map((row) => row.id);
  }

  private getClient(transaction?: DbClient): DbClient {
    return transaction ?? this.prisma;
  }
}
