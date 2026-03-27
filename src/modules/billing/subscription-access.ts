import { SubscriptionStatus } from "@prisma/client";

export function isCanceledSubscriptionStillEntitling(input: {
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
}, now = new Date()): boolean {
  return input.status === SubscriptionStatus.CANCELED
    && input.currentPeriodEnd !== null
    && input.currentPeriodEnd.getTime() > now.getTime();
}

export function isSubscriptionCurrentlyEntitling(input: {
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
}, now = new Date()): boolean {
  switch (input.status) {
    case SubscriptionStatus.TRIALING:
    case SubscriptionStatus.ACTIVE:
    case SubscriptionStatus.GRACE:
    case SubscriptionStatus.PAYMENT_ISSUE:
      return true;
    case SubscriptionStatus.CANCELED:
      return isCanceledSubscriptionStillEntitling(input, now);
    case SubscriptionStatus.EXPIRED:
    case SubscriptionStatus.INCOMPLETE:
    default:
      return false;
  }
}
