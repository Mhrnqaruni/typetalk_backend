import { createHmac, timingSafeEqual } from "node:crypto";

import { AppError } from "../../lib/app-error";
import type {
  PaddleCheckoutSessionInput,
  PaddleCheckoutSessionResult,
  PaddleCustomerInput,
  PaddleCustomerPortalInput,
  PaddleCustomerPortalResult,
  PaddleInvoiceListInput,
  PaddleInvoiceListResult,
  PaddleProvider,
  PaddleWebhookEvent
} from "./provider";

const PADDLE_API_BASE_URL = "https://api.paddle.com";

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function parseAmountCents(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return Math.round(parsed * 100);
    }
  }

  return 0;
}

function getRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function getFirstItemPriceId(data: Record<string, unknown>): string | null {
  const items = Array.isArray(data.items) ? data.items : [];
  const firstItem = getRecord(items[0]);
  const nestedPrice = getRecord(firstItem?.price);

  return parseString(nestedPrice?.id) ?? parseString(firstItem?.price_id);
}

function getCustomData(data: Record<string, unknown>): Record<string, unknown> | null {
  return getRecord(data.custom_data);
}

function extractPaginationAfterCursor(next: string | null): string | null {
  if (!next) {
    return null;
  }

  try {
    const parsed = new URL(next, PADDLE_API_BASE_URL);
    return parseString(parsed.searchParams.get("after")) ?? next;
  } catch {
    return next;
  }
}

function buildPaddleWebhookEvent(parsed: Record<string, unknown>): PaddleWebhookEvent {
  const data = getRecord(parsed.data);
  const eventId = parseString(parsed.event_id) ?? parseString(parsed.notification_id);
  const eventType = parseString(parsed.event_type);

  if (!data || !eventId || !eventType) {
    throw new AppError(400, "invalid_webhook_body", "Paddle webhook payload is invalid.");
  }

  const currentBillingPeriod = getRecord(data.current_billing_period);
  const customData = getCustomData(data);
  const status = parseString(data.status);
  const nextBilledAt = parseDate(data.next_billed_at);

  return {
    id: eventId,
    type: eventType,
    occurredAt: parseDate(parsed.occurred_at) ?? new Date(),
    payload: {
      entityId: parseString(data.id) ?? eventId,
      status,
      customerId: parseString(data.customer_id),
      subscriptionId: parseString(data.subscription_id),
      transactionId: eventType.startsWith("transaction.")
        ? parseString(data.id)
        : parseString(data.transaction_id),
      priceId: getFirstItemPriceId(data),
      organizationId: parseString(customData?.organization_id),
      planCode: parseString(customData?.plan_code),
      currencyCode: parseString(data.currency_code),
      currentPeriodStart: parseDate(currentBillingPeriod?.starts_at),
      currentPeriodEnd: parseDate(currentBillingPeriod?.ends_at),
      startedAt: parseDate(data.started_at) ?? parseDate(data.created_at),
      nextBilledAt,
      trialEndsAt: status === "trialing" ? nextBilledAt : null,
      canceledAt: parseDate(data.canceled_at)
    }
  };
}

export class LivePaddleProvider implements PaddleProvider {
  constructor(
    private readonly apiKey: string,
    private readonly webhookSecret: string
  ) {}

  async createCustomer(input: PaddleCustomerInput): Promise<{ id: string }> {
    const response = await this.request("POST", "/customers", {
      email: input.email,
      name: input.name,
      custom_data: {
        organization_id: input.organizationId,
        ...(input.customData ?? {})
      }
    });
    const data = getRecord(response.data);
    const id = parseString(data?.id);

    if (!id) {
      throw new Error("Paddle customer creation did not return an id.");
    }

    return {
      id
    };
  }

  async createCheckoutSession(input: PaddleCheckoutSessionInput): Promise<PaddleCheckoutSessionResult> {
    const response = await this.request("POST", "/transactions", {
      customer_id: input.customerId,
      collection_mode: "automatic",
      items: [
        {
          price_id: input.priceId,
          quantity: 1
        }
      ],
      custom_data: {
        organization_id: input.organizationId,
        user_id: input.userId,
        plan_code: input.planCode,
        trial_days: String(input.trialDays),
        success_url: input.successUrl,
        cancel_url: input.cancelUrl
      }
    }, input.idempotencyKey);
    const data = getRecord(response.data);
    const checkout = getRecord(data?.checkout);
    const id = parseString(data?.id);
    const url = parseString(checkout?.url) ?? parseString(data?.checkout_url);
    const customerId = parseString(data?.customer_id) ?? input.customerId;

    if (!id || !url) {
      throw new Error("Paddle checkout session did not return an id and URL.");
    }

    return {
      id,
      url,
      customerId,
      expiresAt: parseDate(data?.updated_at) ?? null
    };
  }

  async createCustomerPortalSession(
    input: PaddleCustomerPortalInput
  ): Promise<PaddleCustomerPortalResult> {
    const response = await this.request("POST", `/customers/${encodeURIComponent(input.customerId)}/portal-sessions`, {
      subscription_ids: input.subscriptionIds ?? []
    });
    const data = getRecord(response.data);
    const urls = getRecord(data?.urls);
    const general = getRecord(urls?.general);
    const id = parseString(data?.id);
    const url = parseString(general?.overview);

    if (!id || !url) {
      throw new Error("Paddle customer portal session did not return an id and URL.");
    }

    return {
      id,
      url
    };
  }

  async listInvoices(input: PaddleInvoiceListInput): Promise<PaddleInvoiceListResult> {
    const query = new URLSearchParams({
      customer_id: input.customerId,
      per_page: String(input.limit)
    });

    if (input.startingAfter) {
      query.set("after", input.startingAfter);
    }

    const response = await this.request("GET", `/transactions?${query.toString()}`);
    const items = Array.isArray(response.data) ? response.data : [];
    const meta = getRecord(response.meta);
    const pagination = getRecord(meta?.pagination);
    const next = extractPaginationAfterCursor(parseString(pagination?.next));

    return {
      items: items.map((item) => {
        const row = getRecord(item) ?? {};
        const details = getRecord(row.details);
        const totals = getRecord(details?.totals);
        const billingPeriod = getRecord(row.billing_period);

        return {
          id: parseString(row.id) ?? "unknown",
          status: parseString(row.status),
          currency: parseString(row.currency_code),
          amountDueCents: parseAmountCents(totals?.grand_total ?? totals?.total),
          amountPaidCents: parseAmountCents(totals?.grand_total ?? totals?.total),
          hostedUrl: parseString(row.checkout_url),
          invoicePdfUrl: parseString(row.invoice_pdf_url),
          periodStart: parseDate(billingPeriod?.starts_at),
          periodEnd: parseDate(billingPeriod?.ends_at),
          createdAt: parseDate(row.created_at) ?? new Date()
        };
      }),
      nextCursor: next
    };
  }

  async verifyWebhookEvent(rawBody: Buffer, signatureHeader: string): Promise<PaddleWebhookEvent> {
    const parsedHeader = this.parseSignatureHeader(signatureHeader);
    const signedPayload = `${parsedHeader.timestamp}:${rawBody.toString("utf8")}`;
    const expectedSignature = createHmac("sha256", this.webhookSecret)
      .update(signedPayload)
      .digest("hex");

    if (!this.signaturesMatch(parsedHeader.signature, expectedSignature)) {
      throw new AppError(400, "invalid_webhook_signature", "Webhook signature is invalid.");
    }

    let parsedBody: Record<string, unknown>;

    try {
      parsedBody = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
    } catch {
      throw new AppError(400, "invalid_webhook_body", "Webhook body must be valid JSON.");
    }

    return buildPaddleWebhookEvent(parsedBody);
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>,
    idempotencyKey?: string
  ): Promise<Record<string, unknown>> {
    const response = await fetch(`${PADDLE_API_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(idempotencyKey
          ? {
              "Idempotency-Key": idempotencyKey
            }
          : {})
      },
      ...(body
        ? {
            body: JSON.stringify(body)
          }
        : {})
    });

    const payloadText = await response.text();
    const payload = payloadText
      ? JSON.parse(payloadText) as Record<string, unknown>
      : {};

    if (!response.ok) {
      const error = getRecord(payload.error);
      throw new Error(parseString(error?.detail) ?? parseString(error?.message) ?? `Paddle API request failed with status ${response.status}.`);
    }

    return payload;
  }

  private parseSignatureHeader(signatureHeader: string): {
    timestamp: string;
    signature: string;
  } {
    const pairs = signatureHeader.split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [key, value] = part.split("=", 2);
        return [key?.trim(), value?.trim()] as const;
      });
    const timestamp = pairs.find(([key]) => key === "ts")?.[1];
    const signature = pairs.find(([key]) => key === "h1")?.[1];

    if (!timestamp || !signature) {
      throw new AppError(400, "invalid_webhook_signature", "Webhook signature is invalid.");
    }

    return {
      timestamp,
      signature
    };
  }

  private signaturesMatch(received: string, expected: string): boolean {
    try {
      return timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
    } catch {
      return false;
    }
  }
}
