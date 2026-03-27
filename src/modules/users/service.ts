import { Prisma, PrismaClient, UserStatus } from "@prisma/client";

import { AppError } from "../../lib/app-error";
import { decodeCursor, encodeCursor, getPageLimit } from "../../lib/pagination";

type DbClient = PrismaClient | Prisma.TransactionClient;

export class UserService {
  constructor(private readonly prisma: PrismaClient) {}

  async findActiveUserById(userId: string, transaction?: DbClient) {
    const client = transaction ?? this.prisma;

    return client.user.findFirst({
      where: {
        id: userId,
        deletedAt: null,
        status: {
          not: UserStatus.DELETED
        }
      }
    });
  }

  async findActiveUserByEmail(primaryEmail: string, transaction?: DbClient) {
    const client = transaction ?? this.prisma;

    return client.user.findFirst({
      where: {
        primaryEmail,
        deletedAt: null,
        status: {
          not: UserStatus.DELETED
        }
      }
    });
  }

  async createUser(
    input: {
      primaryEmail: string;
      displayName?: string | null;
      avatarUrl?: string | null;
      emailVerifiedAt?: Date | null;
    },
    transaction: DbClient
  ) {
    return transaction.user.create({
      data: {
        primaryEmail: input.primaryEmail,
        displayName: input.displayName ?? null,
        avatarUrl: input.avatarUrl ?? null,
        emailVerifiedAt: input.emailVerifiedAt ?? null
      }
    });
  }

  async markEmailVerified(userId: string, verifiedAt: Date, transaction?: DbClient) {
    const client = transaction ?? this.prisma;

    return client.user.update({
      where: { id: userId },
      data: {
        emailVerifiedAt: verifiedAt
      }
    });
  }

  async updateProfile(
    userId: string,
    input: { displayName?: string | null; avatarUrl?: string | null }
  ) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {})
      }
    });
  }

  async softDeleteUser(userId: string, deletedAt: Date) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        status: UserStatus.DELETED,
        deletedAt
      }
    });
  }

  async getProfile(userId: string) {
    const user = await this.findActiveUserById(userId);

    if (!user) {
      throw new AppError(404, "user_not_found", "User profile was not found.");
    }

    return this.serializeUser(user);
  }

  async listSessions(userId: string, limit?: number, cursor?: string) {
    const resolvedLimit = getPageLimit(limit);
    const decodedCursor = decodeCursor<{ createdAt: string; id: string }>(cursor);
    const now = new Date();
    const sessions = await this.prisma.session.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: {
          gt: now
        },
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
                  id: {
                    lt: decodedCursor.id
                  }
                }
              ]
            }
          : {})
      },
      include: {
        device: true
      },
      orderBy: [
        { createdAt: "desc" },
        { id: "desc" }
      ],
      take: resolvedLimit + 1
    });

    const hasNextPage = sessions.length > resolvedLimit;
    const pageItems = hasNextPage ? sessions.slice(0, resolvedLimit) : sessions;
    const nextItem = pageItems[pageItems.length - 1];

    return {
      items: pageItems.map((session) => ({
        id: session.id,
        created_at: session.createdAt.toISOString(),
        expires_at: session.expiresAt.toISOString(),
        last_used_at: session.lastUsedAt.toISOString(),
        user_agent: session.userAgent,
        last_ip_country_code: session.lastIpCountryCode,
        revoked_at: session.revokedAt?.toISOString() ?? null,
        device: session.device
          ? {
              id: session.device.id,
              platform: session.device.platform,
              installation_id: session.device.installationId,
              device_name: session.device.deviceName
            }
          : null
      })),
      next_cursor: hasNextPage && nextItem
        ? encodeCursor({
            createdAt: nextItem.createdAt.toISOString(),
            id: nextItem.id
          })
        : null
    };
  }

  async getOwnedSession(userId: string, sessionId: string) {
    const session = await this.prisma.session.findUnique({
      where: {
        id: sessionId
      }
    });

    if (!session || session.userId !== userId) {
      throw new AppError(404, "session_not_found", "Session was not found.");
    }

    return session;
  }

  serializeUser(user: {
    id: string;
    primaryEmail: string;
    displayName: string | null;
    avatarUrl: string | null;
    emailVerifiedAt: Date | null;
    createdAt: Date;
    deletedAt: Date | null;
  }) {
    return {
      id: user.id,
      primary_email: user.primaryEmail,
      display_name: user.displayName,
      avatar_url: user.avatarUrl,
      email_verified_at: user.emailVerifiedAt?.toISOString() ?? null,
      created_at: user.createdAt.toISOString(),
      deleted_at: user.deletedAt?.toISOString() ?? null
    };
  }
}
