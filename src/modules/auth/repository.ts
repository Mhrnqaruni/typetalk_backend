import {
  AuthProvider,
  ChallengePurpose,
  Prisma,
  PrismaClient,
  type Session
} from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export class AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async countRecentChallenges(
    email: string,
    purpose: ChallengePurpose,
    since: Date,
    transaction?: DbClient
  ): Promise<number> {
    const client = transaction ?? this.prisma;

    return client.emailChallenge.count({
      where: {
        email,
        purpose,
        createdAt: {
          gte: since
        }
      }
    });
  }

  async supersedeActiveChallenges(
    email: string,
    purpose: ChallengePurpose,
    supersededAt: Date,
    transaction?: DbClient
  ) {
    const client = transaction ?? this.prisma;

    await client.emailChallenge.updateMany({
      where: {
        email,
        purpose,
        usedAt: null,
        supersededAt: null
      },
      data: {
        supersededAt
      }
    });
  }

  async createEmailChallenge(
    input: {
      email: string;
      purpose: ChallengePurpose;
      codeHash: string;
      requestedIpHash?: string | null;
      maxAttempts: number;
      expiresAt: Date;
    },
    transaction?: DbClient
  ) {
    const client = transaction ?? this.prisma;

    return client.emailChallenge.create({
      data: {
        email: input.email,
        purpose: input.purpose,
        codeHash: input.codeHash,
        requestedIpHash: input.requestedIpHash ?? null,
        maxAttempts: input.maxAttempts,
        expiresAt: input.expiresAt
      }
    });
  }

  async findLatestActiveChallenge(
    email: string,
    purpose: ChallengePurpose,
    transaction?: DbClient
  ) {
    const client = transaction ?? this.prisma;

    return client.emailChallenge.findFirst({
      where: {
        email,
        purpose,
        usedAt: null,
        supersededAt: null
      },
      orderBy: [{ createdAt: "desc" }]
    });
  }

  async incrementChallengeAttempts(challengeId: string, transaction?: DbClient) {
    const client = transaction ?? this.prisma;

    return client.emailChallenge.update({
      where: { id: challengeId },
      data: {
        attemptCount: {
          increment: 1
        }
      }
    });
  }

  async incrementChallengeAttemptsIfActive(
    challengeId: string,
    activeAt: Date,
    transaction: DbClient
  ) {
    const updateResult = await transaction.emailChallenge.updateMany({
      where: {
        id: challengeId,
        usedAt: null,
        supersededAt: null,
        expiresAt: {
          gt: activeAt
        }
      },
      data: {
        attemptCount: {
          increment: 1
        }
      }
    });

    if (updateResult.count !== 1) {
      return null;
    }

    return transaction.emailChallenge.findUnique({
      where: {
        id: challengeId
      }
    });
  }

  async markChallengeUsed(challengeId: string, usedAt: Date, transaction?: DbClient) {
    const client = transaction ?? this.prisma;

    return client.emailChallenge.update({
      where: { id: challengeId },
      data: { usedAt }
    });
  }

  async findGoogleIdentity(providerUserId: string, transaction?: DbClient) {
    const client = transaction ?? this.prisma;

    return client.authIdentity.findUnique({
      where: {
        provider_providerUserId: {
          provider: AuthProvider.GOOGLE,
          providerUserId
        }
      },
      include: {
        user: true
      }
    });
  }

  async consumeActiveChallenge(
    challengeId: string,
    usedAt: Date,
    transaction: DbClient
  ): Promise<boolean> {
    const updateResult = await transaction.emailChallenge.updateMany({
      where: {
        id: challengeId,
        usedAt: null,
        supersededAt: null,
        expiresAt: {
          gt: usedAt
        }
      },
      data: {
        usedAt
      }
    });

    return updateResult.count === 1;
  }

  async createGoogleIdentity(
    userId: string,
    providerUserId: string,
    providerEmail: string | null,
    transaction: DbClient
  ) {
    return transaction.authIdentity.create({
      data: {
        userId,
        provider: AuthProvider.GOOGLE,
        providerUserId,
        providerEmail
      }
    });
  }

  async createSession(
    input: {
      userId: string;
      deviceId?: string | null;
      refreshTokenHash: string;
      userAgent?: string | null;
      lastIpHash?: string | null;
      lastIpCountryCode?: string | null;
      expiresAt: Date;
      reauthenticatedAt?: Date | null;
    },
    transaction: DbClient
  ): Promise<Session> {
    return transaction.session.create({
      data: {
        userId: input.userId,
        deviceId: input.deviceId ?? null,
        refreshTokenHash: input.refreshTokenHash,
        userAgent: input.userAgent ?? null,
        lastIpHash: input.lastIpHash ?? null,
        lastIpCountryCode: input.lastIpCountryCode ?? null,
        lastUsedAt: new Date(),
        expiresAt: input.expiresAt,
        reauthenticatedAt: input.reauthenticatedAt ?? null
      }
    });
  }

  async findSessionById(sessionId: string, transaction?: DbClient) {
    const client = transaction ?? this.prisma;

    return client.session.findUnique({
      where: { id: sessionId },
      include: {
        user: true
      }
    });
  }

  async updateSession(
    sessionId: string,
    data: Prisma.SessionUpdateInput,
    transaction?: DbClient
  ) {
    const client = transaction ?? this.prisma;

    return client.session.update({
      where: { id: sessionId },
      data
    });
  }

  async rotateSessionRefreshToken(
    input: {
      sessionId: string;
      currentRefreshTokenHash: string;
      nextRefreshTokenHash: string;
      lastUsedAt: Date;
      lastIpHash: string | null;
      lastIpCountryCode: string | null;
      userAgent: string | null;
    },
    transaction: DbClient
  ): Promise<Session | null> {
    const updateResult = await transaction.session.updateMany({
      where: {
        id: input.sessionId,
        revokedAt: null,
        refreshTokenHash: input.currentRefreshTokenHash
      },
      data: {
        refreshTokenHash: input.nextRefreshTokenHash,
        lastUsedAt: input.lastUsedAt,
        lastIpHash: input.lastIpHash,
        lastIpCountryCode: input.lastIpCountryCode,
        userAgent: input.userAgent
      }
    });

    if (updateResult.count !== 1) {
      return null;
    }

    return transaction.session.findUnique({
      where: {
        id: input.sessionId
      }
    });
  }

  async revokeSession(sessionId: string, revokedAt: Date, transaction?: DbClient) {
    const client = transaction ?? this.prisma;

    return client.session.update({
      where: { id: sessionId },
      data: {
        revokedAt
      }
    });
  }

  async revokeSessionsForUser(userId: string, revokedAt: Date, transaction?: DbClient) {
    const client = transaction ?? this.prisma;

    return client.session.updateMany({
      where: {
        userId,
        revokedAt: null
      },
      data: {
        revokedAt
      }
    });
  }

  async revokeSessionsForDevice(
    userId: string,
    deviceId: string,
    revokedAt: Date,
    transaction?: DbClient
  ) {
    const client = transaction ?? this.prisma;

    return client.session.updateMany({
      where: {
        userId,
        deviceId,
        revokedAt: null
      },
      data: {
        revokedAt
      }
    });
  }
}
