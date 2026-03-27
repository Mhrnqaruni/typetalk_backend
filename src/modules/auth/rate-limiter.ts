import { type AppConfig } from "../../config/env";
import { AppError } from "../../lib/app-error";

interface AuthRateLimiterOptions {
  windowMs: number;
  requestCodeMaxPerIp: number;
  verifyCodeMaxPerIp: number;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export class AuthRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>();

  constructor(
    private readonly options: AuthRateLimiterOptions,
    private readonly now: () => number = () => Date.now()
  ) {}

  assertCanRequestCode(ipAddress?: string | null): void {
    this.consume("auth_email_request", ipAddress, this.options.requestCodeMaxPerIp);
  }

  assertCanVerifyCode(ipAddress?: string | null): void {
    this.consume("auth_email_verify", ipAddress, this.options.verifyCodeMaxPerIp);
  }

  reset(): void {
    this.buckets.clear();
  }

  private consume(scope: string, ipAddress: string | null | undefined, limit: number): void {
    if (!ipAddress) {
      return;
    }

    const now = this.now();
    const key = `${scope}:${ipAddress}`;
    const existingBucket = this.buckets.get(key);

    if (!existingBucket || existingBucket.resetAt <= now) {
      this.buckets.set(key, {
        count: 1,
        resetAt: now + this.options.windowMs
      });
      this.pruneExpired(now);
      return;
    }

    if (existingBucket.count >= limit) {
      throw new AppError(429, "rate_limited", "Too many auth requests from this IP. Try again later.");
    }

    existingBucket.count += 1;
    this.buckets.set(key, existingBucket);
  }

  private pruneExpired(now: number): void {
    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }
}

export function createAuthRateLimiter(config: AppConfig): AuthRateLimiter {
  return new AuthRateLimiter({
    windowMs: config.authRateLimitWindowSeconds * 1000,
    requestCodeMaxPerIp: config.authRequestCodeMaxPerIp,
    verifyCodeMaxPerIp: config.authVerifyCodeMaxPerIp
  });
}
