import {
  BillingProvider,
  Prisma,
  PrismaClient
} from "@prisma/client";

import { getConfig } from "../../config/env";
import { AppError } from "../../lib/app-error";
import { generateOpaqueSecret } from "../../lib/crypto";
import { EntitlementService } from "../entitlements/service";
import { GooglePlayBillingSupport } from "./google-play-support";
import { LegacyStripeBillingSupport, type SerializedStripeWebhookEventSnapshot } from "./stripe-support";
import type { BillingProviderClients, GooglePlayRtdnEvent } from "./provider";
import { BillingRepository } from "./repository";
import { PaddleBillingSupport, type SerializedPaddleWebhookEventSnapshot } from "./paddle-support";

function toApiBillingInterval(value: "NONE" | "MONTHLY" | "YEARLY"): string {
  return value.toLowerCase();
}

function toApiProvider(value: BillingProvider | null | undefined): string | null {
  return value ? value.toLowerCase() : null;
}

const legacyStripeCheckoutError = new AppError(
  410,
  "legacy_billing_route_retired",
  "Legacy Stripe checkout is retired for launch traffic. Use /v1/billing/paddle/checkout."
);

interface SerializedGooglePlayRtdnSnapshot {
  provider: "google_play";
  external_event_id: string;
  message_id: string;
  package_name: string;
  purchase_token: string;
  notification_type: string;
  event_time: string | null;
  published_at: string | null;
}

export class BillingService {
  private readonly config = getConfig();
  private readonly googlePlaySupport: GooglePlayBillingSupport;
  private readonly legacyStripeSupport: LegacyStripeBillingSupport;
  private readonly paddleSupport: PaddleBillingSupport;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly billingRepository: BillingRepository,
    private readonly entitlementService: EntitlementService,
    private readonly providers: BillingProviderClients
  ) {
    this.googlePlaySupport = new GooglePlayBillingSupport(
      prisma,
      billingRepository,
      entitlementService,
      providers.googlePlay
    );
    this.legacyStripeSupport = new LegacyStripeBillingSupport(
      billingRepository,
      entitlementService,
      providers.stripe ?? null
    );
    this.paddleSupport = new PaddleBillingSupport(
      prisma,
      billingRepository,
      entitlementService,
      providers.paddle
    );
  }

  async listPlans() {
    const plans = await this.billingRepository.listActivePlans();

    return {
      items: plans.map((plan) => ({
        code: plan.code,
        display_name: plan.displayName,
        amount_cents: plan.amountCents,
        currency: plan.currency,
        billing_interval: toApiBillingInterval(plan.billingInterval),
        weekly_word_limit: plan.weeklyWordLimit,
        trial_days: plan.trialDays,
        is_active: plan.isActive
      }))
    };
  }

  async getCurrentSubscriptionSummary(organizationId: string) {
    const entitlement = await this.entitlementService.getCurrentEntitlementRecord(organizationId);
    const subscription = entitlement?.primarySubscription
      ?? await this.billingRepository.findLatestSubscriptionForOrganization(organizationId);

    if (!subscription) {
      return {
        subscription: {
          provider: null,
          plan_code: "free",
          status: "free",
          is_trial: false,
          billing_overlap: false,
          current_period_start: null,
          current_period_end: null,
          trial_ends_at: null,
          canceled_at: null,
          entitlement_code: "free"
        }
      };
    }

    return {
      subscription: {
        provider: toApiProvider(subscription.provider),
        plan_code: subscription.plan.code,
        status: subscription.status.toLowerCase(),
        is_trial: subscription.isTrial,
        billing_overlap: entitlement?.billingOverlap ?? false,
        current_period_start: subscription.currentPeriodStart?.toISOString() ?? null,
        current_period_end: subscription.currentPeriodEnd?.toISOString() ?? null,
        trial_ends_at: subscription.trialEndsAt?.toISOString() ?? null,
        canceled_at: subscription.canceledAt?.toISOString() ?? null,
        entitlement_code: entitlement ? entitlement.code.toLowerCase() : "free"
      }
    };
  }

  async createPaddleCheckoutSession(input: {
    userId: string;
    organizationId: string;
    email: string;
    displayName: string | null;
    planCode: string;
    successUrl: string;
    cancelUrl: string;
    idempotencyKey: string;
  }) {
    return this.paddleSupport.createCheckoutSession(input);
  }

  rejectLegacyStripeCheckoutSession(): never {
    throw legacyStripeCheckoutError;
  }

  async createPaddleCustomerPortalSession(organizationId: string) {
    return this.paddleSupport.createCustomerPortalSession(organizationId);
  }

  async createStripeCustomerPortalSession(organizationId: string, returnUrl: string) {
    return this.legacyStripeSupport.createCustomerPortalSession(organizationId, returnUrl);
  }

  async listInvoices(organizationId: string, limit?: number, cursor?: string) {
    const entitlement = await this.entitlementService.getCurrentEntitlementRecord(organizationId);

    if (entitlement.sourceProvider === BillingProvider.GOOGLE_PLAY) {
      return this.googlePlaySupport.listInvoices(organizationId, limit, cursor);
    }

    if (entitlement.sourceProvider === BillingProvider.PADDLE) {
      const paddleCustomer = await this.billingRepository.findProviderCustomerByOrganization(
        organizationId,
        BillingProvider.PADDLE
      );

      if (paddleCustomer) {
        return this.paddleSupport.listInvoices(paddleCustomer.externalCustomerId, limit, cursor);
      }
    }

    if (entitlement.sourceProvider === BillingProvider.STRIPE) {
      const stripeCustomer = await this.billingRepository.findProviderCustomerByOrganization(
        organizationId,
        BillingProvider.STRIPE
      );

      if (stripeCustomer) {
        return this.legacyStripeSupport.listInvoices(stripeCustomer.externalCustomerId, limit, cursor);
      }
    }

    const paddleCustomer = await this.billingRepository.findProviderCustomerByOrganization(
      organizationId,
      BillingProvider.PADDLE
    );

    if (paddleCustomer) {
      return this.paddleSupport.listInvoices(paddleCustomer.externalCustomerId, limit, cursor);
    }

    const stripeCustomer = await this.billingRepository.findProviderCustomerByOrganization(
      organizationId,
      BillingProvider.STRIPE
    );

    if (stripeCustomer) {
      return this.legacyStripeSupport.listInvoices(stripeCustomer.externalCustomerId, limit, cursor);
    }

    return this.googlePlaySupport.listInvoices(organizationId, limit, cursor);
  }

  async verifyGooglePlaySubscription(input: {
    userId: string;
    organizationId: string;
    purchaseToken: string;
    productId: string;
    basePlanId: string | null;
    idempotencyKey: string;
  }) {
    return this.googlePlaySupport.verifySubscription(input);
  }

  async restoreGooglePlaySubscription(input: {
    userId: string;
    organizationId: string;
    purchaseToken: string;
    productId: string;
    basePlanId: string | null;
    idempotencyKey: string;
  }) {
    return this.googlePlaySupport.restoreSubscription(input);
  }

  async receiveGooglePlayRtdn(rawBody: Buffer, authorizationHeader: string | null) {
    const { event, storedEventId } = await this.googlePlaySupport.receiveRtdn(
      rawBody,
      authorizationHeader
    );
    const processingResult = await this.processWebhookEventById(storedEventId);

    return {
      statusCode: 200,
      body: {
        accepted: true,
        event_id: event.messageId,
        status: processingResult.status
      }
    };
  }

  async receivePaddleWebhook(rawBody: Buffer, signatureHeader: string) {
    const verifiedEvent = await this.paddleSupport.verifyWebhookEvent(rawBody, signatureHeader);
    const storedEvent = await this.persistWebhookEvent(
      BillingProvider.PADDLE,
      verifiedEvent.id,
      this.paddleSupport.serializeWebhookEvent(verifiedEvent)
    );
    const processingResult = await this.processWebhookEventById(storedEvent.id);

    return {
      statusCode: 200,
      body: {
        accepted: true,
        event_id: verifiedEvent.id,
        status: processingResult.status
      }
    };
  }

  async receiveStripeWebhook(rawBody: Buffer, signatureHeader: string) {
    const verifiedEvent = await this.legacyStripeSupport.verifyWebhookEvent(rawBody, signatureHeader);
    const storedEvent = await this.persistWebhookEvent(
      BillingProvider.STRIPE,
      verifiedEvent.id,
      this.legacyStripeSupport.serializeWebhookEvent(verifiedEvent)
    );
    const processingResult = await this.processWebhookEventById(storedEvent.id);

    return {
      statusCode: 200,
      body: {
        accepted: true,
        event_id: verifiedEvent.id,
        status: processingResult.status
      }
    };
  }

  async retryWebhookEvents(limit = this.config.billingWebhookRetryBatchSize) {
    const now = new Date();
    const staleBefore = new Date(
      now.getTime() - this.config.billingWebhookStaleLockTimeoutSeconds * 1000
    );
    const eventIds = await this.billingRepository.listRetryableWebhookEventIds(
      limit,
      now,
      staleBefore
    );
    const acknowledgmentRetryResult = await this.googlePlaySupport.retryPendingAcknowledgments(limit);
    let processed = 0;
    let failed = 0;
    let skipped = 0;

    for (const eventId of eventIds) {
      const result = await this.processWebhookEventById(eventId);

      if (result.status === "processed") {
        processed += 1;
      } else if (result.status === "failed") {
        failed += 1;
      } else {
        skipped += 1;
      }
    }

    return {
      scanned: eventIds.length + acknowledgmentRetryResult.scanned,
      processed: processed + acknowledgmentRetryResult.processed,
      failed: failed + acknowledgmentRetryResult.failed,
      skipped: skipped + acknowledgmentRetryResult.skipped
    };
  }

  private async persistWebhookEvent(
    provider: BillingProvider,
    externalEventId: string,
    payloadJson: Prisma.InputJsonValue
  ) {
    let storedEvent = await this.billingRepository.findWebhookEventByProviderExternalId(
      provider,
      externalEventId
    );

    if (!storedEvent) {
      try {
        storedEvent = await this.billingRepository.createWebhookEvent({
          provider,
          externalEventId,
          payloadJson
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          storedEvent = await this.billingRepository.findWebhookEventByProviderExternalId(
            provider,
            externalEventId
          );
        } else {
          throw error;
        }
      }
    }

    if (!storedEvent) {
      throw new Error("Webhook event could not be persisted.");
    }

    return storedEvent;
  }

  private async processWebhookEventById(eventId: string): Promise<{
    status: "processed" | "failed" | "skipped";
  }> {
    const now = new Date();
    const lockToken = generateOpaqueSecret();
    const staleBefore = new Date(
      now.getTime() - this.config.billingWebhookStaleLockTimeoutSeconds * 1000
    );
    const claimed = await this.billingRepository.claimWebhookEvent(
      eventId,
      now,
      lockToken,
      staleBefore
    );

    if (!claimed) {
      return {
        status: "skipped"
      };
    }

    try {
      if (claimed.provider === BillingProvider.STRIPE) {
        const event = this.legacyStripeSupport.deserializeWebhookEvent(
          claimed.payloadJson as unknown as SerializedStripeWebhookEventSnapshot
        );
        await this.prisma.$transaction(async (transaction) => {
          await this.legacyStripeSupport.applyWebhookEvent(event, transaction);
        }, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        });
      } else if (claimed.provider === BillingProvider.GOOGLE_PLAY) {
        const event = this.deserializeGooglePlayRtdnEvent(
          claimed.payloadJson as unknown as SerializedGooglePlayRtdnSnapshot
        );
        await this.prisma.$transaction(async (transaction) => {
          await this.googlePlaySupport.processRtdnEvent(event, transaction);
        }, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        });
      } else {
        const event = this.paddleSupport.deserializeWebhookEvent(
          claimed.payloadJson as unknown as SerializedPaddleWebhookEventSnapshot
        );
        await this.prisma.$transaction(async (transaction) => {
          await this.paddleSupport.applyWebhookEvent(event, transaction);
        }, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        });
      }

      await this.billingRepository.markWebhookProcessed(eventId, lockToken, new Date());

      return {
        status: "processed"
      };
    } catch (error) {
      await this.billingRepository.markWebhookFailed(
        eventId,
        lockToken,
        this.normalizeWebhookError(error),
        this.computeNextRetryAt(claimed.attemptCount)
      );

      return {
        status: "failed"
      };
    }
  }

  private deserializeGooglePlayRtdnEvent(
    payloadJson: SerializedGooglePlayRtdnSnapshot
  ): GooglePlayRtdnEvent {
    return {
      messageId: payloadJson.message_id,
      packageName: payloadJson.package_name,
      purchaseToken: payloadJson.purchase_token,
      notificationType: payloadJson.notification_type,
      eventTime: payloadJson.event_time ? new Date(payloadJson.event_time) : null,
      publishedAt: payloadJson.published_at ? new Date(payloadJson.published_at) : null
    };
  }

  private normalizeWebhookError(error: unknown): string {
    if (error instanceof Error) {
      return error.message.slice(0, 500);
    }

    return "Webhook processing failed.";
  }

  private computeNextRetryAt(attemptCount: number): Date {
    const baseDelaySeconds = this.config.billingWebhookRetryBaseDelaySeconds;
    const maxDelaySeconds = this.config.billingWebhookRetryMaxDelaySeconds;
    const delaySeconds = Math.min(baseDelaySeconds * (2 ** Math.max(attemptCount - 1, 0)), maxDelaySeconds);

    return new Date(Date.now() + delaySeconds * 1000);
  }
}
