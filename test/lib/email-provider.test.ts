import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../../src/config/env";
import { createEmailProvider, LoggingEmailProvider, ResendEmailProvider } from "../../src/lib/email-provider";

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: "development",
    appEnv: "local",
    host: "127.0.0.1",
    port: 3000,
    databaseUrl: "postgresql://postgres@127.0.0.1:55432/typetalk_dev?schema=public",
    jwtAccessSecret: "access",
    jwtRefreshSecret: "refresh",
    jwtAlgorithm: "HS256",
    jwtAccessExpiryMinutes: 15,
    jwtRefreshExpiryDays: 30,
    appEncryptionKey: "app-key",
    ipHashKeyV1: "ip-key",
    googleClientId: "google-client-id",
    paddleApiKey: "pdl_test_typetalk",
    paddleWebhookSecret: "pdlwhsec_typetalk",
    paddlePriceIdProMonthly: "pri_monthly",
    paddlePriceIdProYearly: "pri_yearly",
    paddleEnvironment: "sandbox",
    billingCheckoutEnabled: false,
    billingCustomerPortalEnabled: false,
    stripeSecretKey: "sk_test_typetalk",
    stripeWebhookSecret: "whsec_typetalk",
    stripePriceIdProMonthly: "price_monthly",
    stripePriceIdProYearly: "price_yearly",
    playPackageName: "app.typetalk.test",
    playServiceAccountJson: "{\"client_email\":\"play-test@typetalk.test\"}",
    playPubsubAudience: "https://api.typetalk.test/v1/webhooks/google-play/rtdn",
    playPubsubServiceAccount: "pubsub-test@typetalk.test",
    emailProviderMode: "resend",
    emailProviderApiKey: "resend-key",
    emailFrom: "no-reply@typetalk.test",
    otpExpiryMinutes: 10,
    otpMaxAttempts: 5,
    authRateLimitWindowSeconds: 600,
    authRequestCodeMaxPerIp: 5,
    authVerifyCodeMaxPerIp: 10,
    adminAllowlistEmails: [],
    rawIpRetentionHours: 24,
    securityRetentionBatchSize: 500,
    errorTrackingEnabled: false,
    errorTrackingDsn: null,
    maxActiveDevicesPerUser: 10,
    allowedOrigins: ["http://localhost:3000"],
    maxJsonBodyBytes: 1_048_576,
    maxWebhookBodyBytes: 524_288,
    billingWebhookRetryBatchSize: 25,
    billingWebhookRetryBaseDelaySeconds: 60,
    billingWebhookRetryMaxDelaySeconds: 3600,
    billingWebhookStaleLockTimeoutSeconds: 300,
    ...overrides
  };
}

describe("email providers", () => {
  it("sends OTP requests through the configured Resend provider", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 202
    } satisfies Partial<Response>);
    const provider = new ResendEmailProvider({
      apiKey: "resend-key",
      from: "no-reply@typetalk.test",
      fetcher: fetcher as unknown as typeof fetch
    });

    await provider.sendOtp({
      email: "person@example.com",
      code: "123456",
      purpose: "SIGN_IN"
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer resend-key"
        })
      })
    );

    const payload = JSON.parse((fetcher.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(payload.from).toBe("no-reply@typetalk.test");
    expect(payload.to).toEqual(["person@example.com"]);
    expect(payload.text).toContain("123456");
  });

  it("refuses to use the logging provider outside tests", () => {
    expect(() => createEmailProvider(createConfig({
      emailProviderMode: "log"
    }))).toThrow("A real email provider must be configured for non-test runtimes.");
  });

  it("uses the logging provider only in test mode", () => {
    const provider = createEmailProvider(createConfig({
      nodeEnv: "test",
      emailProviderMode: "log"
    }));

    expect(provider).toBeInstanceOf(LoggingEmailProvider);
  });
});
