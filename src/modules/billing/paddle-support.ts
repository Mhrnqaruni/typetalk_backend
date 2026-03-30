import {
  BillingProvider,
  Prisma,
  PrismaClient,
  SubscriptionStatus
} from "@prisma/client";

import { getConfig } from "../../config/env";
import { AppError } from "../../lib/app-error";
import {
  buildUserScopedIdempotencyScope,
  createIdempotencyRequestHash,
  executeIdempotentRequest
} from "../../lib/idempotency";
import { decodeCursor, encodeCursor, getPageLimit } from "../../lib/pagination";
import { EntitlementService } from "../entitlements/service";
import type { PaddleProvider, PaddleWebhookEvent } from "./provider";
import { BillingRepository, type DbClient } from "./repository";
import { isSubscriptionCurrentlyEntitling } from "./subscription-access";

export interface SerializedPaddleWebhookEventSnapshot {
  provider: "paddle";
  external_event_id: string;
  type: string;
  occurred_at: string;
  payload: {
    entity_id: string;
    status: string | null;
    customer_id: string | null;
    subscription_id: string | null;
    transaction_id: string | null;
    price_id: string | null;
    organization_id: string | null;
    plan_code: string | null;
    currency_code: string | null;
    current_period_start: string | null;
    current_period_end: string | null;
    started_at: string | null;
    next_billed_at: string | null;
    trial_ends_at: string | null;
    canceled_at: string | null;
  };
}

export class PaddleBillingSupport {
  private readonly config = getConfig();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly billingRepository: BillingRepository,
    private readonly entitlementService: EntitlementService,
    private readonly paddleProvider: PaddleProvider
  ) {}

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
      "billing.paddle.checkout",
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

        if (!plan || !plan.paddlePriceId || plan.code === "free") {
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
        const providerCustomer = await this.ensurePaddleCustomer({
          organizationId: input.organizationId,
          email: input.email,
          displayName: input.displayName,
          transaction
        });
        const session = await this.paddleProvider.createCheckoutSession({
          customerId: providerCustomer.externalCustomerId,
          organizationId: input.organizationId,
          userId: input.userId,
          planCode: plan.code,
          priceId: plan.paddlePriceId,
          trialDays: trialEligible ? plan.trialDays : 0,
          successUrl: input.successUrl,
          cancelUrl: input.cancelUrl,
          idempotencyKey: `paddle-checkout:${input.organizationId}:${input.idempotencyKey}`
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
              trial_days: trialEligible ? plan.trialDays : 0,
              provider: "paddle"
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

  async createCustomerPortalSession(organizationId: string) {
    const providerCustomer = await this.billingRepository.findProviderCustomerByOrganization(
      organizationId,
      BillingProvider.PADDLE
    );

    if (!providerCustomer) {
      throw new AppError(404, "billing_customer_not_found", "Paddle customer was not found.");
    }

    const subscriptions = await this.billingRepository.listSubscriptionsForOrganization(organizationId);
    const session = await this.paddleProvider.createCustomerPortalSession({
      customerId: providerCustomer.externalCustomerId,
      subscriptionIds: subscriptions
        .filter((subscription) => subscription.provider === BillingProvider.PADDLE)
        .map((subscription) => subscription.externalSubscriptionId)
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
    const result = await this.paddleProvider.listInvoices({
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
    return this.paddleProvider.verifyWebhookEvent(rawBody, signatureHeader);
  }

  serializeWebhookEvent(event: PaddleWebhookEvent): Prisma.InputJsonValue {
    return {
      provider: "paddle",
      external_event_id: event.id,
      type: event.type,
      occurred_at: event.occurredAt.toISOString(),
      payload: {
        entity_id: event.payload.entityId,
        status: event.payload.status,
        customer_id: event.payload.customerId,
        subscription_id: event.payload.subscriptionId,
        transaction_id: event.payload.transactionId,
        price_id: event.payload.priceId,
        organization_id: event.payload.organizationId,
        plan_code: event.payload.planCode,
        currency_code: event.payload.currencyCode,
        current_period_start: event.payload.currentPeriodStart?.toISOString() ?? null,
        current_period_end: event.payload.currentPeriodEnd?.toISOString() ?? null,
        started_at: event.payload.startedAt?.toISOString() ?? null,
        next_billed_at: event.payload.nextBilledAt?.toISOString() ?? null,
        trial_ends_at: event.payload.trialEndsAt?.toISOString() ?? null,
        canceled_at: event.payload.canceledAt?.toISOString() ?? null
      }
    } satisfies SerializedPaddleWebhookEventSnapshot;
  }

  deserializeWebhookEvent(snapshot: SerializedPaddleWebhookEventSnapshot): PaddleWebhookEvent {
    return {
      id: snapshot.external_event_id,
      type: snapshot.type,
      occurredAt: new Date(snapshot.occurred_at),
      payload: {
        entityId: snapshot.payload.entity_id,
        status: snapshot.payload.status,
        customerId: snapshot.payload.customer_id,
        subscriptionId: snapshot.payload.subscription_id,
        transactionId: snapshot.payload.transaction_id,
        priceId: snapshot.payload.price_id,
        organizationId: snapshot.payload.organization_id,
        planCode: snapshot.payload.plan_code,
        currencyCode: snapshot.payload.currency_code,
        currentPeriodStart: snapshot.payload.current_period_start
          ? new Date(snapshot.payload.current_period_start)
          : null,
        currentPeriodEnd: snapshot.payload.current_period_end
          ? new Date(snapshot.payload.current_period_end)
          : null,
        startedAt: snapshot.payload.started_at
          ? new Date(snapshot.payload.started_at)
          : null,
        nextBilledAt: snapshot.payload.next_billed_at
          ? new Date(snapshot.payload.next_billed_at)
          : null,
        trialEndsAt: snapshot.payload.trial_ends_at
          ? new Date(snapshot.payload.trial_ends_at)
          : null,
        canceledAt: snapshot.payload.canceled_at
          ? new Date(snapshot.payload.canceled_at)
          : null
      }
    };
  }

  async applyWebhookEvent(event: PaddleWebhookEvent, transaction: DbClient): Promise<void> {
    if (event.type.startsWith("subscription.")) {
      await this.handleSubscriptionEvent(event.payload, transaction);
      return;
    }

    switch (event.type) {
      case "transaction.completed":
      case "transaction.updated":
        await this.handleTransactionEvent(event.payload, transaction);
        return;
      case "transaction.payment_failed":
        await this.handlePaymentFailedEvent(event.payload, transaction);
        return;
      default:
        return;
    }
  }

  private async handleTransactionEvent(
    payload: PaddleWebhookEvent["payload"],
    transaction: DbClient
  ) {
    const organizationId = await this.resolveOrganizationId(payload, transaction);

    if (!organizationId || !payload.customerId) {
      throw new Error("Paddle transaction webhook could not resolve an organization and customer.");
    }

    const providerCustomer = await this.billingRepository.upsertProviderCustomer(
      organizationId,
      BillingProvider.PADDLE,
      payload.customerId,
      transaction
    );

    if (!payload.subscriptionId) {
      return;
    }

    const plan = await this.resolvePlanFromPayload(payload, transaction);

    if (!plan) {
      throw new Error("Paddle transaction webhook payload does not map to a known plan.");
    }

    await this.billingRepository.upsertSubscription({
      organizationId,
      planId: plan.id,
      providerCustomerId: providerCustomer.id,
      provider: BillingProvider.PADDLE,
      externalSubscriptionId: payload.subscriptionId,
      status: this.mapStatus(payload.status),
      isTrial: payload.status === "trialing" || Boolean(payload.trialEndsAt),
      conflictFlag: false,
      trialEndsAt: payload.trialEndsAt,
      currentPeriodStart: payload.currentPeriodStart ?? payload.startedAt,
      currentPeriodEnd: payload.currentPeriodEnd ?? payload.nextBilledAt,
      canceledAt: payload.canceledAt
    }, transaction);

    await this.entitlementService.recomputeForOrganization(organizationId, null, transaction);
  }

  private async handleSubscriptionEvent(
    payload: PaddleWebhookEvent["payload"],
    transaction: DbClient
  ) {
    const organizationId = await this.resolveOrganizationId(payload, transaction);

    if (!organizationId || !payload.subscriptionId || !payload.customerId) {
      throw new Error("Paddle subscription webhook payload is missing organization, customer, or subscription identifiers.");
    }

    const plan = await this.resolvePlanFromPayload(payload, transaction);

    if (!plan) {
      throw new Error("Paddle subscription webhook payload does not map to a known plan.");
    }

    const providerCustomer = await this.billingRepository.upsertProviderCustomer(
      organizationId,
      BillingProvider.PADDLE,
      payload.customerId,
      transaction
    );

    await this.billingRepository.upsertSubscription({
      organizationId,
      planId: plan.id,
      providerCustomerId: providerCustomer.id,
      provider: BillingProvider.PADDLE,
      externalSubscriptionId: payload.subscriptionId,
      status: this.mapStatus(payload.status),
      isTrial: payload.status === "trialing" || Boolean(payload.trialEndsAt),
      conflictFlag: false,
      trialEndsAt: payload.trialEndsAt,
      currentPeriodStart: payload.currentPeriodStart ?? payload.startedAt,
      currentPeriodEnd: payload.currentPeriodEnd ?? payload.nextBilledAt,
      canceledAt: payload.canceledAt
    }, transaction);

    await this.entitlementService.recomputeForOrganization(organizationId, null, transaction);
  }

  private async handlePaymentFailedEvent(
    payload: PaddleWebhookEvent["payload"],
    transaction: DbClient
  ) {
    if (!payload.subscriptionId) {
      throw new Error("Paddle payment failed webhook payload is missing a subscription id.");
    }

    const existing = await this.billingRepository.findSubscriptionByExternalId(
      BillingProvider.PADDLE,
      payload.subscriptionId,
      transaction
    );

    if (!existing) {
      throw new Error("Paddle payment failed webhook could not resolve an existing subscription.");
    }

    await this.billingRepository.updateSubscriptionStatusByExternalId(
      BillingProvider.PADDLE,
      payload.subscriptionId,
      SubscriptionStatus.PAYMENT_ISSUE,
      transaction
    );
    await this.entitlementService.recomputeForOrganization(existing.organizationId, null, transaction);
  }

  private async ensurePaddleCustomer(input: {
    organizationId: string;
    email: string;
    displayName: string | null;
    transaction: DbClient;
  }) {
    const existing = await this.billingRepository.findProviderCustomerByOrganization(
      input.organizationId,
      BillingProvider.PADDLE,
      input.transaction
    );

    if (existing) {
      return existing;
    }

    const createdCustomer = await this.paddleProvider.createCustomer({
      organizationId: input.organizationId,
      email: input.email,
      name: input.displayName ?? input.email
    });

    try {
      return await this.billingRepository.upsertProviderCustomer(
        input.organizationId,
        BillingProvider.PADDLE,
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
          BillingProvider.PADDLE,
          input.transaction
        );

        if (racedCustomer) {
          return racedCustomer;
        }
      }

      throw error;
    }
  }

  private async resolveOrganizationId(
    payload: PaddleWebhookEvent["payload"],
    transaction: DbClient
  ): Promise<string | null> {
    if (payload.organizationId) {
      return payload.organizationId;
    }

    if (payload.customerId) {
      const providerCustomer = await this.billingRepository.findProviderCustomerByExternalId(
        BillingProvider.PADDLE,
        payload.customerId,
        transaction
      );

      if (providerCustomer) {
        return providerCustomer.organizationId;
      }
    }

    if (payload.subscriptionId) {
      const subscription = await this.billingRepository.findSubscriptionByExternalId(
        BillingProvider.PADDLE,
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
    payload: PaddleWebhookEvent["payload"],
    transaction: DbClient
  ) {
    if (payload.priceId) {
      const planByPrice = await this.billingRepository.findPlanByPaddlePriceId(
        payload.priceId,
        transaction
      );

      if (planByPrice) {
        return planByPrice;
      }
    }

    if (payload.planCode) {
      const planByCode = await this.billingRepository.findPlanByCode(payload.planCode, transaction);

      if (planByCode) {
        return planByCode;
      }
    }

    if (payload.subscriptionId) {
      const existing = await this.billingRepository.findSubscriptionByExternalId(
        BillingProvider.PADDLE,
        payload.subscriptionId,
        transaction
      );

      if (existing) {
        return existing.plan;
      }
    }

    return null;
  }

  private mapStatus(status: string | null): SubscriptionStatus {
    switch (status) {
      case "trialing":
        return SubscriptionStatus.TRIALING;
      case "active":
      case "completed":
      case "paid":
        return SubscriptionStatus.ACTIVE;
      case "past_due":
      case "payment_failed":
        return SubscriptionStatus.PAYMENT_ISSUE;
      case "paused":
        return SubscriptionStatus.GRACE;
      case "canceled":
        return SubscriptionStatus.CANCELED;
      case "inactive":
        return SubscriptionStatus.EXPIRED;
      default:
        return SubscriptionStatus.INCOMPLETE;
    }
  }
}
