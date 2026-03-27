import Stripe from "stripe";

import type {
  StripeCheckoutSessionInput,
  StripeCheckoutSessionResult,
  StripeCustomerInput,
  StripeCustomerPortalInput,
  StripeCustomerPortalResult,
  StripeInvoiceListInput,
  StripeInvoiceListResult,
  StripeProvider,
  StripeWebhookEvent,
  StripeWebhookEventPayload
} from "./provider";

function fromUnixTimestamp(timestamp: number | null | undefined): Date | null {
  if (!timestamp) {
    return null;
  }

  return new Date(timestamp * 1000);
}

function getMetadataValue(
  metadata: Record<string, string> | null | undefined,
  key: string
): string | null {
  const value = metadata?.[key];
  return value && value.trim() ? value : null;
}

function buildStripeWebhookPayload(event: Stripe.Event): StripeWebhookEventPayload {
  const object = event.data.object;

  if (object.object === "checkout.session") {
    const session = object as Stripe.Checkout.Session;

    return {
      objectType: session.object,
      customerId: typeof session.customer === "string" ? session.customer : null,
      subscriptionId: typeof session.subscription === "string" ? session.subscription : null,
      checkoutSessionId: session.id,
      invoiceId: typeof session.invoice === "string" ? session.invoice : null,
      priceId: null,
      status: session.status ?? session.payment_status ?? null,
      cancelAtPeriodEnd: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      trialEndsAt: null,
      canceledAt: null,
      billingReason: null,
      organizationId: getMetadataValue(session.metadata, "organization_id"),
      planCode: getMetadataValue(session.metadata, "plan_code")
    };
  }

  if (object.object === "subscription") {
    const subscription = object as Stripe.Subscription;
    const firstItem = subscription.items.data[0];

    return {
      objectType: subscription.object,
      customerId: typeof subscription.customer === "string" ? subscription.customer : null,
      subscriptionId: subscription.id,
      checkoutSessionId: null,
      invoiceId: typeof subscription.latest_invoice === "string" ? subscription.latest_invoice : null,
      priceId: firstItem?.price?.id ?? null,
      status: subscription.status ?? null,
      cancelAtPeriodEnd: subscription.cancel_at_period_end ?? null,
      currentPeriodStart: firstItem ? new Date(firstItem.current_period_start * 1000) : null,
      currentPeriodEnd: firstItem ? new Date(firstItem.current_period_end * 1000) : null,
      trialEndsAt: fromUnixTimestamp(subscription.trial_end),
      canceledAt: fromUnixTimestamp(subscription.canceled_at),
      billingReason: null,
      organizationId: getMetadataValue(subscription.metadata, "organization_id"),
      planCode: getMetadataValue(subscription.metadata, "plan_code")
    };
  }

  if (object.object === "invoice") {
    const invoice = object as Stripe.Invoice & {
      subscription?: string | Stripe.Subscription | null;
    };
    const firstLine = invoice.lines.data[0];
    const price = firstLine?.pricing?.price_details?.price ?? null;

    return {
      objectType: invoice.object,
      customerId: typeof invoice.customer === "string" ? invoice.customer : null,
      subscriptionId: typeof invoice.subscription === "string" ? invoice.subscription : null,
      checkoutSessionId: null,
      invoiceId: invoice.id,
      priceId: typeof price === "string" ? price : price?.id ?? null,
      status: invoice.status ?? null,
      cancelAtPeriodEnd: null,
      currentPeriodStart: firstLine?.period
        ? new Date(firstLine.period.start * 1000)
        : null,
      currentPeriodEnd: firstLine?.period
        ? new Date(firstLine.period.end * 1000)
        : null,
      trialEndsAt: null,
      canceledAt: null,
      billingReason: invoice.billing_reason ?? null,
      organizationId: null,
      planCode: null
    };
  }

  return {
    objectType: object.object,
    customerId: "customer" in object && typeof object.customer === "string" ? object.customer : null,
    subscriptionId: "subscription" in object && typeof object.subscription === "string"
      ? object.subscription
      : null,
    checkoutSessionId: null,
    invoiceId: null,
    priceId: null,
    status: "status" in object && typeof object.status === "string" ? object.status : null,
    cancelAtPeriodEnd: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    trialEndsAt: null,
    canceledAt: null,
    billingReason: null,
    organizationId: null,
    planCode: null
  };
}

export class LiveStripeProvider implements StripeProvider {
  private readonly client: Stripe;

  constructor(
    secretKey: string,
    private readonly webhookSecret: string
  ) {
    this.client = new Stripe(secretKey);
  }

  async createCustomer(input: StripeCustomerInput): Promise<{ id: string }> {
    const customer = await this.client.customers.create({
      email: input.email,
      name: input.name,
      metadata: {
        organization_id: input.organizationId
      }
    }, input.idempotencyKey
      ? {
          idempotencyKey: input.idempotencyKey
        }
      : undefined);

    return {
      id: customer.id
    };
  }

  async createCheckoutSession(input: StripeCheckoutSessionInput): Promise<StripeCheckoutSessionResult> {
    const session = await this.client.checkout.sessions.create({
      mode: "subscription",
      customer: input.customerId,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.organizationId,
      line_items: [
        {
          price: input.priceId,
          quantity: 1
        }
      ],
      metadata: {
        organization_id: input.organizationId,
        user_id: input.userId,
        plan_code: input.planCode
      },
      subscription_data: {
        metadata: {
          organization_id: input.organizationId,
          user_id: input.userId,
          plan_code: input.planCode
        },
        ...(input.trialDays > 0
          ? {
              trial_period_days: input.trialDays
            }
          : {})
      }
    }, input.idempotencyKey
      ? {
          idempotencyKey: input.idempotencyKey
        }
      : undefined);

    if (!session.url) {
      throw new Error("Stripe checkout session did not return a URL.");
    }

    return {
      id: session.id,
      customerId: input.customerId,
      url: session.url,
      expiresAt: fromUnixTimestamp(session.expires_at)
    };
  }

  async createCustomerPortalSession(
    input: StripeCustomerPortalInput
  ): Promise<StripeCustomerPortalResult> {
    const session = await this.client.billingPortal.sessions.create({
      customer: input.customerId,
      return_url: input.returnUrl
    });

    return {
      id: session.id,
      url: session.url
    };
  }

  async listInvoices(input: StripeInvoiceListInput): Promise<StripeInvoiceListResult> {
    const invoices = await this.client.invoices.list({
      customer: input.customerId,
      limit: input.limit,
      ...(input.startingAfter
        ? {
            starting_after: input.startingAfter
          }
        : {})
    });

    return {
      items: invoices.data.map((invoice) => ({
        id: invoice.id,
        status: invoice.status,
        currency: invoice.currency,
        amountDueCents: invoice.amount_due,
        amountPaidCents: invoice.amount_paid,
        hostedUrl: invoice.hosted_invoice_url ?? null,
        invoicePdfUrl: invoice.invoice_pdf ?? null,
        periodStart: fromUnixTimestamp(invoice.period_start),
        periodEnd: fromUnixTimestamp(invoice.period_end),
        createdAt: new Date(invoice.created * 1000)
      })),
      nextCursor: invoices.has_more ? invoices.data[invoices.data.length - 1]?.id ?? null : null
    };
  }

  async verifyWebhookEvent(rawBody: Buffer, signatureHeader: string): Promise<StripeWebhookEvent> {
    const event = this.client.webhooks.constructEvent(rawBody, signatureHeader, this.webhookSecret);

    return {
      id: event.id,
      type: event.type,
      createdAt: new Date(event.created * 1000),
      livemode: event.livemode,
      payload: buildStripeWebhookPayload(event)
    };
  }
}
