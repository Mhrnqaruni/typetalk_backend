import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };
const defaultEnvValues = {
  NODE_ENV: "production",
  APP_ENV: "production",
  HOST: "0.0.0.0",
  PORT: "3000",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:55432/typetalk_test?schema=public",
  JWT_ACCESS_SECRET: "prod_access_secret",
  JWT_REFRESH_SECRET: "prod_refresh_secret",
  JWT_ALGORITHM: "HS256",
  JWT_ACCESS_EXPIRY_MINUTES: "15",
  JWT_REFRESH_EXPIRY_DAYS: "30",
  APP_ENCRYPTION_KEY: "prod_app_encryption_key",
  IP_HASH_KEY_V1: "prod_ip_hash_key",
  GOOGLE_CLIENT_ID: "prod-google-client-id",
  GOOGLE_WEB_CLIENT_ID: "prod-google-web-client-id",
  WEB_AUTH_REFRESH_COOKIE_NAME: "typetalk_refresh",
  PADDLE_API_KEY: "pdl_test_typetalk_prod",
  PADDLE_WEBHOOK_SECRET: "pdlwhsec_typetalk_prod",
  PADDLE_PRICE_ID_PRO_MONTHLY: "pri_paddle_monthly_prod",
  PADDLE_PRICE_ID_PRO_YEARLY: "pri_paddle_yearly_prod",
  PADDLE_ENV: "sandbox",
  BILLING_CHECKOUT_ENABLED: "false",
  BILLING_CUSTOMER_PORTAL_ENABLED: "false",
  STRIPE_SECRET_KEY: "sk_test_typetalk_prod",
  STRIPE_WEBHOOK_SECRET: "whsec_typetalk_prod",
  STRIPE_PRICE_ID_PRO_MONTHLY: "price_typetalk_pro_monthly_prod",
  STRIPE_PRICE_ID_PRO_YEARLY: "price_typetalk_pro_yearly_prod",
  PLAY_PACKAGE_NAME: "app.typetalk.prod",
  PLAY_SERVICE_ACCOUNT_JSON: "{\"client_email\":\"play-prod@typetalk.app\"}",
  PLAY_PUBSUB_AUDIENCE: "https://api.typetalk.app/v1/webhooks/google-play/rtdn",
  PLAY_PUBSUB_SERVICE_ACCOUNT: "pubsub-prod@typetalk.app",
  EMAIL_PROVIDER_MODE: "log",
  EMAIL_PROVIDER_API_KEY: "prod-email-provider-key",
  EMAIL_FROM: "no-reply@typetalk.app",
  OTP_EXPIRY_MINUTES: "10",
  OTP_MAX_ATTEMPTS: "5",
  AUTH_RATE_LIMIT_WINDOW_SECONDS: "600",
  AUTH_REQUEST_CODE_MAX_PER_IP: "5",
  AUTH_VERIFY_CODE_MAX_PER_IP: "10",
  ADMIN_ALLOWLIST_EMAILS: "admin@example.com",
  RAW_IP_RETENTION_HOURS: "24",
  SECURITY_RETENTION_BATCH_SIZE: "500",
  ERROR_TRACKING_ENABLED: "false",
  ERROR_TRACKING_DSN: "",
  MAX_ACTIVE_DEVICES_PER_USER: "10",
  ALLOWED_ORIGINS: "https://typetalk.app,https://www.typetalk.app",
  MAX_JSON_BODY_BYTES: "1048576",
  MAX_WEBHOOK_BODY_BYTES: "524288",
  BILLING_WEBHOOK_RETRY_BATCH_SIZE: "25",
  BILLING_WEBHOOK_RETRY_BASE_DELAY_SECONDS: "60",
  BILLING_WEBHOOK_RETRY_MAX_DELAY_SECONDS: "3600",
  BILLING_WEBHOOK_STALE_LOCK_TIMEOUT_SECONDS: "300"
};

function restoreEnvironment() {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }

  Object.assign(process.env, originalEnv);
}

function createEnvFile(overrides: Record<string, string>) {
  const directory = mkdtempSync(join(tmpdir(), "typetalk-origin-policy-"));
  const filePath = join(directory, ".env.phase8");
  const values = {
    ...defaultEnvValues,
    ...overrides
  };
  const content = Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  writeFileSync(filePath, content);

  return {
    directory,
    filePath
  };
}

async function sendOriginRequest(
  url: string,
  origin: string
): Promise<{ statusCode: number; allowOrigin: string | null; allowCredentials: string | null }> {
  const response = await fetch(url, {
    headers: {
      origin
    }
  });

  return {
    statusCode: response.status,
    allowOrigin: response.headers.get("access-control-allow-origin"),
    allowCredentials: response.headers.get("access-control-allow-credentials")
  };
}

const stubEmailProvider = {
  async sendOtp(): Promise<void> {}
};

afterEach(() => {
  restoreEnvironment();
  vi.resetModules();
});

describe("production origin policy", () => {
  it("allows only the locked production origins", async () => {
    const tempEnv = createEnvFile({});

    try {
      process.env.ENV_FILE = tempEnv.filePath;
      process.env.NODE_ENV = "production";
      vi.resetModules();

      const [{ getConfig }, { buildApp }] = await Promise.all([
        import("../../src/config/env"),
        import("../../src/app")
      ]);

      expect(getConfig().allowedOrigins).toEqual([
        "https://typetalk.app",
        "https://www.typetalk.app"
      ]);

      const app = await buildApp({
        prisma: {} as never,
        emailProvider: stubEmailProvider
      });

      try {
        const baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
        const allowedResponse = await sendOriginRequest(baseUrl, "https://typetalk.app");
        const blockedResponse = await sendOriginRequest(
          baseUrl,
          "https://preview-branch.typetalk.vercel.app"
        );

        expect(allowedResponse.statusCode).toBe(200);
        expect(allowedResponse.allowOrigin).toBe("https://typetalk.app");
        expect(allowedResponse.allowCredentials).toBe("true");
        expect(blockedResponse.statusCode).toBe(403);
        expect(blockedResponse.allowOrigin).toBeNull();
        expect(blockedResponse.allowCredentials).toBeNull();
      } finally {
        await app.close();
      }
    } finally {
      rmSync(tempEnv.directory, { recursive: true, force: true });
    }
  });

  it("supports a dedicated staging origin without widening production previews", async () => {
    const tempEnv = createEnvFile({
      ALLOWED_ORIGINS: "https://staging.typetalk.app"
    });

    try {
      process.env.ENV_FILE = tempEnv.filePath;
      process.env.NODE_ENV = "production";
      vi.resetModules();

      const [{ getConfig }, { buildApp }] = await Promise.all([
        import("../../src/config/env"),
        import("../../src/app")
      ]);

      expect(getConfig().allowedOrigins).toEqual([
        "https://staging.typetalk.app"
      ]);

      const app = await buildApp({
        prisma: {} as never,
        emailProvider: stubEmailProvider
      });

      try {
        const baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
        const stagingResponse = await sendOriginRequest(baseUrl, "https://staging.typetalk.app");
        const previewResponse = await sendOriginRequest(
          baseUrl,
          "https://preview-branch.typetalk.vercel.app"
        );

        expect(stagingResponse.statusCode).toBe(200);
        expect(stagingResponse.allowOrigin).toBe("https://staging.typetalk.app");
        expect(stagingResponse.allowCredentials).toBe("true");
        expect(previewResponse.statusCode).toBe(403);
        expect(previewResponse.allowOrigin).toBeNull();
        expect(previewResponse.allowCredentials).toBeNull();
      } finally {
        await app.close();
      }
    } finally {
      rmSync(tempEnv.directory, { recursive: true, force: true });
    }
  });

  it("ignores default .env.local overrides in production", async () => {
    const directory = mkdtempSync(join(tmpdir(), "typetalk-production-env-"));
    const originalWorkingDirectory = process.cwd();

    writeFileSync(
      join(directory, ".env.local"),
      [
        "HOST=127.0.0.1",
        "PORT=3000",
        "ALLOWED_ORIGINS=http://localhost:3000"
      ].join("\n")
    );

    try {
      process.chdir(directory);
      delete process.env.ENV_FILE;
      Object.assign(process.env, defaultEnvValues);
      vi.resetModules();

      const { getConfig } = await import("../../src/config/env");

      expect(getConfig().host).toBe("0.0.0.0");
      expect(getConfig().allowedOrigins).toEqual([
        "https://typetalk.app",
        "https://www.typetalk.app"
      ]);
    } finally {
      process.chdir(originalWorkingDirectory);
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
