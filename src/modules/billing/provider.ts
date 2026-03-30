import type { SubscriptionStatus } from "@prisma/client";

export interface BillingInvoiceRecord {
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

export interface BillingInvoiceListInput {
  customerId: string;
  limit: number;
  startingAfter?: string;
}

export interface BillingInvoiceListResult {
  items: BillingInvoiceRecord[];
  nextCursor: string | null;
}

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

export type StripeInvoiceListResult = BillingInvoiceListResult;
export type StripeInvoiceListInput = BillingInvoiceListInput;

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

export interface PaddleCheckoutSessionInput {
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

export interface PaddleCheckoutSessionResult {
  id: string;
  url: string;
  customerId: string;
  expiresAt: Date | null;
}

export interface PaddleCustomerInput {
  organizationId: string;
  email: string;
  name: string;
  customData?: Record<string, string>;
}

export interface PaddleCustomerResult {
  id: string;
}

export interface PaddleCustomerPortalInput {
  customerId: string;
  subscriptionIds?: string[];
}

export interface PaddleCustomerPortalResult {
  id: string;
  url: string;
}

export type PaddleInvoiceListInput = BillingInvoiceListInput;
export type PaddleInvoiceListResult = BillingInvoiceListResult;

export interface PaddleWebhookEventPayload {
  entityId: string;
  status: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  transactionId: string | null;
  priceId: string | null;
  organizationId: string | null;
  planCode: string | null;
  currencyCode: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  startedAt: Date | null;
  nextBilledAt: Date | null;
  trialEndsAt: Date | null;
  canceledAt: Date | null;
}

export interface PaddleWebhookEvent {
  id: string;
  type: string;
  occurredAt: Date;
  payload: PaddleWebhookEventPayload;
}

export interface PaddleProvider {
  createCustomer(input: PaddleCustomerInput): Promise<PaddleCustomerResult>;
  createCheckoutSession(input: PaddleCheckoutSessionInput): Promise<PaddleCheckoutSessionResult>;
  createCustomerPortalSession(input: PaddleCustomerPortalInput): Promise<PaddleCustomerPortalResult>;
  listInvoices(input: PaddleInvoiceListInput): Promise<PaddleInvoiceListResult>;
  verifyWebhookEvent(rawBody: Buffer, signatureHeader: string): Promise<PaddleWebhookEvent>;
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

export interface BillingProviderClients {
  paddle: PaddleProvider;
  googlePlay: GooglePlayProvider;
  stripe?: StripeProvider | null;
}
