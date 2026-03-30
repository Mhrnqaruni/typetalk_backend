import {
  BillingProvider,
  Prisma,
  SubscriptionStatus
} from "@prisma/client";

import { AppError } from "../../lib/app-error";
import { decodeCursor, encodeCursor, getPageLimit } from "../../lib/pagination";
import { EntitlementService } from "../entitlements/service";
import type { StripeProvider, StripeWebhookEvent, StripeWebhookEventPayload } from "./provider";
import { BillingRepository, type DbClient } from "./repository";

export interface SerializedStripeWebhookEventSnapshot {
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

export class LegacyStripeBillingSupport {
  constructor(
    private readonly billingRepository: BillingRepository,
    private readonly entitlementService: EntitlementService,
    private readonly stripeProvider: StripeProvider | null
  ) {}

  async createCustomerPortalSession(organizationId: string, returnUrl: string) {
    const providerCustomer = await this.billingRepository.findProviderCustomerByOrganization(
      organizationId,
      BillingProvider.STRIPE
    );

    if (!providerCustomer) {
      throw new AppError(404, "billing_customer_not_found", "Stripe customer was not found.");
    }

    const session = await this.requireProvider().createCustomerPortalSession({
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

  async listInvoices(customerId: string, limit?: number, cursor?: string) {
    const resolvedLimit = getPageLimit(limit);
    const decodedCursor = decodeCursor<{ id: string }>(cursor);
    const result = await this.requireProvider().listInvoices({
      customerId,
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

  async verifyWebhookEvent(rawBody: Buffer, signatureHeader: string) {
    return this.requireProvider().verifyWebhookEvent(rawBody, signatureHeader);
  }

  serializeWebhookEvent(event: StripeWebhookEvent): Prisma.InputJsonValue {
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

  deserializeWebhookEvent(snapshot: SerializedStripeWebhookEventSnapshot): StripeWebhookEvent {
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

  async applyWebhookEvent(
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

  private requireProvider(): StripeProvider {
    if (!this.stripeProvider) {
      throw new AppError(
        503,
        "legacy_billing_unavailable",
        "Legacy Stripe support is not configured in this environment."
      );
    }

    return this.stripeProvider;
  }
}
