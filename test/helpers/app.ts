import type { Writable } from "node:stream";

import type { PrismaClient } from "@prisma/client";

import { buildApp } from "../../src/app";
import { getConfig } from "../../src/config/env";
import { AppError } from "../../src/lib/app-error";
import type { ErrorTracker } from "../../src/lib/error-tracking";
import { createPrismaClient } from "../../src/lib/prisma";
import type { EmailProvider, SendOtpInput } from "../../src/lib/email-provider";
import type { GoogleIdentityProfile, GoogleVerifier } from "../../src/modules/auth/google";
import { AuthRateLimiter, createAuthRateLimiter } from "../../src/modules/auth/rate-limiter";
import { AuthRepository } from "../../src/modules/auth/repository";
import { parseGooglePlayRtdnPayload } from "../../src/modules/billing/google-play";
import { BillingRepository } from "../../src/modules/billing/repository";
import type {
  GooglePlayAcknowledgeInput,
  GooglePlayProvider,
  GooglePlayRtdnEvent,
  GooglePlaySubscriptionState,
  PaddleCheckoutSessionInput,
  PaddleCheckoutSessionResult,
  PaddleCustomerInput,
  PaddleCustomerPortalInput,
  PaddleCustomerPortalResult,
  PaddleInvoiceListInput,
  PaddleInvoiceListResult,
  PaddleProvider,
  PaddleWebhookEvent,
  StripeCheckoutSessionInput,
  StripeCheckoutSessionResult,
  StripeCustomerInput,
  StripeCustomerPortalInput,
  StripeCustomerPortalResult,
  StripeInvoiceListInput,
  StripeInvoiceListResult,
  StripeProvider,
  StripeWebhookEvent
} from "../../src/modules/billing/provider";
import { DeviceRepository } from "../../src/modules/devices/repository";
import { EntitlementRepository } from "../../src/modules/entitlements/repository";
import { EntitlementService } from "../../src/modules/entitlements/service";
import { SecurityRepository } from "../../src/modules/security/repository";
import { SecurityService } from "../../src/modules/security/service";
import { UsageRepository } from "../../src/modules/usage/repository";
import { UsageService } from "../../src/modules/usage/service";

export class MemoryEmailProvider implements EmailProvider {
  readonly sentOtps: SendOtpInput[] = [];

  async sendOtp(input: SendOtpInput): Promise<void> {
    this.sentOtps.push(input);
  }

  latestCodeFor(email: string): string {
    const message = [...this.sentOtps].reverse().find((entry) => entry.email === email);

    if (!message) {
      throw new Error(`No OTP was sent for ${email}.`);
    }

    return message.code;
  }
}

export class StubGoogleVerifier implements GoogleVerifier {
  private readonly profiles = new Map<string, GoogleIdentityProfile>();

  setProfile(idToken: string, profile: GoogleIdentityProfile): void {
    this.profiles.set(idToken, profile);
  }

  async verifyIdToken(idToken: string): Promise<GoogleIdentityProfile> {
    const profile = this.profiles.get(idToken);

    if (!profile) {
      throw new AppError(401, "invalid_google_token", "Google token is invalid.");
    }

    return profile;
  }
}

export class StubStripeProvider implements StripeProvider {
  readonly createdCustomers: StripeCustomerInput[] = [];
  readonly checkoutSessions: StripeCheckoutSessionInput[] = [];
  readonly portalSessions: StripeCustomerPortalInput[] = [];
  readonly invoicePages = new Map<string, StripeInvoiceListResult>();
  readonly webhookEvents = new Map<string, StripeWebhookEvent>();

  async createCustomer(input: StripeCustomerInput): Promise<{ id: string }> {
    this.createdCustomers.push(input);

    return {
      id: `cus_${this.createdCustomers.length}`
    };
  }

  async createCheckoutSession(input: StripeCheckoutSessionInput): Promise<StripeCheckoutSessionResult> {
    this.checkoutSessions.push(input);

    return {
      id: `cs_${this.checkoutSessions.length}`,
      customerId: input.customerId,
      url: `https://stripe.test/checkout/${this.checkoutSessions.length}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    };
  }

  async createCustomerPortalSession(
    input: StripeCustomerPortalInput
  ): Promise<StripeCustomerPortalResult> {
    this.portalSessions.push(input);

    return {
      id: `bps_${this.portalSessions.length}`,
      url: `https://stripe.test/portal/${this.portalSessions.length}`
    };
  }

  async listInvoices(input: StripeInvoiceListInput): Promise<StripeInvoiceListResult> {
    return this.invoicePages.get(this.buildInvoicePageKey(input)) ?? {
      items: [],
      nextCursor: null
    };
  }

  async verifyWebhookEvent(rawBody: Buffer, signatureHeader: string): Promise<StripeWebhookEvent> {
    const eventId = signatureHeader.trim();
    const event = this.webhookEvents.get(eventId);

    if (!event) {
      throw new AppError(400, "invalid_webhook_signature", "Webhook signature is invalid.");
    }

    const parsedEventId = JSON.parse(rawBody.toString("utf8"))?.id;

    if (parsedEventId !== eventId) {
      throw new AppError(400, "invalid_webhook_signature", "Webhook signature is invalid.");
    }

    return event;
  }

  setInvoicePage(input: StripeInvoiceListInput, result: StripeInvoiceListResult): void {
    this.invoicePages.set(this.buildInvoicePageKey(input), result);
  }

  setWebhookEvent(event: StripeWebhookEvent): void {
    this.webhookEvents.set(event.id, event);
  }

  private buildInvoicePageKey(input: StripeInvoiceListInput): string {
    return JSON.stringify({
      customerId: input.customerId,
      limit: input.limit,
      startingAfter: input.startingAfter ?? null
    });
  }
}

export class StubPaddleProvider implements PaddleProvider {
  readonly createdCustomers: PaddleCustomerInput[] = [];
  readonly checkoutSessions: PaddleCheckoutSessionInput[] = [];
  readonly portalSessions: PaddleCustomerPortalInput[] = [];
  readonly invoicePages = new Map<string, PaddleInvoiceListResult>();
  readonly webhookEvents = new Map<string, PaddleWebhookEvent>();

  async createCustomer(input: PaddleCustomerInput): Promise<{ id: string }> {
    this.createdCustomers.push(input);

    return {
      id: `ctm_${this.createdCustomers.length}`
    };
  }

  async createCheckoutSession(input: PaddleCheckoutSessionInput): Promise<PaddleCheckoutSessionResult> {
    this.checkoutSessions.push(input);

    return {
      id: `txn_${this.checkoutSessions.length}`,
      customerId: input.customerId,
      url: `https://paddle.test/checkout/${this.checkoutSessions.length}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    };
  }

  async createCustomerPortalSession(
    input: PaddleCustomerPortalInput
  ): Promise<PaddleCustomerPortalResult> {
    this.portalSessions.push(input);

    return {
      id: `cps_${this.portalSessions.length}`,
      url: `https://paddle.test/portal/${this.portalSessions.length}`
    };
  }

  async listInvoices(input: PaddleInvoiceListInput): Promise<PaddleInvoiceListResult> {
    return this.invoicePages.get(this.buildInvoicePageKey(input)) ?? {
      items: [],
      nextCursor: null
    };
  }

  async verifyWebhookEvent(rawBody: Buffer, signatureHeader: string): Promise<PaddleWebhookEvent> {
    const eventId = signatureHeader.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("h1="))
      ?.slice(3)
      ?? signatureHeader.trim();
    const event = this.webhookEvents.get(eventId);

    if (!event) {
      throw new AppError(400, "invalid_webhook_signature", "Webhook signature is invalid.");
    }

    const parsedEventId = JSON.parse(rawBody.toString("utf8"))?.event_id;

    if (parsedEventId !== eventId) {
      throw new AppError(400, "invalid_webhook_signature", "Webhook signature is invalid.");
    }

    return event;
  }

  setInvoicePage(input: PaddleInvoiceListInput, result: PaddleInvoiceListResult): void {
    this.invoicePages.set(this.buildInvoicePageKey(input), result);
  }

  setWebhookEvent(event: PaddleWebhookEvent): void {
    this.webhookEvents.set(event.id, event);
  }

  private buildInvoicePageKey(input: PaddleInvoiceListInput): string {
    return JSON.stringify({
      customerId: input.customerId,
      limit: input.limit,
      startingAfter: input.startingAfter ?? null
    });
  }
}

export class StubGooglePlayProvider implements GooglePlayProvider {
  readonly subscriptionStates = new Map<string, GooglePlaySubscriptionState>();
  readonly acknowledgedSubscriptions: GooglePlayAcknowledgeInput[] = [];
  readonly acknowledgmentFailures = new Map<string, string>();
  readonly verifiedPurchaseTokens: string[] = [];
  validRtdnBearerToken = "google-rtdn-test-token";

  async verifySubscription(purchaseToken: string): Promise<GooglePlaySubscriptionState> {
    this.verifiedPurchaseTokens.push(purchaseToken);
    const state = this.subscriptionStates.get(purchaseToken);

    if (!state) {
      throw new AppError(
        404,
        "google_purchase_not_found",
        "Google Play purchase token was not found."
      );
    }

    return state;
  }

  async acknowledgeSubscription(input: GooglePlayAcknowledgeInput): Promise<void> {
    this.acknowledgedSubscriptions.push(input);

    const failureMessage = this.acknowledgmentFailures.get(input.purchaseToken);

    if (failureMessage) {
      throw new Error(failureMessage);
    }
  }

  async verifyRtdn(rawBody: Buffer, authorizationHeader: string | null): Promise<GooglePlayRtdnEvent> {
    if (authorizationHeader !== `Bearer ${this.validRtdnBearerToken}`) {
      throw new AppError(401, "invalid_google_rtdn_token", "Google RTDN token is invalid.");
    }

    return parseGooglePlayRtdnPayload(rawBody, getConfig().playPackageName);
  }

  setSubscriptionState(state: GooglePlaySubscriptionState): void {
    this.subscriptionStates.set(state.purchaseToken, state);
  }
}

export async function createTestHarness(options?: {
  requestCodeMaxPerIp?: number;
  verifyCodeMaxPerIp?: number;
  paddleProvider?: StubPaddleProvider;
  stripeProvider?: StubStripeProvider;
  googlePlayProvider?: StubGooglePlayProvider;
  errorTracker?: ErrorTracker;
  loggerStream?: Writable;
}): Promise<{
  prisma: PrismaClient;
  app: Awaited<ReturnType<typeof buildApp>>;
  emailProvider: MemoryEmailProvider;
  googleVerifier: StubGoogleVerifier;
  authRateLimiter: AuthRateLimiter;
  paddleProvider: StubPaddleProvider;
  stripeProvider: StubStripeProvider;
  googlePlayProvider: StubGooglePlayProvider;
  usageService: UsageService;
}> {
  const config = getConfig();
  const prisma = createPrismaClient(config.databaseUrl);
  const emailProvider = new MemoryEmailProvider();
  const googleVerifier = new StubGoogleVerifier();
  const paddleProvider = options?.paddleProvider ?? new StubPaddleProvider();
  const stripeProvider = options?.stripeProvider ?? new StubStripeProvider();
  const googlePlayProvider = options?.googlePlayProvider ?? new StubGooglePlayProvider();
  const authRepository = new AuthRepository(prisma);
  const securityRepository = new SecurityRepository(prisma);
  const securityService = new SecurityService(securityRepository);
  const authRateLimiter = createAuthRateLimiter(
    {
      ...config,
      authRequestCodeMaxPerIp: options?.requestCodeMaxPerIp ?? config.authRequestCodeMaxPerIp,
      authVerifyCodeMaxPerIp: options?.verifyCodeMaxPerIp ?? config.authVerifyCodeMaxPerIp
    },
    authRepository,
    securityService
  );
  const billingRepository = new BillingRepository(prisma);
  const entitlementRepository = new EntitlementRepository(prisma);
  const entitlementService = new EntitlementService(billingRepository, entitlementRepository);
  const deviceRepository = new DeviceRepository(prisma);
  const usageRepository = new UsageRepository(prisma);
  const usageService = new UsageService(
    prisma,
    usageRepository,
    deviceRepository,
    billingRepository,
    entitlementService
  );
  const app = await buildApp({
    prisma,
    emailProvider,
    googleVerifier,
    authRateLimiter,
    paddleProvider,
    stripeProvider,
    googlePlayProvider,
    errorTracker: options?.errorTracker,
    loggerStream: options?.loggerStream
  });

  return {
    prisma,
    app,
    emailProvider,
    googleVerifier,
    authRateLimiter,
    paddleProvider,
    stripeProvider,
    googlePlayProvider,
    usageService
  };
}
