import type { SubscriptionStatus } from "@prisma/client";

export interface StripeCheckoutSessionInput {
  customerId: string;
  organizationId: string;
  userId: string;
  planCode: string;
  priceId: string;
  trialDays: number;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey?: string;
}

export interface StripeCheckoutSessionResult {
  id: string;
  url: string;
  customerId: string;
  expiresAt: Date | null;
}

export interface StripeCustomerInput {
  organizationId: string;
  email: string;
  name: string;
  idempotencyKey?: string;
}

export interface StripeCustomerResult {
  id: string;
}

export interface StripeCustomerPortalInput {
  customerId: string;
  returnUrl: string;
}

export interface StripeCustomerPortalResult {
  id: string;
  url: string;
}

export interface StripeInvoiceRecord {
  id: string;
  status: string | null;
  currency: string | null;
  amountDueCents: number;
  amountPaidCents: number;
  hostedUrl: string | null;
  invoicePdfUrl: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  createdAt: Date;
}

export interface StripeInvoiceListResult {
  items: StripeInvoiceRecord[];
  nextCursor: string | null;
}

export interface StripeInvoiceListInput {
  customerId: string;
  limit: number;
  startingAfter?: string;
}

export interface StripeWebhookEventPayload {
  objectType: string;
  customerId: string | null;
  subscriptionId: string | null;
  checkoutSessionId: string | null;
  invoiceId: string | null;
  priceId: string | null;
  status: string | null;
  cancelAtPeriodEnd: boolean | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  canceledAt: Date | null;
  billingReason: string | null;
  organizationId: string | null;
  planCode: string | null;
}

export interface StripeWebhookEvent {
  id: string;
  type: string;
  createdAt: Date;
  livemode: boolean;
  payload: StripeWebhookEventPayload;
}

export interface StripeProvider {
  createCustomer(input: StripeCustomerInput): Promise<StripeCustomerResult>;
  createCheckoutSession(input: StripeCheckoutSessionInput): Promise<StripeCheckoutSessionResult>;
  createCustomerPortalSession(input: StripeCustomerPortalInput): Promise<StripeCustomerPortalResult>;
  listInvoices(input: StripeInvoiceListInput): Promise<StripeInvoiceListResult>;
  verifyWebhookEvent(rawBody: Buffer, signatureHeader: string): Promise<StripeWebhookEvent>;
}

export interface GooglePlaySubscriptionState {
  packageName: string;
  purchaseToken: string;
  linkedPurchaseToken: string | null;
  productId: string;
  basePlanId: string | null;
  externalSubscriptionId: string;
  status: SubscriptionStatus;
  isTrial: boolean;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  canceledAt: Date | null;
  acknowledged: boolean;
  shouldAcknowledge: boolean;
}

export interface GooglePlayAcknowledgeInput {
  productId: string;
  purchaseToken: string;
}

export interface GooglePlayRtdnEvent {
  messageId: string;
  packageName: string;
  purchaseToken: string;
  notificationType: string;
  eventTime: Date | null;
  publishedAt: Date | null;
}

export interface GooglePlayProvider {
  verifySubscription(purchaseToken: string): Promise<GooglePlaySubscriptionState>;
  acknowledgeSubscription(input: GooglePlayAcknowledgeInput): Promise<void>;
  verifyRtdn(rawBody: Buffer, authorizationHeader: string | null): Promise<GooglePlayRtdnEvent>;
}
