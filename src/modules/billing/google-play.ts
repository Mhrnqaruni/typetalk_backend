import { SubscriptionStatus } from "@prisma/client";
import { GoogleAuth, OAuth2Client, type JWTInput } from "google-auth-library";
import { existsSync, readFileSync } from "node:fs";

import { AppError } from "../../lib/app-error";
import type {
  GooglePlayAcknowledgeInput,
  GooglePlayProvider,
  GooglePlayRtdnEvent,
  GooglePlaySubscriptionState
} from "./provider";

const ANDROID_PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

function parseDateTime(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseMillis(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = new Date(Number(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function invalidGoogleRtdnPayload(message = "Google RTDN payload is invalid."): AppError {
  return new AppError(400, "invalid_google_rtdn_payload", message);
}

function decodeBase64Utf8(encodedData: string): string {
  const normalized = encodedData.replace(/\s+/g, "");

  if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw invalidGoogleRtdnPayload();
  }

  try {
    return UTF8_DECODER.decode(Buffer.from(normalized, "base64"));
  } catch {
    throw invalidGoogleRtdnPayload();
  }
}

export function parseGooglePlayRtdnPayload(rawBody: Buffer, packageName: string): GooglePlayRtdnEvent {
  let envelope: {
    message?: {
      messageId?: string;
      data?: string;
      publishTime?: string;
    };
  };

  try {
    envelope = JSON.parse(rawBody.toString("utf8")) as {
      message?: {
        messageId?: string;
        data?: string;
        publishTime?: string;
      };
    };
  } catch {
    throw invalidGoogleRtdnPayload();
  }

  const messageId = envelope.message?.messageId?.trim();
  const encodedData = envelope.message?.data?.trim();

  if (!messageId || !encodedData) {
    throw invalidGoogleRtdnPayload();
  }

  let decodedPayload: {
    packageName?: string;
    eventTimeMillis?: string | number;
    subscriptionNotification?: {
      purchaseToken?: string;
      notificationType?: number | string;
    };
  };

  try {
    decodedPayload = JSON.parse(decodeBase64Utf8(encodedData)) as {
      packageName?: string;
      eventTimeMillis?: string | number;
      subscriptionNotification?: {
        purchaseToken?: string;
        notificationType?: number | string;
      };
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw invalidGoogleRtdnPayload();
  }

  const purchaseToken = decodedPayload.subscriptionNotification?.purchaseToken?.trim();

  if (!purchaseToken) {
    throw new AppError(
      400,
      "invalid_google_rtdn_payload",
      "Google RTDN payload is missing a purchase token."
    );
  }

  if (decodedPayload.packageName !== packageName) {
    throw new AppError(
      400,
      "invalid_google_rtdn_payload",
      "Google RTDN package does not match the configured package."
    );
  }

  return {
    messageId,
    packageName: decodedPayload.packageName,
    purchaseToken,
    notificationType: String(decodedPayload.subscriptionNotification?.notificationType ?? "unknown"),
    eventTime: parseMillis(decodedPayload.eventTimeMillis),
    publishedAt: parseDateTime(envelope.message?.publishTime ?? null)
  };
}

function mapGoogleSubscriptionStatus(state: string | null | undefined): SubscriptionStatus {
  switch (state) {
    case "SUBSCRIPTION_STATE_ACTIVE":
      return SubscriptionStatus.ACTIVE;
    case "SUBSCRIPTION_STATE_IN_GRACE_PERIOD":
      return SubscriptionStatus.GRACE;
    case "SUBSCRIPTION_STATE_ON_HOLD":
      return SubscriptionStatus.PAYMENT_ISSUE;
    case "SUBSCRIPTION_STATE_CANCELED":
      return SubscriptionStatus.CANCELED;
    case "SUBSCRIPTION_STATE_EXPIRED":
      return SubscriptionStatus.EXPIRED;
    case "SUBSCRIPTION_STATE_PENDING":
    case "SUBSCRIPTION_STATE_PAUSED":
    case "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED":
    default:
      return SubscriptionStatus.INCOMPLETE;
  }
}

function parseServiceAccountJson(rawValue: string): JWTInput {
  const trimmed = rawValue.trim();

  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as JWTInput;
  }

  if (existsSync(trimmed)) {
    return JSON.parse(readFileSync(trimmed, "utf8")) as JWTInput;
  }

  throw new Error("PLAY_SERVICE_ACCOUNT_JSON must contain JSON credentials or a valid file path.");
}

export class LiveGooglePlayProvider implements GooglePlayProvider {
  private readonly oidcClient = new OAuth2Client();
  private authClientPromise: Promise<Awaited<ReturnType<GoogleAuth["getClient"]>>> | null = null;

  constructor(
    private readonly packageName: string,
    private readonly serviceAccountJson: string,
    private readonly pubsubAudience: string,
    private readonly pubsubServiceAccount: string
  ) {}

  async verifySubscription(purchaseToken: string): Promise<GooglePlaySubscriptionState> {
    const client = await this.getAuthClient();
    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(this.packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
    const response = await client.request<Record<string, unknown>>({
      url,
      method: "GET"
    });
    const data = response.data;
    const lineItem = Array.isArray(data.lineItems)
      ? data.lineItems[0] as Record<string, unknown> | undefined
      : undefined;
    const autoRenewingPlan = lineItem?.autoRenewingPlan as Record<string, unknown> | undefined;
    const offerDetails = lineItem?.offerDetails as Record<string, unknown> | undefined;
    const externalSubscriptionId = purchaseToken;
    const productId = typeof lineItem?.productId === "string" ? lineItem.productId : null;
    const basePlanId = typeof offerDetails?.basePlanId === "string" ? offerDetails.basePlanId : null;
    const subscriptionState = typeof data.subscriptionState === "string" ? data.subscriptionState : null;
    const acknowledged = data.acknowledgementState === "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED";
    const expiryTime = parseDateTime(
      typeof lineItem?.expiryTime === "string" ? lineItem.expiryTime : null
    );

    if (!productId) {
      throw new AppError(
        400,
        "invalid_google_subscription_state",
        "Google subscription state is missing a product id."
      );
    }

    return {
      packageName: this.packageName,
      purchaseToken,
      linkedPurchaseToken: typeof data.linkedPurchaseToken === "string"
        ? data.linkedPurchaseToken
        : null,
      productId,
      basePlanId,
      externalSubscriptionId,
      status: mapGoogleSubscriptionStatus(subscriptionState),
      isTrial: Boolean(offerDetails?.offerId) || Boolean(offerDetails?.offerTags),
      currentPeriodStart: parseDateTime(typeof data.startTime === "string" ? data.startTime : null),
      currentPeriodEnd: expiryTime,
      trialEndsAt: subscriptionState === "SUBSCRIPTION_STATE_ACTIVE" && offerDetails
        ? expiryTime
        : null,
      canceledAt: subscriptionState === "SUBSCRIPTION_STATE_CANCELED" ? expiryTime : null,
      acknowledged,
      shouldAcknowledge: !acknowledged && subscriptionState !== "SUBSCRIPTION_STATE_PENDING"
    };
  }

  async acknowledgeSubscription(input: GooglePlayAcknowledgeInput): Promise<void> {
    const client = await this.getAuthClient();
    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(this.packageName)}/purchases/subscriptions/${encodeURIComponent(input.productId)}/tokens/${encodeURIComponent(input.purchaseToken)}:acknowledge`;

    await client.request({
      url,
      method: "POST",
      data: {}
    });
  }

  async verifyRtdn(rawBody: Buffer, authorizationHeader: string | null): Promise<GooglePlayRtdnEvent> {
    const idToken = this.extractBearerToken(authorizationHeader);
    const verification = await this.oidcClient.verifyIdToken({
      idToken,
      audience: this.pubsubAudience
    });
    const payload = verification.getPayload();

    if (!payload || payload.email !== this.pubsubServiceAccount) {
      throw new AppError(
        401,
        "invalid_google_rtdn_token",
        "Google RTDN token is invalid."
      );
    }

    return parseGooglePlayRtdnPayload(rawBody, this.packageName);
  }

  private extractBearerToken(authorizationHeader: string | null): string {
    const header = authorizationHeader?.trim();

    if (!header?.toLowerCase().startsWith("bearer ")) {
      throw new AppError(401, "invalid_google_rtdn_token", "Google RTDN token is invalid.");
    }

    const token = header.slice("Bearer ".length).trim();

    if (!token) {
      throw new AppError(401, "invalid_google_rtdn_token", "Google RTDN token is invalid.");
    }

    return token;
  }

  private async getAuthClient() {
    if (!this.authClientPromise) {
      this.authClientPromise = new GoogleAuth({
        credentials: parseServiceAccountJson(this.serviceAccountJson),
        scopes: [ANDROID_PUBLISHER_SCOPE]
      }).getClient();
    }

    return this.authClientPromise;
  }
}
