import {
  type BillingProvider,
  PrismaClient,
  type SubscriptionStatus,
  type UsageEventStatus
} from "@prisma/client";

export class AdminRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findUserDetail(userId: string) {
    return this.prisma.user.findUnique({
      where: {
        id: userId
      },
      select: {
        id: true,
        primaryEmail: true,
        displayName: true,
        avatarUrl: true,
        emailVerifiedAt: true,
        createdAt: true,
        deletedAt: true,
        status: true,
        memberships: {
          orderBy: [
            { createdAt: "asc" }
          ],
          select: {
            role: true,
            createdAt: true,
            organization: {
              select: {
                id: true,
                name: true,
                type: true,
                ownerUserId: true,
                createdAt: true,
                entitlements: {
                  select: {
                    code: true,
                    status: true,
                    billingOverlap: true,
                    sourceProvider: true,
                    startsAt: true,
                    endsAt: true,
                    updatedAt: true
                  }
                }
              }
            }
          }
        },
        devices: {
          orderBy: [
            { lastSeenAt: "desc" }
          ],
          take: 10,
          select: {
            id: true,
            platform: true,
            installationId: true,
            deviceName: true,
            osVersion: true,
            appVersion: true,
            locale: true,
            timezone: true,
            lastSeenAt: true,
            createdAt: true
          }
        },
        sessions: {
          orderBy: [
            { createdAt: "desc" }
          ],
          take: 10,
          select: {
            id: true,
            deviceId: true,
            userAgent: true,
            lastIpCountryCode: true,
            lastUsedAt: true,
            expiresAt: true,
            revokedAt: true,
            reauthenticatedAt: true,
            createdAt: true,
            device: {
              select: {
                id: true,
                platform: true,
                installationId: true,
                deviceName: true
              }
            }
          }
        },
        securityEvents: {
          orderBy: [
            { createdAt: "desc" }
          ],
          take: 20,
          select: {
            id: true,
            eventType: true,
            severity: true,
            ipHash: true,
            createdAt: true
          }
        },
        ipObservations: {
          orderBy: [
            { createdAt: "desc" }
          ],
          take: 20,
          select: {
            id: true,
            ipHash: true,
            hashKeyVersion: true,
            countryCode: true,
            region: true,
            asn: true,
            source: true,
            rawIpExpiresAt: true,
            createdAt: true
          }
        }
      }
    });
  }

  async listSubscriptions(input: {
    limit: number;
    cursor: { updatedAt: Date; id: string } | null;
    organizationId?: string;
    userId?: string;
    provider?: BillingProvider;
    status?: SubscriptionStatus;
  }) {
    return this.prisma.subscription.findMany({
      where: {
        ...(input.organizationId ? { organizationId: input.organizationId } : {}),
        ...(input.provider ? { provider: input.provider } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.userId
          ? {
              organization: {
                OR: [
                  { ownerUserId: input.userId },
                  {
                    members: {
                      some: {
                        userId: input.userId
                      }
                    }
                  }
                ]
              }
            }
          : {}),
        ...(input.cursor
          ? {
              OR: [
                {
                  updatedAt: {
                    lt: input.cursor.updatedAt
                  }
                },
                {
                  updatedAt: input.cursor.updatedAt,
                  id: {
                    lt: input.cursor.id
                  }
                }
              ]
            }
          : {})
      },
      orderBy: [
        { updatedAt: "desc" },
        { id: "desc" }
      ],
      take: input.limit + 1,
      select: {
        id: true,
        organizationId: true,
        provider: true,
        externalSubscriptionId: true,
        status: true,
        isTrial: true,
        conflictFlag: true,
        trialEndsAt: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        canceledAt: true,
        createdAt: true,
        updatedAt: true,
        plan: {
          select: {
            code: true,
            displayName: true,
            billingInterval: true,
            amountCents: true,
            currency: true,
            trialDays: true
          }
        },
        providerCustomer: {
          select: {
            externalCustomerId: true
          }
        },
        organization: {
          select: {
            id: true,
            name: true,
            type: true,
            ownerUserId: true,
            entitlements: {
              select: {
                code: true,
                status: true,
                billingOverlap: true,
                sourceProvider: true,
                updatedAt: true
              }
            }
          }
        }
      }
    });
  }

  async listUsage(input: {
    limit: number;
    cursor: { occurredAt: Date; id: string } | null;
    organizationId?: string;
    userId?: string;
    featureCode?: string;
    status?: UsageEventStatus;
  }) {
    return this.prisma.usageEvent.findMany({
      where: {
        ...(input.organizationId ? { organizationId: input.organizationId } : {}),
        ...(input.userId ? { userId: input.userId } : {}),
        ...(input.featureCode ? { featureCode: input.featureCode } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.cursor
          ? {
              OR: [
                {
                  occurredAt: {
                    lt: input.cursor.occurredAt
                  }
                },
                {
                  occurredAt: input.cursor.occurredAt,
                  id: {
                    lt: input.cursor.id
                  }
                }
              ]
            }
          : {})
      },
      orderBy: [
        { occurredAt: "desc" },
        { id: "desc" }
      ],
      take: input.limit + 1,
      select: {
        id: true,
        organizationId: true,
        userId: true,
        deviceId: true,
        realtimeSessionId: true,
        featureCode: true,
        provider: true,
        wordCount: true,
        audioSeconds: true,
        requestCount: true,
        status: true,
        occurredAt: true,
        createdAt: true,
        organization: {
          select: {
            id: true,
            name: true,
            type: true
          }
        },
        user: {
          select: {
            id: true,
            primaryEmail: true
          }
        },
        device: {
          select: {
            id: true,
            platform: true,
            installationId: true,
            deviceName: true
          }
        }
      }
    });
  }
}
