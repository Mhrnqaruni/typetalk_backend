import type { FastifyPluginAsync } from "fastify";

import { requireAuthContext } from "../../plugins/auth";
import { EntitlementService } from "./service";

interface EntitlementRoutesDependencies {
  entitlementService: EntitlementService;
}

export function buildEntitlementRoutes({
  entitlementService
}: EntitlementRoutesDependencies): FastifyPluginAsync {
  return async (app) => {
    app.get("/entitlements/current", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      const result = await entitlementService.getCurrentEntitlement(context.organizationId);

      return reply.send(result);
    });
  };
}
