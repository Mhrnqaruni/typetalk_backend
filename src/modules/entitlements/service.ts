import {
  BillingProvider,
  EntitlementCode,
  EntitlementStatus,
  SubscriptionStatus
} from "@prisma/client";

import type { DbClient } from "../billing/repository";
import { BillingRepository } from "../billing/repository";
import { isCanceledSubscriptionStillEntitling, isSubscriptionCurrentlyEntitling } from "../billing/subscription-access";
import { EntitlementRepository } from "./repository";

type OrganizationSubscription = Awaited<
  ReturnType<BillingRepository["listSubscriptionsForOrganization"]>
>[number];

const SUBSCRIPTION_PRECEDENCE: Record<SubscriptionStatus, number> = {
  [SubscriptionStatus.ACTIVE]: 0,
  [SubscriptionStatus.TRIALING]: 1,
  [SubscriptionStatus.GRACE]: 2,
  [SubscriptionStatus.PAYMENT_ISSUE]: 3,
  [SubscriptionStatus.CANCELED]: 4,
  [SubscriptionStatus.EXPIRED]: 5,
  [SubscriptionStatus.INCOMPLETE]: 6
};

function toApiCode(code: EntitlementCode): string {
  return code.toLowerCase();
}

function toApiStatus(status: EntitlementStatus): string {
  return status.toLowerCase();
}

function toApiProvider(provider: BillingProvider | null | undefined): string | null {
  return provider ? provider.toLowerCase() : null;
}

export class EntitlementService {
  constructor(
    private readonly billingRepository: BillingRepository,
    private readonly entitlementRepository: EntitlementRepository
  ) {}

  async getCurrentEntitlementRecord(organizationId: string) {
    let row = await this.entitlementRepository.findByOrganization(organizationId);

    if (!row) {
      row = await this.recomputeForOrganization(organizationId);
    }

    return row;
  }

  async getCurrentEntitlement(organizationId: string) {
    const row = await this.getCurrentEntitlementRecord(organizationId);

    return {
      entitlement: {
        code: toApiCode(row.code),
        status: toApiStatus(row.status),
        billing_overlap: row.billingOverlap,
        primary_subscription_id: row.primarySubscriptionId,
        plan_code: row.primarySubscription?.plan.code ?? "free",
        starts_at: row.startsAt?.toISOString() ?? null,
        ends_at: row.endsAt?.toISOString() ?? null,
        source_provider: toApiProvider(row.sourceProvider)
      }
    };
  }

  async recomputeForOrganization(
    organizationId: string,
    userId: string | null = null,
    transaction?: DbClient
  ) {
    const now = new Date();
    const subscriptions = await this.billingRepository.listSubscriptionsForOrganization(
      organizationId,
      transaction
    );
    const activePaidSubscriptions = subscriptions.filter((subscription) =>
      isSubscriptionCurrentlyEntitling(subscription, now)
    );
    const primarySubscription = this.selectPrimarySubscription(
      activePaidSubscriptions.length > 0 ? activePaidSubscriptions : subscriptions
    );
    const billingOverlap = activePaidSubscriptions.length > 1;

    await this.billingRepository.setSubscriptionConflictFlags(
      organizationId,
      billingOverlap ? activePaidSubscriptions.map((subscription) => subscription.id) : [],
      transaction
    );

    if (!primarySubscription) {
      return this.entitlementRepository.upsertByOrganization({
        organizationId,
        userId,
        code: EntitlementCode.FREE,
        status: EntitlementStatus.ACTIVE,
        billingOverlap: false,
        primarySubscriptionId: null,
        startsAt: null,
        endsAt: null,
        sourceProvider: null
      }, transaction);
    }

    const entitlement = this.mapSubscriptionToEntitlement(primarySubscription, now);

    return this.entitlementRepository.upsertByOrganization({
      organizationId,
      userId,
      code: entitlement.code,
      status: entitlement.status,
      billingOverlap,
      primarySubscriptionId: primarySubscription.id,
      startsAt: primarySubscription.currentPeriodStart ?? primarySubscription.createdAt,
      endsAt: primarySubscription.currentPeriodEnd,
      sourceProvider: primarySubscription.provider
    }, transaction);
  }

  private mapSubscriptionToEntitlement(subscription: OrganizationSubscription, now: Date): {
    code: EntitlementCode;
    status: EntitlementStatus;
  } {
    if (isCanceledSubscriptionStillEntitling(subscription, now)) {
      return {
        code: subscription.isTrial ? EntitlementCode.TRIAL_ACTIVE : EntitlementCode.PRO_ACTIVE,
        status: EntitlementStatus.ACTIVE
      };
    }

    switch (subscription.status) {
      case SubscriptionStatus.TRIALING:
        return {
          code: EntitlementCode.TRIAL_ACTIVE,
          status: EntitlementStatus.ACTIVE
        };
      case SubscriptionStatus.ACTIVE:
        return {
          code: EntitlementCode.PRO_ACTIVE,
          status: EntitlementStatus.ACTIVE
        };
      case SubscriptionStatus.GRACE:
        return {
          code: EntitlementCode.PRO_GRACE,
          status: EntitlementStatus.LIMITED
        };
      case SubscriptionStatus.PAYMENT_ISSUE:
        return {
          code: EntitlementCode.PAYMENT_ISSUE,
          status: EntitlementStatus.LIMITED
        };
      case SubscriptionStatus.INCOMPLETE:
        return {
          code: EntitlementCode.FREE,
          status: EntitlementStatus.INACTIVE
        };
      case SubscriptionStatus.CANCELED:
      case SubscriptionStatus.EXPIRED:
      default:
        return {
          code: EntitlementCode.EXPIRED,
          status: EntitlementStatus.INACTIVE
        };
    }
  }

  private selectPrimarySubscription(
    subscriptions: OrganizationSubscription[]
  ): OrganizationSubscription | null {
    if (subscriptions.length === 0) {
      return null;
    }

    return [...subscriptions].sort((left, right) => {
      const precedenceDifference = SUBSCRIPTION_PRECEDENCE[left.status]
        - SUBSCRIPTION_PRECEDENCE[right.status];

      if (precedenceDifference !== 0) {
        return precedenceDifference;
      }

      const periodEndDifference = (right.currentPeriodEnd?.getTime() ?? 0)
        - (left.currentPeriodEnd?.getTime() ?? 0);

      if (periodEndDifference !== 0) {
        return periodEndDifference;
      }

      const periodStartDifference = (right.currentPeriodStart?.getTime() ?? 0)
        - (left.currentPeriodStart?.getTime() ?? 0);

      if (periodStartDifference !== 0) {
        return periodStartDifference;
      }

      const updatedAtDifference = right.updatedAt.getTime() - left.updatedAt.getTime();

      if (updatedAtDifference !== 0) {
        return updatedAtDifference;
      }

      const createdAtDifference = right.createdAt.getTime() - left.createdAt.getTime();

      if (createdAtDifference !== 0) {
        return createdAtDifference;
      }

      return left.id.localeCompare(right.id);
    })[0] ?? null;
  }
}
