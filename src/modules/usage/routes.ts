import type { FastifyPluginAsync } from "fastify";

import { AppError } from "../../lib/app-error";
import { requireAuthContext } from "../../plugins/auth";
import {
  mapRealtimeSessionCreatePayload,
  mapUsageEventPayload,
  mapUsageFinalizePayload,
  realtimeSessionCreateSchema,
  usageEventCreateSchema,
  usageFinalizeSchema,
  usageQuotaQuerySchema
} from "./schemas";
import { UsageService } from "./service";

interface UsageRoutesDependencies {
  usageService: UsageService;
}

function getRequiredIdempotencyKey(headerValue: string | string[] | undefined): string {
  const idempotencyKey = Array.isArray(headerValue) ? headerValue[0] : headerValue;

  if (!idempotencyKey || !idempotencyKey.trim()) {
    throw new AppError(400, "missing_idempotency_key", "Idempotency-Key header is required.");
  }

  return idempotencyKey.trim();
}

export function buildUsageRoutes({
  usageService
}: UsageRoutesDependencies): FastifyPluginAsync {
  return async (app) => {
    app.post("/realtime/session", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      const body = realtimeSessionCreateSchema.parse(request.body);
      const result = await usageService.createRealtimeSession({
        organizationId: context.organizationId,
        userId: context.userId,
        ...mapRealtimeSessionCreatePayload(body)
      });

      return reply.status(201).send(result);
    });

    app.post("/usage/finalize", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      const body = usageFinalizeSchema.parse(request.body);
      const result = await usageService.finalizeUsage({
        organizationId: context.organizationId,
        userId: context.userId,
        ...mapUsageFinalizePayload(body),
        idempotencyKey: getRequiredIdempotencyKey(request.headers["idempotency-key"])
      });

      return reply.status(result.statusCode).send(result.body);
    });

    app.post("/usage/events", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      const body = usageEventCreateSchema.parse(request.body);
      const result = await usageService.recordTelemetryEvent({
        organizationId: context.organizationId,
        userId: context.userId,
        ...mapUsageEventPayload(body)
      });

      return reply.status(201).send(result);
    });

    app.get("/usage/quota", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      const query = usageQuotaQuerySchema.parse(request.query);
      const result = await usageService.getQuota(
        context.organizationId,
        context.userId,
        query.feature_code
      );

      return reply.send(result);
    });

    app.get("/usage/summary", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      const result = await usageService.getSummary(context.organizationId, context.userId);

      return reply.send(result);
    });
  };
}
