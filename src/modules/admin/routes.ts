import type { FastifyPluginAsync } from "fastify";

import { requireAuthContext } from "../../plugins/auth";
import {
  adminSubscriptionsQuerySchema,
  adminUsageQuerySchema,
  adminUserParamsSchema
} from "./schemas";
import { AdminService } from "./service";

interface AdminRoutesDependencies {
  adminService: AdminService;
}

export function buildAdminRoutes({
  adminService
}: AdminRoutesDependencies): FastifyPluginAsync {
  return async (app) => {
    const adminPreHandler = [app.authenticate, app.authorizeAdmin];

    app.get("/users/:userId", {
      preHandler: adminPreHandler
    }, async (request, reply) => {
      const params = adminUserParamsSchema.parse(request.params);
      const context = requireAuthContext(request);
      const result = await adminService.getUserDetail(params.userId, {
        actorUserId: context.userId,
        requestId: request.id
      });

      return reply.send(result);
    });

    app.get("/subscriptions", {
      preHandler: adminPreHandler
    }, async (request, reply) => {
      const query = adminSubscriptionsQuerySchema.parse(request.query);
      const context = requireAuthContext(request);
      const result = await adminService.listSubscriptions(
        {
          limit: query.limit,
          cursor: query.cursor,
          organizationId: query.organization_id,
          userId: query.user_id,
          provider: query.provider,
          status: query.status
        },
        {
          actorUserId: context.userId,
          requestId: request.id
        }
      );

      return reply.send(result);
    });

    app.get("/usage", {
      preHandler: adminPreHandler
    }, async (request, reply) => {
      const query = adminUsageQuerySchema.parse(request.query);
      const context = requireAuthContext(request);
      const result = await adminService.listUsage(
        {
          limit: query.limit,
          cursor: query.cursor,
          organizationId: query.organization_id,
          userId: query.user_id,
          featureCode: query.feature_code,
          status: query.status
        },
        {
          actorUserId: context.userId,
          requestId: request.id
        }
      );

      return reply.send(result);
    });
  };
}
