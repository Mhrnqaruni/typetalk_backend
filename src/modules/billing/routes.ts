import type { FastifyPluginAsync } from "fastify";

import { getConfig } from "../../config/env";
import { AppError } from "../../lib/app-error";
import { requireAuthContext } from "../../plugins/auth";
import {
  billingInvoicesQuerySchema,
  checkoutSessionCreateSchema,
  googlePlaySubscriptionActionSchema,
  paddleCustomerPortalCreateSchema,
  stripeCustomerPortalCreateSchema
} from "./schemas";
import { BillingService } from "./service";

interface BillingRoutesDependencies {
  billingService: BillingService;
}

function getRequiredIdempotencyKey(headerValue: string | string[] | undefined): string {
  const idempotencyKey = Array.isArray(headerValue) ? headerValue[0] : headerValue;

  if (!idempotencyKey || !idempotencyKey.trim()) {
    throw new AppError(400, "missing_idempotency_key", "Idempotency-Key header is required.");
  }

  return idempotencyKey.trim();
}

export function buildBillingRoutes({
  billingService
}: BillingRoutesDependencies): FastifyPluginAsync {
  return async (app) => {
    app.get("/plans", async (_request, reply) => {
      const result = await billingService.listPlans();
      return reply.send(result);
    });

    app.get("/subscription", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      const result = await billingService.getCurrentSubscriptionSummary(context.organizationId);

      return reply.send(result);
    });

    app.post("/paddle/checkout", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      const body = checkoutSessionCreateSchema.parse(request.body);
      const result = await billingService.createPaddleCheckoutSession({
        userId: context.userId,
        organizationId: context.organizationId,
        email: context.user.primaryEmail,
        displayName: context.user.displayName,
        planCode: body.plan_code,
        successUrl: body.success_url,
        cancelUrl: body.cancel_url,
        idempotencyKey: getRequiredIdempotencyKey(request.headers["idempotency-key"])
      });

      return reply.status(result.statusCode).send(result.body);
    });

    app.post("/stripe/checkout-session", {
      preHandler: [app.authenticate]
    }, async (_request, _reply) => {
      billingService.rejectLegacyStripeCheckoutSession();
    });

    app.post("/paddle/customer-portal", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      paddleCustomerPortalCreateSchema.parse(request.body ?? {});
      const result = await billingService.createPaddleCustomerPortalSession(
        context.organizationId
      );

      return reply.send(result);
    });

    app.post("/stripe/customer-portal", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      const body = stripeCustomerPortalCreateSchema.parse(request.body);
      const result = await billingService.createStripeCustomerPortalSession(
        context.organizationId,
        body.return_url
      );

      return reply.send(result);
    });

    app.post("/google-play/verify-subscription", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      const body = googlePlaySubscriptionActionSchema.parse(request.body);
      const result = await billingService.verifyGooglePlaySubscription({
        userId: context.userId,
        organizationId: context.organizationId,
        purchaseToken: body.purchase_token,
        productId: body.product_id,
        basePlanId: body.base_plan_id ?? null,
        idempotencyKey: getRequiredIdempotencyKey(request.headers["idempotency-key"])
      });

      return reply.status(result.statusCode).send(result.body);
    });

    app.post("/google-play/restore", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      const body = googlePlaySubscriptionActionSchema.parse(request.body);
      const result = await billingService.restoreGooglePlaySubscription({
        userId: context.userId,
        organizationId: context.organizationId,
        purchaseToken: body.purchase_token,
        productId: body.product_id,
        basePlanId: body.base_plan_id ?? null,
        idempotencyKey: getRequiredIdempotencyKey(request.headers["idempotency-key"])
      });

      return reply.status(result.statusCode).send(result.body);
    });

    app.get("/invoices", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      const query = billingInvoicesQuerySchema.parse(request.query);
      const result = await billingService.listInvoices(
        context.organizationId,
        query.limit,
        query.cursor
      );

      return reply.send(result);
    });
  };
}

export function buildStripeWebhookRoutes({
  billingService
}: BillingRoutesDependencies): FastifyPluginAsync {
  return async (app) => {
    const config = getConfig();

    app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => {
      done(null, body);
    });

    app.post("/stripe", {
      bodyLimit: config.maxWebhookBodyBytes
    }, async (request, reply) => {
      const signatureHeader = request.headers["stripe-signature"];
      const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

      if (!signature || !signature.trim()) {
        throw new AppError(400, "invalid_webhook_signature", "Webhook signature is invalid.");
      }

      if (!Buffer.isBuffer(request.body)) {
        throw new AppError(400, "invalid_webhook_body", "Webhook body must be raw bytes.");
      }

      const result = await billingService.receiveStripeWebhook(request.body, signature.trim());

      return reply.status(result.statusCode).send(result.body);
    });

    app.post("/paddle", {
      bodyLimit: config.maxWebhookBodyBytes
    }, async (request, reply) => {
      const signatureHeader = request.headers["paddle-signature"];
      const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

      if (!signature || !signature.trim()) {
        throw new AppError(400, "invalid_webhook_signature", "Webhook signature is invalid.");
      }

      if (!Buffer.isBuffer(request.body)) {
        throw new AppError(400, "invalid_webhook_body", "Webhook body must be raw bytes.");
      }

      const result = await billingService.receivePaddleWebhook(request.body, signature.trim());

      return reply.status(result.statusCode).send(result.body);
    });

    app.post("/google-play/rtdn", {
      bodyLimit: config.maxWebhookBodyBytes
    }, async (request, reply) => {
      if (!Buffer.isBuffer(request.body)) {
        throw new AppError(400, "invalid_webhook_body", "Webhook body must be raw bytes.");
      }

      const authorizationHeader = request.headers.authorization;
      const authorization = Array.isArray(authorizationHeader)
        ? authorizationHeader[0] ?? null
        : authorizationHeader ?? null;
      const result = await billingService.receiveGooglePlayRtdn(request.body, authorization);

      return reply.status(result.statusCode).send(result.body);
    });
  };
}
