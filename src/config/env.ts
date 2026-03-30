import { config as loadDotEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.string().default("local"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_ACCESS_SECRET: z.string().min(1, "JWT_ACCESS_SECRET is required"),
  JWT_REFRESH_SECRET: z.string().min(1, "JWT_REFRESH_SECRET is required"),
  JWT_ALGORITHM: z.literal("HS256").default("HS256"),
  JWT_ACCESS_EXPIRY_MINUTES: z.coerce.number().int().positive().default(15),
  JWT_REFRESH_EXPIRY_DAYS: z.coerce.number().int().positive().default(30),
  APP_ENCRYPTION_KEY: z.string().min(1, "APP_ENCRYPTION_KEY is required"),
  IP_HASH_KEY_V1: z.string().min(1, "IP_HASH_KEY_V1 is required"),
  GOOGLE_CLIENT_ID: z.string().min(1, "GOOGLE_CLIENT_ID is required"),
  PADDLE_API_KEY: z.string().min(1, "PADDLE_API_KEY is required"),
  PADDLE_WEBHOOK_SECRET: z.string().min(1, "PADDLE_WEBHOOK_SECRET is required"),
  PADDLE_PRICE_ID_PRO_MONTHLY: z.string().min(1, "PADDLE_PRICE_ID_PRO_MONTHLY is required"),
  PADDLE_PRICE_ID_PRO_YEARLY: z.string().min(1, "PADDLE_PRICE_ID_PRO_YEARLY is required"),
  PADDLE_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  BILLING_CHECKOUT_ENABLED: z.enum(["true", "false"]).default("false")
    .transform((value) => value === "true"),
  BILLING_CUSTOMER_PORTAL_ENABLED: z.enum(["true", "false"]).default("false")
    .transform((value) => value === "true"),
  STRIPE_SECRET_KEY: z.string().trim().optional().transform((value) => value || null),
  STRIPE_WEBHOOK_SECRET: z.string().trim().optional().transform((value) => value || null),
  STRIPE_PRICE_ID_PRO_MONTHLY: z.string().trim().optional().transform((value) => value || null),
  STRIPE_PRICE_ID_PRO_YEARLY: z.string().trim().optional().transform((value) => value || null),
  PLAY_PACKAGE_NAME: z.string().min(1, "PLAY_PACKAGE_NAME is required"),
  PLAY_SERVICE_ACCOUNT_JSON: z.string().min(1, "PLAY_SERVICE_ACCOUNT_JSON is required"),
  PLAY_PUBSUB_AUDIENCE: z.string().min(1, "PLAY_PUBSUB_AUDIENCE is required"),
  PLAY_PUBSUB_SERVICE_ACCOUNT: z.string().min(1, "PLAY_PUBSUB_SERVICE_ACCOUNT is required"),
  EMAIL_PROVIDER_MODE: z.enum(["resend", "log"]).default("resend"),
  EMAIL_PROVIDER_API_KEY: z.string().min(1, "EMAIL_PROVIDER_API_KEY is required"),
  EMAIL_FROM: z.string().email("EMAIL_FROM must be a valid email address"),
  OTP_EXPIRY_MINUTES: z.coerce.number().int().positive().default(10),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(600),
  AUTH_REQUEST_CODE_MAX_PER_IP: z.coerce.number().int().positive().default(5),
  AUTH_VERIFY_CODE_MAX_PER_IP: z.coerce.number().int().positive().default(10),
  ADMIN_ALLOWLIST_EMAILS: z.string().default(""),
  RAW_IP_RETENTION_HOURS: z.coerce.number().int().positive().default(24),
  SECURITY_RETENTION_BATCH_SIZE: z.coerce.number().int().positive().default(500),
  ERROR_TRACKING_ENABLED: z.enum(["true", "false"]).default("false")
    .transform((value) => value === "true"),
  ERROR_TRACKING_DSN: z.string().trim().optional().transform((value) => value || null),
  MAX_ACTIVE_DEVICES_PER_USER: z.coerce.number().int().positive().default(10),
  ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),
  MAX_JSON_BODY_BYTES: z.coerce.number().int().positive().default(1048576),
  MAX_WEBHOOK_BODY_BYTES: z.coerce.number().int().positive().default(524288),
  BILLING_WEBHOOK_RETRY_BATCH_SIZE: z.coerce.number().int().positive().default(25),
  BILLING_WEBHOOK_RETRY_BASE_DELAY_SECONDS: z.coerce.number().int().positive().default(60),
  BILLING_WEBHOOK_RETRY_MAX_DELAY_SECONDS: z.coerce.number().int().positive().default(3600),
  BILLING_WEBHOOK_STALE_LOCK_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(300)
});

let cachedConfig: AppConfig | null = null;

function resolveEnvFile(): string | null {
  const explicitPath = process.env.ENV_FILE;

  if (explicitPath) {
    const absoluteExplicitPath = resolve(process.cwd(), explicitPath);
    return existsSync(absoluteExplicitPath) ? absoluteExplicitPath : null;
  }

  if (process.env.NODE_ENV === "production") {
    return null;
  }

  const defaultFileName = process.env.NODE_ENV === "test" ? ".env.test" : ".env.local";
  const defaultPath = resolve(process.cwd(), defaultFileName);

  return existsSync(defaultPath) ? defaultPath : null;
}

function loadEnvironment(): AppConfig {
  const envFilePath = resolveEnvFile();

  if (envFilePath) {
    // Prisma eagerly loads the root .env file; the selected env file must win for local/test isolation.
    loadDotEnv({ path: envFilePath, override: true });
  }

  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
  }

  return {
    nodeEnv: parsed.data.NODE_ENV,
    appEnv: parsed.data.APP_ENV,
    host: parsed.data.HOST,
    port: parsed.data.PORT,
    databaseUrl: parsed.data.DATABASE_URL,
    jwtAccessSecret: parsed.data.JWT_ACCESS_SECRET,
    jwtRefreshSecret: parsed.data.JWT_REFRESH_SECRET,
    jwtAlgorithm: parsed.data.JWT_ALGORITHM,
    jwtAccessExpiryMinutes: parsed.data.JWT_ACCESS_EXPIRY_MINUTES,
    jwtRefreshExpiryDays: parsed.data.JWT_REFRESH_EXPIRY_DAYS,
    appEncryptionKey: parsed.data.APP_ENCRYPTION_KEY,
    ipHashKeyV1: parsed.data.IP_HASH_KEY_V1,
    googleClientId: parsed.data.GOOGLE_CLIENT_ID,
    paddleApiKey: parsed.data.PADDLE_API_KEY,
    paddleWebhookSecret: parsed.data.PADDLE_WEBHOOK_SECRET,
    paddlePriceIdProMonthly: parsed.data.PADDLE_PRICE_ID_PRO_MONTHLY,
    paddlePriceIdProYearly: parsed.data.PADDLE_PRICE_ID_PRO_YEARLY,
    paddleEnvironment: parsed.data.PADDLE_ENV,
    billingCheckoutEnabled: parsed.data.BILLING_CHECKOUT_ENABLED,
    billingCustomerPortalEnabled: parsed.data.BILLING_CUSTOMER_PORTAL_ENABLED,
    stripeSecretKey: parsed.data.STRIPE_SECRET_KEY,
    stripeWebhookSecret: parsed.data.STRIPE_WEBHOOK_SECRET,
    stripePriceIdProMonthly: parsed.data.STRIPE_PRICE_ID_PRO_MONTHLY,
    stripePriceIdProYearly: parsed.data.STRIPE_PRICE_ID_PRO_YEARLY,
    playPackageName: parsed.data.PLAY_PACKAGE_NAME,
    playServiceAccountJson: parsed.data.PLAY_SERVICE_ACCOUNT_JSON,
    playPubsubAudience: parsed.data.PLAY_PUBSUB_AUDIENCE,
    playPubsubServiceAccount: parsed.data.PLAY_PUBSUB_SERVICE_ACCOUNT,
    emailProviderMode: parsed.data.EMAIL_PROVIDER_MODE,
    emailProviderApiKey: parsed.data.EMAIL_PROVIDER_API_KEY,
    emailFrom: parsed.data.EMAIL_FROM,
    otpExpiryMinutes: parsed.data.OTP_EXPIRY_MINUTES,
    otpMaxAttempts: parsed.data.OTP_MAX_ATTEMPTS,
    authRateLimitWindowSeconds: parsed.data.AUTH_RATE_LIMIT_WINDOW_SECONDS,
    authRequestCodeMaxPerIp: parsed.data.AUTH_REQUEST_CODE_MAX_PER_IP,
    authVerifyCodeMaxPerIp: parsed.data.AUTH_VERIFY_CODE_MAX_PER_IP,
    adminAllowlistEmails: parsed.data.ADMIN_ALLOWLIST_EMAILS.split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
    rawIpRetentionHours: parsed.data.RAW_IP_RETENTION_HOURS,
    securityRetentionBatchSize: parsed.data.SECURITY_RETENTION_BATCH_SIZE,
    errorTrackingEnabled: parsed.data.ERROR_TRACKING_ENABLED,
    errorTrackingDsn: parsed.data.ERROR_TRACKING_DSN,
    maxActiveDevicesPerUser: parsed.data.MAX_ACTIVE_DEVICES_PER_USER,
    allowedOrigins: parsed.data.ALLOWED_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    maxJsonBodyBytes: parsed.data.MAX_JSON_BODY_BYTES,
    maxWebhookBodyBytes: parsed.data.MAX_WEBHOOK_BODY_BYTES,
    billingWebhookRetryBatchSize: parsed.data.BILLING_WEBHOOK_RETRY_BATCH_SIZE,
    billingWebhookRetryBaseDelaySeconds: parsed.data.BILLING_WEBHOOK_RETRY_BASE_DELAY_SECONDS,
    billingWebhookRetryMaxDelaySeconds: parsed.data.BILLING_WEBHOOK_RETRY_MAX_DELAY_SECONDS,
    billingWebhookStaleLockTimeoutSeconds: parsed.data.BILLING_WEBHOOK_STALE_LOCK_TIMEOUT_SECONDS
  };
}

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  appEnv: string;
  host: string;
  port: number;
  databaseUrl: string;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  jwtAlgorithm: "HS256";
  jwtAccessExpiryMinutes: number;
  jwtRefreshExpiryDays: number;
  appEncryptionKey: string;
  ipHashKeyV1: string;
  googleClientId: string;
  paddleApiKey: string;
  paddleWebhookSecret: string;
  paddlePriceIdProMonthly: string;
  paddlePriceIdProYearly: string;
  paddleEnvironment: "sandbox" | "production";
  billingCheckoutEnabled: boolean;
  billingCustomerPortalEnabled: boolean;
  stripeSecretKey: string | null;
  stripeWebhookSecret: string | null;
  stripePriceIdProMonthly: string | null;
  stripePriceIdProYearly: string | null;
  playPackageName: string;
  playServiceAccountJson: string;
  playPubsubAudience: string;
  playPubsubServiceAccount: string;
  emailProviderMode: "resend" | "log";
  emailProviderApiKey: string;
  emailFrom: string;
  otpExpiryMinutes: number;
  otpMaxAttempts: number;
  authRateLimitWindowSeconds: number;
  authRequestCodeMaxPerIp: number;
  authVerifyCodeMaxPerIp: number;
  adminAllowlistEmails: string[];
  rawIpRetentionHours: number;
  securityRetentionBatchSize: number;
  errorTrackingEnabled: boolean;
  errorTrackingDsn: string | null;
  maxActiveDevicesPerUser: number;
  allowedOrigins: string[];
  maxJsonBodyBytes: number;
  maxWebhookBodyBytes: number;
  billingWebhookRetryBatchSize: number;
  billingWebhookRetryBaseDelaySeconds: number;
  billingWebhookRetryMaxDelaySeconds: number;
  billingWebhookStaleLockTimeoutSeconds: number;
}

export function getConfig(): AppConfig {
  if (!cachedConfig) {
    cachedConfig = loadEnvironment();
  }

  return cachedConfig;
}
