import {
  BillingProvider,
  PrismaClient,
  PurchaseAcknowledgmentStatus,
  type Entitlement,
  type Plan,
  type PurchaseToken,
  type Subscription
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
import { BillingRepository, type DbClient } from "./repository";
import type {
  GooglePlayProvider,
  GooglePlayRtdnEvent,
  GooglePlaySubscriptionState
} from "./provider";

type EntitlementRecord = Awaited<ReturnType<EntitlementService["recomputeForOrganization"]>>;
type SubscriptionRecord = Awaited<ReturnType<BillingRepository["findLatestSubscriptionForOrganization"]>>;
type PurchaseTokenRecord = NonNullable<Awaited<ReturnType<BillingRepository["findPurchaseToken"]>>>;

function toApiProvider(provider: BillingProvider | null | undefined): string | null {
  return provider ? provider.toLowerCase() : null;
}

function toApiSubscriptionStatus(status: string): string {
  return status.toLowerCase();
}

function toApiAcknowledgmentStatus(status: PurchaseAcknowledgmentStatus): string {
  return status.toLowerCase();
}

function isPaidLikeStatus(status: PurchaseToken["status"]): boolean {
  return status !== "INCOMPLETE" && status !== "CANCELED" && status !== "EXPIRED";
}

export class GooglePlayBillingSupport {
  private readonly config = getConfig();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly billingRepository: BillingRepository,
    private readonly entitlementService: EntitlementService,
    private readonly googlePlayProvider: GooglePlayProvider
  ) {}

  async verifySubscription(input: {
    userId: string;
    organizationId: string;
    purchaseToken: string;
    productId: string;
    basePlanId: string | null;
    idempotencyKey: string;
  }) {
    return this.executeSubscriptionAction("billing.google_play.verify_subscription", input);
  }

  async restoreSubscription(input: {
    userId: string;
    organizationId: string;
    purchaseToken: string;
    productId: string;
    basePlanId: string | null;
    idempotencyKey: string;
  }) {
    return this.executeSubscriptionAction("billing.google_play.restore", input);
  }

  async listInvoices(organizationId: string, limit?: number, cursor?: string) {
    const resolvedLimit = getPageLimit(limit);
    const decodedCursor = decodeCursor<{ updated_at: string; purchase_token: string }>(cursor);
    const purchaseTokens = await this.billingRepository.listPurchaseTokensForOrganization(
      organizationId,
      resolvedLimit + 1,
      decodedCursor
        ? {
            updatedAt: new Date(decodedCursor.updated_at),
            purchaseToken: decodedCursor.purchase_token
          }
        : null
    );
    const hasMore = purchaseTokens.length > resolvedLimit;
    const pageItems = hasMore ? purchaseTokens.slice(0, resolvedLimit) : purchaseTokens;
    const nextCursor = hasMore ? pageItems[pageItems.length - 1] : null;

    return {
      items: pageItems.map((token) => ({
        id: token.purchaseToken,
        status: token.status.toLowerCase(),
        currency: token.plan.currency,
        amount_due_cents: token.plan.amountCents,
        amount_paid_cents: token.status === "TRIALING" ? 0 : token.plan.amountCents,
        hosted_url: null,
        invoice_pdf_url: null,
        period_start: token.subscription?.currentPeriodStart?.toISOString() ?? null,
        period_end: token.subscription?.currentPeriodEnd?.toISOString() ?? null,
        created_at: token.createdAt.toISOString()
      })),
      next_cursor: nextCursor
        ? encodeCursor({
            updated_at: nextCursor.updatedAt.toISOString(),
            purchase_token: nextCursor.purchaseToken
          })
        : null
    };
  }

  async receiveRtdn(rawBody: Buffer, authorizationHeader: string | null) {
    const event = await this.googlePlayProvider.verifyRtdn(rawBody, authorizationHeader);
    const payloadJson = this.serializeRtdnEvent(event);

    let storedEvent = await this.billingRepository.findWebhookEventByProviderExternalId(
      BillingProvider.GOOGLE_PLAY,
      event.messageId
    );

    if (!storedEvent) {
      try {
        storedEvent = await this.billingRepository.createWebhookEvent({
          provider: BillingProvider.GOOGLE_PLAY,
          externalEventId: event.messageId,
          payloadJson
        });
      } catch (error) {
        storedEvent = await this.billingRepository.findWebhookEventByProviderExternalId(
          BillingProvider.GOOGLE_PLAY,
          event.messageId
        );

        if (!storedEvent) {
          throw error;
        }
      }
    }

    return {
      event,
      storedEventId: storedEvent.id
    };
  }

  async processRtdnEvent(event: GooglePlayRtdnEvent, transaction: DbClient): Promise<void> {
    const state = await this.googlePlayProvider.verifySubscription(event.purchaseToken);
    const organizationId = await this.resolveOrganizationIdForWebhook(state, transaction);

    await this.syncGoogleSubscriptionState({
      organizationId,
      userId: null,
      state,
      transaction
    });
  }

  async retryPendingAcknowledgments(limit: number) {
    const now = new Date();
    const purchaseTokens = await this.billingRepository.listDuePurchaseTokenAcknowledgmentRetryIds(
      limit,
      now
    );
    let processed = 0;
    let failed = 0;
    let skipped = 0;

    for (const purchaseToken of purchaseTokens) {
      const result = await this.retryAcknowledgmentForPurchaseToken(purchaseToken);

      if (result === "processed") {
        processed += 1;
      } else if (result === "failed") {
        failed += 1;
      } else {
        skipped += 1;
      }
    }

    return {
      scanned: purchaseTokens.length,
      processed,
      failed,
      skipped
    };
  }

  private async executeSubscriptionAction(
    routeName: string,
    input: {
      userId: string;
      organizationId: string;
      purchaseToken: string;
      productId: string;
      basePlanId: string | null;
      idempotencyKey: string;
    }
  ) {
    const requestHash = createIdempotencyRequestHash({
      purchase_token: input.purchaseToken,
      product_id: input.productId,
      base_plan_id: input.basePlanId
    }, this.config.appEncryptionKey);
    const scope = buildUserScopedIdempotencyScope(routeName, input.userId, input.organizationId);

    return executeIdempotentRequest({
      prisma: this.prisma,
      scope,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      execute: async (transaction) => {
        const state = await this.googlePlayProvider.verifySubscription(input.purchaseToken);
        this.assertVerifiedPurchaseMatchesRequest(state, input);

        const syncResult = await this.syncGoogleSubscriptionState({
          organizationId: input.organizationId,
          userId: input.userId,
          state,
          transaction
        });

        return {
          statusCode: 200,
          body: this.buildActionResponse(syncResult.entitlement, syncResult.subscription, syncResult.purchaseToken)
        };
      }
    });
  }

  private assertVerifiedPurchaseMatchesRequest(
    state: GooglePlaySubscriptionState,
    input: {
      purchaseToken: string;
      productId: string;
      basePlanId: string | null;
    }
  ): void {
    if (state.packageName !== this.config.playPackageName) {
      throw new AppError(
        400,
        "invalid_google_purchase_mapping",
        "Google Play package does not match the configured package."
      );
    }

    if (state.purchaseToken !== input.purchaseToken) {
      throw new AppError(
        400,
        "invalid_google_purchase_mapping",
        "Google Play purchase token does not match the request."
      );
    }

    if (state.productId !== input.productId || (state.basePlanId ?? null) !== (input.basePlanId ?? null)) {
      throw new AppError(
        409,
        "invalid_google_purchase_mapping",
        "Google Play purchase mapping does not match the verified provider state."
      );
    }
  }

  private async syncGoogleSubscriptionState(input: {
    organizationId: string;
    userId: string | null;
    state: GooglePlaySubscriptionState;
    transaction: DbClient;
  }): Promise<{
    entitlement: EntitlementRecord;
    subscription: NonNullable<SubscriptionRecord>;
    purchaseToken: PurchaseTokenRecord;
  }> {
    const plan = await this.resolvePlan(input.state, input.transaction);
    const currentToken = await this.billingRepository.findPurchaseToken(
      input.state.purchaseToken,
      input.transaction
    );
    const linkedToken = input.state.linkedPurchaseToken
      ? await this.billingRepository.findPurchaseToken(input.state.linkedPurchaseToken, input.transaction)
      : null;

    if (currentToken && currentToken.organizationId !== input.organizationId) {
      throw new AppError(
        409,
        "google_purchase_already_linked",
        "Google Play purchase is already linked to another organization."
      );
    }

    if (linkedToken && linkedToken.organizationId !== input.organizationId) {
      throw new AppError(
        409,
        "google_purchase_already_linked",
        "Google Play purchase is already linked to another organization."
      );
    }

    const providerCustomer = await this.billingRepository.upsertProviderCustomer(
      input.organizationId,
      BillingProvider.GOOGLE_PLAY,
      `google_play:${input.organizationId}`,
      input.transaction
    );
    const subscriptionExternalId = currentToken?.subscription?.externalSubscriptionId
      ?? linkedToken?.subscription?.externalSubscriptionId
      ?? input.state.externalSubscriptionId;
    const subscription = await this.billingRepository.upsertSubscription({
      organizationId: input.organizationId,
      planId: plan.id,
      providerCustomerId: providerCustomer.id,
      provider: BillingProvider.GOOGLE_PLAY,
      externalSubscriptionId: subscriptionExternalId,
      status: input.state.status,
      isTrial: input.state.isTrial,
      conflictFlag: false,
      trialEndsAt: input.state.trialEndsAt,
      currentPeriodStart: input.state.currentPeriodStart,
      currentPeriodEnd: input.state.currentPeriodEnd,
      canceledAt: input.state.canceledAt
    }, input.transaction);

    await this.billingRepository.upsertPurchaseToken({
      purchaseToken: input.state.purchaseToken,
      organizationId: input.organizationId,
      subscriptionId: subscription.id,
      planId: plan.id,
      productId: input.state.productId,
      basePlanId: input.state.basePlanId,
      linkedPurchaseToken: input.state.linkedPurchaseToken,
      status: input.state.status,
      lastVerifiedAt: new Date()
    }, input.transaction);

    if (input.state.acknowledged) {
      await this.billingRepository.markPurchaseTokenAcknowledged(
        input.state.purchaseToken,
        new Date(),
        input.transaction
      );
    } else if (input.state.shouldAcknowledge) {
      try {
        await this.googlePlayProvider.acknowledgeSubscription({
          productId: input.state.productId,
          purchaseToken: input.state.purchaseToken
        });
        await this.billingRepository.markPurchaseTokenAcknowledged(
          input.state.purchaseToken,
          new Date(),
          input.transaction
        );
      } catch (error) {
        await this.billingRepository.schedulePurchaseTokenAcknowledgmentRetry(
          input.state.purchaseToken,
          this.normalizeError(error),
          this.computeNextRetryAt(1),
          input.transaction
        );
      }
    }

    const entitlement = await this.entitlementService.recomputeForOrganization(
      input.organizationId,
      input.userId,
      input.transaction
    );
    const purchaseToken = await this.billingRepository.findPurchaseToken(
      input.state.purchaseToken,
      input.transaction
    );

    if (!purchaseToken) {
      throw new Error("Google Play purchase token could not be loaded after sync.");
    }

    return {
      entitlement,
      subscription,
      purchaseToken
    };
  }

  private async resolveOrganizationIdForWebhook(
    state: GooglePlaySubscriptionState,
    transaction: DbClient
  ): Promise<string> {
    const currentToken = await this.billingRepository.findPurchaseToken(state.purchaseToken, transaction);

    if (currentToken) {
      return currentToken.organizationId;
    }

    if (state.linkedPurchaseToken) {
      const linkedToken = await this.billingRepository.findPurchaseToken(
        state.linkedPurchaseToken,
        transaction
      );

      if (linkedToken) {
        return linkedToken.organizationId;
      }
    }

    throw new Error("Google Play RTDN could not resolve a registered organization.");
  }

  private async resolvePlan(
    state: GooglePlaySubscriptionState,
    transaction: DbClient
  ): Promise<Plan> {
    const plan = await this.billingRepository.findPlanByGoogleProductBasePlan(
      state.productId,
      state.basePlanId,
      transaction
    );

    if (!plan) {
      throw new AppError(400, "invalid_billing_plan", "Billing plan is invalid.");
    }

    return plan;
  }

  private buildActionResponse(
    entitlement: EntitlementRecord,
    subscription: NonNullable<SubscriptionRecord>,
    purchaseToken: PurchaseTokenRecord
  ) {
    const primarySubscription = entitlement.primarySubscription ?? subscription;

    return {
      subscription: {
        provider: toApiProvider(primarySubscription.provider),
        plan_code: primarySubscription.plan.code,
        status: toApiSubscriptionStatus(primarySubscription.status),
        is_trial: primarySubscription.isTrial,
        billing_overlap: entitlement.billingOverlap,
        current_period_start: primarySubscription.currentPeriodStart?.toISOString() ?? null,
        current_period_end: primarySubscription.currentPeriodEnd?.toISOString() ?? null,
        trial_ends_at: primarySubscription.trialEndsAt?.toISOString() ?? null,
        canceled_at: primarySubscription.canceledAt?.toISOString() ?? null,
        entitlement_code: entitlement.code.toLowerCase()
      },
      purchase: {
        purchase_token: purchaseToken.purchaseToken,
        linked_purchase_token: purchaseToken.linkedPurchaseToken,
        product_id: purchaseToken.productId,
        base_plan_id: purchaseToken.basePlanId,
        acknowledged: Boolean(purchaseToken.acknowledgedAt),
        acknowledgment_status: toApiAcknowledgmentStatus(purchaseToken.acknowledgmentStatus)
      }
    };
  }

  private async retryAcknowledgmentForPurchaseToken(
    purchaseToken: string
  ): Promise<"processed" | "failed" | "skipped"> {
    const now = new Date();
    const claimed = await this.billingRepository.claimPurchaseTokenAcknowledgmentRetry(
      purchaseToken,
      now,
      this.computeAcknowledgmentClaimReclaimAt(now)
    );

    if (!claimed) {
      return "skipped";
    }

    try {
      await this.googlePlayProvider.acknowledgeSubscription({
        productId: claimed.productId,
        purchaseToken: claimed.purchaseToken
      });
      await this.billingRepository.markPurchaseTokenAcknowledged(
        claimed.purchaseToken,
        new Date()
      );

      return "processed";
    } catch (error) {
      await this.billingRepository.schedulePurchaseTokenAcknowledgmentRetry(
        claimed.purchaseToken,
        this.normalizeError(error),
        this.computeNextRetryAt(claimed.acknowledgmentAttemptCount + 1)
      );

      return "failed";
    }
  }

  private serializeRtdnEvent(event: GooglePlayRtdnEvent) {
    return {
      provider: "google_play",
      external_event_id: event.messageId,
      message_id: event.messageId,
      package_name: event.packageName,
      purchase_token: event.purchaseToken,
      notification_type: event.notificationType,
      event_time: event.eventTime?.toISOString() ?? null,
      published_at: event.publishedAt?.toISOString() ?? null
    };
  }

  private normalizeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message.slice(0, 500);
    }

    return "Google Play reconciliation failed.";
  }

  private computeNextRetryAt(attemptCount: number): Date {
    const baseDelaySeconds = this.config.billingWebhookRetryBaseDelaySeconds;
    const maxDelaySeconds = this.config.billingWebhookRetryMaxDelaySeconds;
    const delaySeconds = Math.min(
      baseDelaySeconds * (2 ** Math.max(attemptCount - 1, 0)),
      maxDelaySeconds
    );

    return new Date(Date.now() + delaySeconds * 1000);
  }

  private computeAcknowledgmentClaimReclaimAt(from: Date): Date {
    return new Date(from.getTime() + (this.config.billingWebhookStaleLockTimeoutSeconds * 1000));
  }
}
