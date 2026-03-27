import {
  BillingProvider,
  EntitlementCode,
  Prisma,
  PrismaClient,
  SubscriptionStatus
} from "@prisma/client";

import { getConfig } from "../../config/env";
import { AppError } from "../../lib/app-error";
import { generateOpaqueSecret } from "../../lib/crypto";
import {
  buildUserScopedIdempotencyScope,
  createIdempotencyRequestHash,
  executeIdempotentRequest
} from "../../lib/idempotency";
import { decodeCursor, encodeCursor, getPageLimit } from "../../lib/pagination";
import { GooglePlayBillingSupport } from "./google-play-support";
import type {
  GooglePlayProvider,
  GooglePlayRtdnEvent,
  StripeProvider,
  StripeWebhookEvent,
  StripeWebhookEventPayload
} from "./provider";
import { BillingRepository, type DbClient } from "./repository";
import { isSubscriptionCurrentlyEntitling } from "./subscription-access";
import { EntitlementService } from "../entitlements/service";

function toApiBillingInterval(value: "NONE" | "MONTHLY" | "YEARLY"): string {
  return value.toLowerCase();
}

function toApiProvider(value: BillingProvider | null | undefined): string | null {
  return value ? value.toLowerCase() : null;
}

function toApiSubscriptionStatus(status: SubscriptionStatus | "FREE"): string {
  return status === "FREE" ? "free" : status.toLowerCase();
}

interface SerializedStripeWebhookEventSnapshot {
  provider: "stripe";
  external_event_id: string;
  type: string;
  created_at: string;
  livemode: boolean;
  payload: {
    object_type: string;
    customer_id: string | null;
    subscription_id: string | null;
    checkout_session_id: string | null;
    invoice_id: string | null;
    price_id: string | null;
    status: string | null;
    cancel_at_period_end: boolean | null;
    current_period_start: string | null;
    current_period_end: string | null;
    trial_ends_at: string | null;
    canceled_at: string | null;
    billing_reason: string | null;
    organization_id: string | null;
    plan_code: string | null;
  };
}

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

  constructor(
    private readonly prisma: PrismaClient,
    private readonly billingRepository: BillingRepository,
    private readonly entitlementService: EntitlementService,
    private readonly stripeProvider: StripeProvider,
    private readonly googlePlayProvider: GooglePlayProvider
  ) {
    this.googlePlaySupport = new GooglePlayBillingSupport(
      prisma,
      billingRepository,
      entitlementService,
      googlePlayProvider
    );
  }

  async listPlans() {
    const plans = await this.billingRepository.listActivePlans();

    return {
      items: plans.map((plan) => ({
        id: plan.id,
        code: plan.code,
        display_name: plan.displayName,
        amount_cents: plan.amountCents,
        currency: plan.currency,
        billing_interval: toApiBillingInterval(plan.billingInterval),
        weekly_word_limit: plan.weeklyWordLimit,
        trial_days: plan.trialDays,
        stripe_price_id: plan.stripePriceId,
        google_product_id: plan.googleProductId,
        google_base_plan_id: plan.googleBasePlanId,
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
        status: toApiSubscriptionStatus(subscription.status),
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

  async createCheckoutSession(input: {
    userId: string;
    organizationId: string;
    email: string;
    displayName: string | null;
    planCode: string;
    successUrl: string;
    cancelUrl: string;
    idempotencyKey: string;
  }) {
    const requestHash = createIdempotencyRequestHash({
      plan_code: input.planCode,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl
    }, this.config.appEncryptionKey);
    const scope = buildUserScopedIdempotencyScope(
      "billing.checkout_session",
      input.userId,
      input.organizationId
    );

    const result = await executeIdempotentRequest({
      prisma: this.prisma,
      scope,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      execute: async (transaction) => {
        const plan = await this.billingRepository.findPlanByCode(input.planCode, transaction);

        if (!plan || !plan.stripePriceId || plan.code === "free") {
          throw new AppError(400, "invalid_billing_plan", "Billing plan is invalid.");
        }

        const existingSubscriptions = await this.billingRepository.listSubscriptionsForOrganization(
          input.organizationId,
          transaction
        );
        const hasActivePaidAccess = existingSubscriptions.some((subscription) =>
          isSubscriptionCurrentlyEntitling(subscription)
        );

        if (hasActivePaidAccess) {
          await this.entitlementService.recomputeForOrganization(
            input.organizationId,
            input.userId,
            transaction
          );

          throw new AppError(
            409,
            "active_paid_entitlement_exists",
            "Active paid access already exists for this organization."
          );
        }

        const trialEligible = !existingSubscriptions.some((subscription) =>
          subscription.isTrial || Boolean(subscription.trialEndsAt)
        );
        const providerCustomer = await this.ensureStripeCustomer({
          organizationId: input.organizationId,
          email: input.email,
          displayName: input.displayName,
          idempotencyKey: input.idempotencyKey,
          transaction
        });
        const session = await this.stripeProvider.createCheckoutSession({
          customerId: providerCustomer.externalCustomerId,
          organizationId: input.organizationId,
          userId: input.userId,
          planCode: plan.code,
          priceId: plan.stripePriceId,
          trialDays: trialEligible ? plan.trialDays : 0,
          successUrl: input.successUrl,
          cancelUrl: input.cancelUrl,
          idempotencyKey: `checkout:${input.organizationId}:${input.idempotencyKey}`
        });

        return {
          statusCode: 200,
          body: {
            checkout_session: {
              id: session.id,
              url: session.url,
              customer_id: session.customerId,
              expires_at: session.expiresAt?.toISOString() ?? null,
              plan_code: plan.code,
              trial_days: trialEligible ? plan.trialDays : 0
            }
          }
        };
      }
    });

    return {
      statusCode: result.statusCode,
      body: result.body
    };
  }

  async createCustomerPortalSession(organizationId: string, returnUrl: string) {
    const providerCustomer = await this.billingRepository.findProviderCustomerByOrganization(
      organizationId,
      BillingProvider.STRIPE
    );

    if (!providerCustomer) {
      throw new AppError(404, "billing_customer_not_found", "Stripe customer was not found.");
    }

    const session = await this.stripeProvider.createCustomerPortalSession({
      customerId: providerCustomer.externalCustomerId,
      returnUrl
    });

    return {
      portal_session: {
        id: session.id,
        url: session.url
      }
    };
  }

  async listInvoices(organizationId: string, limit?: number, cursor?: string) {
    const entitlement = await this.entitlementService.getCurrentEntitlementRecord(organizationId);

    if (entitlement.sourceProvider === BillingProvider.GOOGLE_PLAY) {
      return this.googlePlaySupport.listInvoices(organizationId, limit, cursor);
    }

    const providerCustomer = await this.billingRepository.findProviderCustomerByOrganization(
      organizationId,
      BillingProvider.STRIPE
    );

    if (!providerCustomer) {
      return this.googlePlaySupport.listInvoices(organizationId, limit, cursor);
    }

    const resolvedLimit = getPageLimit(limit);
    const decodedCursor = decodeCursor<{ id: string }>(cursor);
    const result = await this.stripeProvider.listInvoices({
      customerId: providerCustomer.externalCustomerId,
      limit: resolvedLimit,
      startingAfter: decodedCursor?.id
    });

    return {
      items: result.items.map((invoice) => ({
        id: invoice.id,
        status: invoice.status,
        currency: invoice.currency,
        amount_due_cents: invoice.amountDueCents,
        amount_paid_cents: invoice.amountPaidCents,
        hosted_url: invoice.hostedUrl,
        invoice_pdf_url: invoice.invoicePdfUrl,
        period_start: invoice.periodStart?.toISOString() ?? null,
        period_end: invoice.periodEnd?.toISOString() ?? null,
        created_at: invoice.createdAt.toISOString()
      })),
      next_cursor: result.nextCursor
        ? encodeCursor({
            id: result.nextCursor
          })
        : null
    };
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

  async receiveStripeWebhook(rawBody: Buffer, signatureHeader: string) {
    const verifiedEvent = await this.stripeProvider.verifyWebhookEvent(rawBody, signatureHeader);
    const payloadJson = this.serializeStripeWebhookEvent(verifiedEvent);

    let storedEvent = await this.billingRepository.findWebhookEventByProviderExternalId(
      BillingProvider.STRIPE,
      verifiedEvent.id
    );

    if (!storedEvent) {
      try {
        storedEvent = await this.billingRepository.createWebhookEvent({
          provider: BillingProvider.STRIPE,
          externalEventId: verifiedEvent.id,
          payloadJson
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          storedEvent = await this.billingRepository.findWebhookEventByProviderExternalId(
            BillingProvider.STRIPE,
            verifiedEvent.id
          );
        } else {
          throw error;
        }
      }
    }

    if (!storedEvent) {
      throw new Error("Webhook event could not be persisted.");
    }

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
        const event = this.deserializeStripeWebhookEvent(claimed.payloadJson);
        await this.prisma.$transaction(async (transaction) => {
          await this.applyStripeWebhookEvent(event, transaction);
        }, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        });
      } else {
        const event = this.deserializeGooglePlayRtdnEvent(claimed.payloadJson);
        await this.prisma.$transaction(async (transaction) => {
          await this.googlePlaySupport.processRtdnEvent(event, transaction);
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

  private async applyStripeWebhookEvent(
    event: StripeWebhookEvent,
    transaction: DbClient
  ): Promise<void> {
    switch (event.type) {
      case "checkout.session.completed":
        await this.handleCheckoutCompleted(event.payload, transaction);
        return;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await this.handleSubscriptionEvent(event.payload, transaction);
        return;
      case "invoice.payment_failed":
        await this.handleInvoiceStatusEvent(event.payload, SubscriptionStatus.PAYMENT_ISSUE, transaction);
        return;
      case "invoice.paid":
      case "invoice.payment_succeeded":
        await this.handleInvoicePaidEvent(event.payload, transaction);
        return;
      default:
        return;
    }
  }

  private async handleCheckoutCompleted(
    payload: StripeWebhookEventPayload,
    transaction: DbClient
  ): Promise<void> {
    if (!payload.customerId) {
      return;
    }

    const organizationId = await this.resolveOrganizationId(payload, transaction);

    if (!organizationId) {
      throw new Error("Checkout session webhook could not resolve an organization.");
    }

    await this.billingRepository.upsertProviderCustomer(
      organizationId,
      BillingProvider.STRIPE,
      payload.customerId,
      transaction
    );
  }

  private async handleSubscriptionEvent(
    payload: StripeWebhookEventPayload,
    transaction: DbClient
  ): Promise<void> {
    const organizationId = await this.resolveOrganizationId(payload, transaction);

    if (!organizationId || !payload.subscriptionId || !payload.customerId) {
      throw new Error("Subscription webhook payload is missing organization, customer, or subscription identifiers.");
    }

    const plan = await this.resolvePlanFromPayload(payload, transaction);

    if (!plan) {
      throw new Error("Subscription webhook payload does not map to a known plan.");
    }

    const providerCustomer = await this.billingRepository.upsertProviderCustomer(
      organizationId,
      BillingProvider.STRIPE,
      payload.customerId,
      transaction
    );

    await this.billingRepository.upsertSubscription({
      organizationId,
      planId: plan.id,
      providerCustomerId: providerCustomer.id,
      provider: BillingProvider.STRIPE,
      externalSubscriptionId: payload.subscriptionId,
      status: this.mapStripeStatus(payload.status),
      isTrial: Boolean(payload.trialEndsAt),
      conflictFlag: false,
      trialEndsAt: payload.trialEndsAt,
      currentPeriodStart: payload.currentPeriodStart,
      currentPeriodEnd: payload.currentPeriodEnd,
      canceledAt: payload.canceledAt
    }, transaction);

    await this.entitlementService.recomputeForOrganization(organizationId, null, transaction);
  }

  private async handleInvoiceStatusEvent(
    payload: StripeWebhookEventPayload,
    status: SubscriptionStatus,
    transaction: DbClient
  ): Promise<void> {
    if (!payload.subscriptionId) {
      throw new Error("Invoice webhook payload is missing a subscription id.");
    }

    const existing = await this.billingRepository.findSubscriptionByExternalId(
      BillingProvider.STRIPE,
      payload.subscriptionId,
      transaction
    );

    if (!existing) {
      throw new Error("Invoice webhook payload could not resolve an existing subscription.");
    }

    await this.billingRepository.updateSubscriptionStatusByExternalId(
      BillingProvider.STRIPE,
      payload.subscriptionId,
      status,
      transaction
    );
    await this.entitlementService.recomputeForOrganization(existing.organizationId, null, transaction);
  }

  private async handleInvoicePaidEvent(
    payload: StripeWebhookEventPayload,
    transaction: DbClient
  ): Promise<void> {
    if (!payload.subscriptionId) {
      throw new Error("Invoice webhook payload is missing a subscription id.");
    }

    const existing = await this.billingRepository.findSubscriptionByExternalId(
      BillingProvider.STRIPE,
      payload.subscriptionId,
      transaction
    );

    if (!existing) {
      throw new Error("Invoice paid webhook could not resolve an existing subscription.");
    }

    const status = existing.isTrial && existing.trialEndsAt && existing.trialEndsAt.getTime() > Date.now()
      ? SubscriptionStatus.TRIALING
      : SubscriptionStatus.ACTIVE;

    await this.billingRepository.updateSubscriptionStatusByExternalId(
      BillingProvider.STRIPE,
      payload.subscriptionId,
      status,
      transaction
    );
    await this.entitlementService.recomputeForOrganization(existing.organizationId, null, transaction);
  }

  private async resolveOrganizationId(
    payload: StripeWebhookEventPayload,
    transaction: DbClient
  ): Promise<string | null> {
    if (payload.organizationId) {
      return payload.organizationId;
    }

    if (payload.customerId) {
      const providerCustomer = await this.billingRepository.findProviderCustomerByExternalId(
        BillingProvider.STRIPE,
        payload.customerId,
        transaction
      );

      if (providerCustomer) {
        return providerCustomer.organizationId;
      }
    }

    if (payload.subscriptionId) {
      const subscription = await this.billingRepository.findSubscriptionByExternalId(
        BillingProvider.STRIPE,
        payload.subscriptionId,
        transaction
      );

      if (subscription) {
        return subscription.organizationId;
      }
    }

    return null;
  }

  private async resolvePlanFromPayload(
    payload: StripeWebhookEventPayload,
    transaction: DbClient
  ) {
    if (payload.priceId) {
      const planByPrice = await this.billingRepository.findPlanByStripePriceId(
        payload.priceId,
        transaction
      );

      if (planByPrice) {
        return planByPrice;
      }
    }

    if (payload.planCode) {
      return this.billingRepository.findPlanByCode(payload.planCode, transaction);
    }

    return null;
  }

  private mapStripeStatus(status: string | null): SubscriptionStatus {
    switch (status) {
      case "trialing":
        return SubscriptionStatus.TRIALING;
      case "active":
        return SubscriptionStatus.ACTIVE;
      case "past_due":
      case "unpaid":
        return SubscriptionStatus.PAYMENT_ISSUE;
      case "canceled":
        return SubscriptionStatus.CANCELED;
      case "incomplete":
        return SubscriptionStatus.INCOMPLETE;
      case "incomplete_expired":
        return SubscriptionStatus.EXPIRED;
      case "paused":
        return SubscriptionStatus.GRACE;
      default:
        return SubscriptionStatus.ACTIVE;
    }
  }

  private async ensureStripeCustomer(input: {
    organizationId: string;
    email: string;
    displayName: string | null;
    idempotencyKey: string;
    transaction: DbClient;
  }) {
    const existing = await this.billingRepository.findProviderCustomerByOrganization(
      input.organizationId,
      BillingProvider.STRIPE,
      input.transaction
    );

    if (existing) {
      return existing;
    }

    const createdCustomer = await this.stripeProvider.createCustomer({
      organizationId: input.organizationId,
      email: input.email,
      name: input.displayName ?? input.email,
      idempotencyKey: `customer:${input.organizationId}:${input.idempotencyKey}`
    });

    try {
      return await this.billingRepository.upsertProviderCustomer(
        input.organizationId,
        BillingProvider.STRIPE,
        createdCustomer.id,
        input.transaction
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const racedCustomer = await this.billingRepository.findProviderCustomerByOrganization(
          input.organizationId,
          BillingProvider.STRIPE,
          input.transaction
        );

        if (racedCustomer) {
          return racedCustomer;
        }
      }

      throw error;
    }
  }

  private serializeStripeWebhookEvent(event: StripeWebhookEvent): Prisma.InputJsonValue {
    return {
      provider: "stripe",
      external_event_id: event.id,
      type: event.type,
      created_at: event.createdAt.toISOString(),
      livemode: event.livemode,
      payload: {
        object_type: event.payload.objectType,
        customer_id: event.payload.customerId,
        subscription_id: event.payload.subscriptionId,
        checkout_session_id: event.payload.checkoutSessionId,
        invoice_id: event.payload.invoiceId,
        price_id: event.payload.priceId,
        status: event.payload.status,
        cancel_at_period_end: event.payload.cancelAtPeriodEnd,
        current_period_start: event.payload.currentPeriodStart?.toISOString() ?? null,
        current_period_end: event.payload.currentPeriodEnd?.toISOString() ?? null,
        trial_ends_at: event.payload.trialEndsAt?.toISOString() ?? null,
        canceled_at: event.payload.canceledAt?.toISOString() ?? null,
        billing_reason: event.payload.billingReason,
        organization_id: event.payload.organizationId,
        plan_code: event.payload.planCode
      }
    } satisfies SerializedStripeWebhookEventSnapshot;
  }

  private deserializeStripeWebhookEvent(payloadJson: Prisma.JsonValue): StripeWebhookEvent {
    const snapshot = payloadJson as unknown as SerializedStripeWebhookEventSnapshot;

    return {
      id: snapshot.external_event_id,
      type: snapshot.type,
      createdAt: new Date(snapshot.created_at),
      livemode: snapshot.livemode,
      payload: {
        objectType: snapshot.payload.object_type,
        customerId: snapshot.payload.customer_id,
        subscriptionId: snapshot.payload.subscription_id,
        checkoutSessionId: snapshot.payload.checkout_session_id,
        invoiceId: snapshot.payload.invoice_id,
        priceId: snapshot.payload.price_id,
        status: snapshot.payload.status,
        cancelAtPeriodEnd: snapshot.payload.cancel_at_period_end,
        currentPeriodStart: snapshot.payload.current_period_start
          ? new Date(snapshot.payload.current_period_start)
          : null,
        currentPeriodEnd: snapshot.payload.current_period_end
          ? new Date(snapshot.payload.current_period_end)
          : null,
        trialEndsAt: snapshot.payload.trial_ends_at
          ? new Date(snapshot.payload.trial_ends_at)
          : null,
        canceledAt: snapshot.payload.canceled_at
          ? new Date(snapshot.payload.canceled_at)
          : null,
        billingReason: snapshot.payload.billing_reason,
        organizationId: snapshot.payload.organization_id,
        planCode: snapshot.payload.plan_code
      }
    };
  }

  private deserializeGooglePlayRtdnEvent(payloadJson: Prisma.JsonValue): GooglePlayRtdnEvent {
    const snapshot = payloadJson as unknown as SerializedGooglePlayRtdnSnapshot;

    return {
      messageId: snapshot.message_id,
      packageName: snapshot.package_name,
      purchaseToken: snapshot.purchase_token,
      notificationType: snapshot.notification_type,
      eventTime: snapshot.event_time ? new Date(snapshot.event_time) : null,
      publishedAt: snapshot.published_at ? new Date(snapshot.published_at) : null
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
