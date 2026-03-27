import {
  OrganizationRole,
  OrganizationType,
  Prisma,
  PrismaClient,
  type Organization,
  type User
} from "@prisma/client";

import { AppError } from "../../lib/app-error";
import { buildPersonalOrganizationName } from "../../lib/email";
import { decodeCursor, encodeCursor, getPageLimit } from "../../lib/pagination";

type DbClient = PrismaClient | Prisma.TransactionClient;

export class OrganizationService {
  constructor(private readonly prisma: PrismaClient) {}

  async createPersonalOrganizationForUser(
    user: User,
    transaction: DbClient
  ): Promise<Organization> {
    const organization = await transaction.organization.create({
      data: {
        name: buildPersonalOrganizationName(user.primaryEmail),
        type: OrganizationType.PERSONAL,
        ownerUserId: user.id
      }
    });

    await transaction.organizationMember.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        role: OrganizationRole.OWNER
      }
    });

    return organization;
  }

  async getCurrentOrganizationForUser(
    userId: string,
    transaction?: DbClient
  ): Promise<Organization> {
    const client = transaction ?? this.prisma;
    const personalMembership = await client.organizationMember.findFirst({
      where: {
        userId,
        organization: {
          type: OrganizationType.PERSONAL,
          ownerUserId: userId
        }
      },
      include: {
        organization: true
      },
      orderBy: [{ createdAt: "asc" }]
    });

    if (personalMembership) {
      return personalMembership.organization;
    }

    const membership = await client.organizationMember.findFirst({
      where: { userId },
      include: {
        organization: true
      },
      orderBy: [{ createdAt: "asc" }]
    });

    if (!membership) {
      throw new AppError(404, "organization_not_found", "Current organization was not found.");
    }

    return membership.organization;
  }

  async listMembers(
    organizationId: string,
    limit: number | undefined,
    cursor?: string,
    transaction?: DbClient
  ): Promise<{
    items: Array<{
      user_id: string;
      email: string;
      display_name: string | null;
      avatar_url: string | null;
      role: string;
      created_at: string;
    }>;
    next_cursor: string | null;
  }> {
    const client = transaction ?? this.prisma;
    const resolvedLimit = getPageLimit(limit);
    const decodedCursor = decodeCursor<{ createdAt: string; userId: string }>(cursor);

    const members = await client.organizationMember.findMany({
      where: {
        organizationId,
        ...(decodedCursor
          ? {
              OR: [
                {
                  createdAt: {
                    lt: new Date(decodedCursor.createdAt)
                  }
                },
                {
                  createdAt: new Date(decodedCursor.createdAt),
                  userId: {
                    lt: decodedCursor.userId
                  }
                }
              ]
            }
          : {})
      },
      include: {
        user: true
      },
      orderBy: [
        { createdAt: "desc" },
        { userId: "desc" }
      ],
      take: resolvedLimit + 1
    });

    const hasNextPage = members.length > resolvedLimit;
    const pageItems = hasNextPage ? members.slice(0, resolvedLimit) : members;
    const nextItem = pageItems[pageItems.length - 1];

    return {
      items: pageItems.map((member) => ({
        user_id: member.userId,
        email: member.user.primaryEmail,
        display_name: member.user.displayName,
        avatar_url: member.user.avatarUrl,
        role: member.role,
        created_at: member.createdAt.toISOString()
      })),
      next_cursor: hasNextPage && nextItem
        ? encodeCursor({
            createdAt: nextItem.createdAt.toISOString(),
            userId: nextItem.userId
          })
        : null
    };
  }
}
