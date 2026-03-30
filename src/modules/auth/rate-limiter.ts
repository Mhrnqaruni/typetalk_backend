import { type AppConfig } from "../../config/env";
import { AppError } from "../../lib/app-error";
import { hashIpAddress } from "../../lib/crypto";
import type { RequestMetadata } from "../../lib/request-metadata";
import { SecurityService } from "../security/service";
import { AuthRepository } from "./repository";

interface AuthRateLimiterOptions {
  windowMs: number;
  requestCodeMaxPerIp: number;
  verifyCodeMaxPerIp: number;
  ipHashKey: string;
  repository: AuthRepository;
  securityService: SecurityService;
}

export class AuthRateLimiter {
  constructor(private readonly options: AuthRateLimiterOptions) {}

  async assertCanRequestCode(
    metadata: Pick<RequestMetadata, "ipAddress" | "ipCountryCode">
  ): Promise<void> {
    await this.consume("auth_email_request", metadata, this.options.requestCodeMaxPerIp);
  }

  async assertCanVerifyCode(
    metadata: Pick<RequestMetadata, "ipAddress" | "ipCountryCode">
  ): Promise<void> {
    await this.consume("auth_email_verify", metadata, this.options.verifyCodeMaxPerIp);
  }

  async reset(): Promise<void> {
    await this.options.repository.resetAuthRateLimitBuckets();
  }

  private async consume(
    scope: "auth_email_request" | "auth_email_verify",
    metadata: Pick<RequestMetadata, "ipAddress" | "ipCountryCode">,
    limit: number
  ): Promise<void> {
    if (!metadata.ipAddress) {
      return;
    }

    const now = new Date();
    const windowStart = new Date(
      Math.floor(now.getTime() / this.options.windowMs) * this.options.windowMs
    );
    const ipHash = hashIpAddress(metadata.ipAddress, this.options.ipHashKey);
    const bucket = await this.options.repository.incrementAuthRateLimitBucket({
      scope,
      ipHash,
      windowStart
    });

    if (bucket.hitCount > limit) {
      if (bucket.hitCount === limit + 1) {
        await this.options.securityService.recordAuthRateLimitHit({
          scope,
          ipAddress: metadata.ipAddress,
          countryCode: metadata.ipCountryCode,
          limit,
          hitCount: bucket.hitCount,
          windowStart
        });
      }

      throw new AppError(429, "rate_limited", "Too many auth requests from this IP. Try again later.");
    }
  }
}

export function createAuthRateLimiter(
  config: AppConfig,
  repository: AuthRepository,
  securityService: SecurityService
): AuthRateLimiter {
  return new AuthRateLimiter({
    windowMs: config.authRateLimitWindowSeconds * 1000,
    requestCodeMaxPerIp: config.authRequestCodeMaxPerIp,
    verifyCodeMaxPerIp: config.authVerifyCodeMaxPerIp,
    ipHashKey: config.ipHashKeyV1,
    repository,
    securityService
  });
}
