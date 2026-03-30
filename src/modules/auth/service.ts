import {
  ChallengePurpose,
  Prisma,
  PrismaClient
} from "@prisma/client";

import { AppError } from "../../lib/app-error";
import { hashIpAddress, hashOtpCode, hashRefreshSecret, hashesMatch, generateOpaqueSecret } from "../../lib/crypto";
import { normalizeEmail } from "../../lib/email";
import type { EmailProvider } from "../../lib/email-provider";
import type { RequestMetadata } from "../../lib/request-metadata";
import { buildRefreshToken, issueAccessToken, parseRefreshToken, verifyAccessToken } from "../../lib/tokens";
import { getConfig, type AppConfig } from "../../config/env";
import { DeviceService } from "../devices/service";
import type { DeviceInput } from "../devices/schemas";
import { OrganizationService } from "../organizations/service";
import { SecurityService } from "../security/service";
import { UserService } from "../users/service";
import { type GoogleVerifier } from "./google";
import { createOtpChallenge } from "./otp";
import { AuthRepository } from "./repository";

export interface AuthContext {
  userId: string;
  sessionId: string;
  organizationId: string;
  user: {
    id: string;
    primaryEmail: string;
    displayName: string | null;
    avatarUrl: string | null;
    emailVerifiedAt: Date | null;
    createdAt: Date;
    deletedAt: Date | null;
  };
  session: {
    id: string;
    deviceId: string | null;
    expiresAt: Date;
    revokedAt: Date | null;
    reauthenticatedAt: Date | null;
  };
}

export class AuthService {
  private readonly config: AppConfig;
  private readonly inFlightRefreshes = new Set<string>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly repository: AuthRepository,
    private readonly deviceService: DeviceService,
    private readonly userService: UserService,
    private readonly organizationService: OrganizationService,
    private readonly securityService: SecurityService,
    private readonly emailProvider: EmailProvider,
    private readonly googleVerifier: GoogleVerifier
  ) {
    this.config = getConfig();
  }

  async requestEmailCode(
    input: { email: string; purpose?: ChallengePurpose },
    metadata: RequestMetadata
  ): Promise<void> {
    const email = normalizeEmail(input.email);
    const purpose = input.purpose ?? ChallengePurpose.SIGN_IN;
    const otpCode = await this.issueEmailChallenge(email, purpose, metadata);
    await this.emailProvider.sendOtp({
      email,
      code: otpCode,
      purpose
    });
  }

  async resendEmailCode(
    input: { email: string; purpose?: ChallengePurpose },
    metadata: RequestMetadata
  ): Promise<void> {
    await this.requestEmailCode(input, metadata);
  }

  async verifyEmailCode(
    input: {
      email: string;
      code: string;
      purpose?: ChallengePurpose;
      device?: DeviceInput;
    },
    metadata: RequestMetadata
  ) {
    const email = normalizeEmail(input.email);
    const purpose = input.purpose ?? ChallengePurpose.SIGN_IN;
    const submittedCodeHash = hashOtpCode(input.code, this.config.appEncryptionKey);
    const result = await this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      const challenge = await this.repository.findLatestActiveChallenge(email, purpose, transaction);

      if (!challenge) {
        return {
          ok: false as const,
          error: new AppError(401, "invalid_otp", "OTP challenge was not found."),
          lockedChallenge: null
        };
      }

      if (challenge.expiresAt <= now) {
        return {
          ok: false as const,
          error: new AppError(401, "expired_otp", "OTP has expired."),
          lockedChallenge: null
        };
      }

      if (challenge.attemptCount >= challenge.maxAttempts) {
        return {
          ok: false as const,
          error: new AppError(429, "otp_locked", "OTP verification attempts exceeded."),
          lockedChallenge: null
        };
      }

      if (!hashesMatch(submittedCodeHash, challenge.codeHash)) {
        const updatedChallenge = await this.repository.incrementChallengeAttemptsIfActive(
          challenge.id,
          now,
          transaction
        );

        if (!updatedChallenge) {
          return {
            ok: false as const,
            error: new AppError(401, "invalid_otp", "OTP challenge was not found."),
            lockedChallenge: null
          };
        }

        if (updatedChallenge.attemptCount >= updatedChallenge.maxAttempts) {
          return {
            ok: false as const,
            error: new AppError(429, "otp_locked", "OTP verification attempts exceeded."),
            lockedChallenge: {
              id: updatedChallenge.id,
              purpose,
              attemptCount: updatedChallenge.attemptCount,
              maxAttempts: updatedChallenge.maxAttempts
            }
          };
        }

        return {
          ok: false as const,
          error: new AppError(401, "invalid_otp", "OTP code is invalid."),
          lockedChallenge: null
        };
      }

      const challengeConsumed = await this.repository.consumeActiveChallenge(
        challenge.id,
        now,
        transaction
      );

      if (!challengeConsumed) {
        return {
          ok: false as const,
          error: new AppError(401, "invalid_otp", "OTP challenge was already used."),
          lockedChallenge: null
        };
      }

      let user = await this.userService.findActiveUserByEmail(email, transaction);

      if (!user) {
        user = await this.userService.createUser(
          {
            primaryEmail: email,
            emailVerifiedAt: now
          },
          transaction
        );
        await this.organizationService.createPersonalOrganizationForUser(user, transaction);
      } else if (!user.emailVerifiedAt) {
        user = await this.userService.markEmailVerified(user.id, now, transaction);
      }

      return {
        ok: true as const,
        value: await this.issueSessionForUser(
        user.id,
        {
          device: input.device,
          metadata,
          reauthenticatedAt: now
        },
        transaction
        )
      };
    });

    if (!result.ok) {
      if (result.lockedChallenge) {
        await this.securityService.recordOtpChallengeLocked({
          challengeId: result.lockedChallenge.id,
          purpose: result.lockedChallenge.purpose,
          attemptCount: result.lockedChallenge.attemptCount,
          maxAttempts: result.lockedChallenge.maxAttempts,
          ipAddress: metadata.ipAddress,
          countryCode: metadata.ipCountryCode
        });
      }

      throw result.error;
    }

    return result.value;
  }

  async signInWithGoogle(
    input: {
      idToken: string;
      device?: DeviceInput;
    },
    metadata: RequestMetadata
  ) {
    const googleProfile = await this.googleVerifier.verifyIdToken(input.idToken);

    if (!googleProfile.emailVerified) {
      throw new AppError(401, "google_email_unverified", "Google email must be verified.");
    }

    const normalizedEmail = normalizeEmail(googleProfile.email);
    const now = new Date();
    const existingIdentity = await this.repository.findGoogleIdentity(googleProfile.sub);

    if (existingIdentity) {
      if (existingIdentity.user.deletedAt || existingIdentity.user.status === "DELETED") {
        throw new AppError(401, "user_deleted", "User account is not active.");
      }

      return this.prisma.$transaction(async (transaction) => this.issueSessionForUser(
        existingIdentity.userId,
        {
          device: input.device,
          metadata,
          reauthenticatedAt: now
        },
        transaction
      ));
    }

    const existingUser = await this.userService.findActiveUserByEmail(normalizedEmail);

    if (existingUser) {
      throw new AppError(
        409,
        "google_link_required",
        "Google account must be linked explicitly before it can sign in."
      );
    }

    return this.prisma.$transaction(async (transaction) => {
      const user = await this.userService.createUser(
        {
          primaryEmail: normalizedEmail,
          displayName: googleProfile.name,
          avatarUrl: googleProfile.picture,
          emailVerifiedAt: now
        },
        transaction
      );
      await this.organizationService.createPersonalOrganizationForUser(user, transaction);
      await this.repository.createGoogleIdentity(
        user.id,
        googleProfile.sub,
        normalizedEmail,
        transaction
      );

      return this.issueSessionForUser(
        user.id,
        {
          device: input.device,
          metadata,
          reauthenticatedAt: now
        },
        transaction
      );
    });
  }

  async linkGoogle(
    context: AuthContext,
    input: { idToken: string }
  ) {
    const reauthenticatedAt = context.session.reauthenticatedAt;

    if (!reauthenticatedAt || Date.now() - reauthenticatedAt.getTime() > 10 * 60_000) {
      throw new AppError(403, "reauth_required", "Recent re-authentication is required.");
    }

    const googleProfile = await this.googleVerifier.verifyIdToken(input.idToken);

    if (!googleProfile.emailVerified) {
      throw new AppError(401, "google_email_unverified", "Google email must be verified.");
    }

    const normalizedEmail = normalizeEmail(googleProfile.email);
    const existingIdentity = await this.repository.findGoogleIdentity(googleProfile.sub);

    if (existingIdentity && existingIdentity.userId !== context.userId) {
      throw new AppError(409, "google_identity_conflict", "Google account is already linked to another user.");
    }

    if (existingIdentity && existingIdentity.userId === context.userId) {
      return {
        linked: true
      };
    }

    const existingEmailUser = await this.userService.findActiveUserByEmail(normalizedEmail);

    if (existingEmailUser && existingEmailUser.id !== context.userId) {
      throw new AppError(409, "google_email_conflict", "Google email belongs to another user.");
    }

    await this.prisma.$transaction(async (transaction) => {
      await this.repository.createGoogleIdentity(
        context.userId,
        googleProfile.sub,
        normalizedEmail,
        transaction
      );
    });

    return {
      linked: true
    };
  }

  async refreshSession(refreshToken: string, metadata: RequestMetadata) {
    const parsedToken = parseRefreshToken(refreshToken);

    if (!parsedToken) {
      throw new AppError(401, "invalid_refresh_token", "Refresh token is invalid.");
    }

    const requestStartedAt = new Date();
    const submittedHash = hashRefreshSecret(parsedToken.secret, this.config.jwtRefreshSecret);
    const refreshFlightKey = `${parsedToken.sessionId}:${submittedHash}`;

    if (!this.acquireRefreshFlight(refreshFlightKey)) {
      throw new AppError(409, "refresh_conflict", "Refresh token was already rotated by another request.");
    }

    const nextRefreshSecret = generateOpaqueSecret();
    const nextRefreshHash = hashRefreshSecret(nextRefreshSecret, this.config.jwtRefreshSecret);
    const resolvedMetadata = {
      lastUsedAt: new Date(),
      lastIpHash: this.hashIp(metadata.ipAddress),
      lastIpCountryCode: this.normalizeCountryCode(metadata.ipCountryCode),
      userAgent: metadata.userAgent ?? null
    };

    try {
      const authResult = await this.prisma.$transaction(async (transaction) => {
        const session = await this.repository.findSessionById(parsedToken.sessionId, transaction);

        if (!session) {
          return {
            ok: false as const,
            error: new AppError(401, "invalid_refresh_token", "Refresh token is invalid.")
          };
        }

        if (session.revokedAt) {
          return {
            ok: false as const,
            error: new AppError(401, "invalid_refresh_token", "Refresh session has been revoked.")
          };
        }

        if (session.expiresAt <= requestStartedAt) {
          await this.repository.revokeSession(session.id, requestStartedAt, transaction);
          return {
            ok: false as const,
            error: new AppError(401, "expired_refresh_token", "Refresh session has expired.")
          };
        }

        if (!hashesMatch(submittedHash, session.refreshTokenHash)) {
          return this.resolveRefreshMismatch(session, metadata, requestStartedAt, transaction);
        }

        const updatedSession = await this.repository.rotateSessionRefreshToken(
          {
            sessionId: session.id,
            currentRefreshTokenHash: submittedHash,
            nextRefreshTokenHash: nextRefreshHash,
            ...resolvedMetadata
          },
          transaction
        );

        if (!updatedSession) {
          const currentSession = await this.repository.findSessionById(session.id, transaction);

          if (!currentSession) {
            return {
              ok: false as const,
              error: new AppError(401, "invalid_refresh_token", "Refresh token is invalid.")
            };
          }

          if (currentSession.revokedAt) {
            return {
              ok: false as const,
              error: new AppError(401, "invalid_refresh_token", "Refresh session has been revoked.")
            };
          }

          if (currentSession.expiresAt <= requestStartedAt) {
            return {
              ok: false as const,
              error: new AppError(401, "expired_refresh_token", "Refresh session has expired.")
            };
          }

          return this.resolveRefreshMismatch(currentSession, metadata, requestStartedAt, transaction);
        }

        const user = await this.userService.findActiveUserById(session.userId, transaction);

        if (!user) {
          return {
            ok: false as const,
            error: new AppError(401, "user_not_found", "User account is not active.")
          };
        }

        const currentOrganization = await this.organizationService.getCurrentOrganizationForUser(user.id, transaction);

        return {
          ok: true as const,
          value: {
            user,
            organizationId: currentOrganization.id,
            session: updatedSession,
            refreshSecret: nextRefreshSecret
          }
        };
      });

      if (!authResult.ok) {
        throw authResult.error;
      }

      return this.buildAuthResponse(authResult.value);
    } finally {
      this.releaseRefreshFlight(refreshFlightKey);
    }
  }

  async revokeSession(sessionId: string) {
    await this.repository.revokeSession(sessionId, new Date());
  }

  async revokeAllSessionsForUser(userId: string) {
    await this.repository.revokeSessionsForUser(userId, new Date());
  }

  async authenticateAccessToken(token: string): Promise<AuthContext> {
    const payload = verifyAccessToken(token, {
      secret: this.config.jwtAccessSecret,
      algorithm: this.config.jwtAlgorithm
    });
    const session = await this.repository.findSessionById(payload.sid);

    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new AppError(401, "invalid_access_token", "Access session is invalid.");
    }

    const user = await this.userService.findActiveUserById(payload.sub);

    if (!user) {
      throw new AppError(401, "user_not_found", "User account is not active.");
    }

    const currentOrganization = await this.organizationService.getCurrentOrganizationForUser(user.id);

    return {
      userId: user.id,
      sessionId: session.id,
      organizationId: currentOrganization.id,
      user,
      session: {
        id: session.id,
        deviceId: session.deviceId,
        expiresAt: session.expiresAt,
        revokedAt: session.revokedAt,
        reauthenticatedAt: session.reauthenticatedAt
      }
    };
  }

  private async issueSessionForUser(
    userId: string,
    input: {
      device?: DeviceInput;
      metadata: RequestMetadata;
      reauthenticatedAt: Date;
    },
    transaction: Prisma.TransactionClient
  ) {
    const refreshSecret = generateOpaqueSecret();
    const refreshTokenHash = hashRefreshSecret(refreshSecret, this.config.jwtRefreshSecret);
    const device = await this.deviceService.upsertDeviceForUser(userId, input.device, transaction);
    const deviceId = device?.id ?? null;

    const session = await this.repository.createSession(
      {
        userId,
        deviceId,
        refreshTokenHash,
        userAgent: input.metadata.userAgent ?? null,
        lastIpHash: this.hashIp(input.metadata.ipAddress),
        lastIpCountryCode: this.normalizeCountryCode(input.metadata.ipCountryCode),
        expiresAt: new Date(Date.now() + this.config.jwtRefreshExpiryDays * 24 * 60 * 60 * 1000),
        reauthenticatedAt: input.reauthenticatedAt
      },
      transaction
    );
    const user = await this.userService.findActiveUserById(userId, transaction);

    if (!user) {
      throw new AppError(404, "user_not_found", "User account was not found.");
    }

    const organization = await this.organizationService.getCurrentOrganizationForUser(userId, transaction);

    return this.buildAuthResponse({
      user,
      organizationId: organization.id,
      session,
      refreshSecret
    });
  }

  private buildAuthResponse(input: {
    user: {
      id: string;
      primaryEmail: string;
      displayName: string | null;
      avatarUrl: string | null;
      emailVerifiedAt: Date | null;
      createdAt: Date;
      deletedAt: Date | null;
    };
    organizationId: string;
    session: {
      id: string;
      expiresAt: Date;
      createdAt: Date;
      deviceId: string | null;
      lastUsedAt: Date;
      reauthenticatedAt: Date | null;
    };
    refreshSecret: string;
  }) {
    const accessToken = issueAccessToken(
      {
        sub: input.user.id,
        sid: input.session.id,
        type: "access"
      },
      {
        secret: this.config.jwtAccessSecret,
        algorithm: this.config.jwtAlgorithm,
        expiresInMinutes: this.config.jwtAccessExpiryMinutes
      }
    );

    return {
      access_token: accessToken,
      refresh_token: buildRefreshToken(input.session.id, input.refreshSecret),
      session: {
        id: input.session.id,
        expires_at: input.session.expiresAt.toISOString()
      },
      organization_id: input.organizationId,
      user: this.userService.serializeUser(input.user)
    };
  }

  private hashIp(ipAddress?: string | null): string | null {
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

  private async issueEmailChallenge(
    email: string,
    purpose: ChallengePurpose,
    metadata: RequestMetadata
  ): Promise<string> {
    const retryAttempts = 3;

    for (let attempt = 0; attempt < retryAttempts; attempt += 1) {
      const now = new Date();
      const otpChallenge = createOtpChallenge(this.config.appEncryptionKey);

      try {
        const result = await this.prisma.$transaction(async (transaction) => {
          const recentChallengeCount = await this.repository.countRecentChallenges(
            email,
            purpose,
            new Date(now.getTime() - this.config.otpExpiryMinutes * 60_000),
            transaction
          );

          if (recentChallengeCount >= this.config.otpMaxAttempts) {
            return {
              ok: false as const,
              recentChallengeCount
            };
          }

          await this.repository.supersedeActiveChallenges(email, purpose, now, transaction);
          await this.repository.createEmailChallenge({
            email,
            purpose,
            codeHash: otpChallenge.codeHash,
            requestedIpHash: this.hashIp(metadata.ipAddress),
            maxAttempts: this.config.otpMaxAttempts,
            expiresAt: new Date(now.getTime() + this.config.otpExpiryMinutes * 60_000)
          }, transaction);

          return {
            ok: true as const
          };
        }, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        });

        if (!result.ok) {
          await this.securityService.recordOtpRequestEmailThrottle({
            purpose,
            recentChallengeCount: result.recentChallengeCount,
            maxAllowed: this.config.otpMaxAttempts,
            ipAddress: metadata.ipAddress,
            countryCode: metadata.ipCountryCode
          });
          throw new AppError(429, "rate_limited", "Too many OTP requests. Try again later.");
        }

        return otpChallenge.code;
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }

        if (this.isRetryableChallengeConflict(error) && attempt < retryAttempts - 1) {
          continue;
        }

        throw error;
      }
    }

    throw new AppError(503, "otp_request_conflict", "Could not issue OTP code. Please try again.");
  }

  private isRetryableChallengeConflict(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError
      && (error.code === "P2002" || error.code === "P2034");
  }

  private async resolveRefreshMismatch(
    session: Awaited<ReturnType<AuthRepository["findSessionById"]>>,
    metadata: RequestMetadata,
    requestStartedAt: Date,
    transaction: Prisma.TransactionClient
  ): Promise<
    | { ok: false; error: AppError }
  > {
    if (!session) {
      return {
        ok: false,
        error: new AppError(401, "invalid_refresh_token", "Refresh token is invalid.")
      };
    }

    if (session.lastUsedAt.getTime() >= requestStartedAt.getTime() && !session.revokedAt) {
      return {
        ok: false,
        error: new AppError(409, "refresh_conflict", "Refresh token was already rotated by another request.")
      };
    }

    const currentOrganization = await this.organizationService.getCurrentOrganizationForUser(session.userId, transaction);
    await this.repository.revokeSession(session.id, requestStartedAt, transaction);
    await this.securityService.recordSuspiciousRefreshReuse(
      {
        organizationId: currentOrganization.id,
        userId: session.userId,
        deviceId: session.deviceId,
        ipHash: this.hashIp(metadata.ipAddress),
        sessionId: session.id
      },
      transaction
    );
    return {
      ok: false,
      error: new AppError(401, "reauth_required", "Suspicious refresh token reuse detected.")
    };
  }

  private acquireRefreshFlight(refreshFlightKey: string): boolean {
    if (this.inFlightRefreshes.has(refreshFlightKey)) {
      return false;
    }

    this.inFlightRefreshes.add(refreshFlightKey);
    return true;
  }

  private releaseRefreshFlight(refreshFlightKey: string): void {
    this.inFlightRefreshes.delete(refreshFlightKey);
  }
}
