import type { FastifyPluginAsync } from "fastify";

import { requireAuthContext } from "../../plugins/auth";
import { OrganizationService } from "./service";
import { organizationMembersQuerySchema } from "./schemas";

interface OrganizationRoutesDependencies {
  organizationService: OrganizationService;
}

export function buildOrganizationRoutes({
  organizationService
}: OrganizationRoutesDependencies): FastifyPluginAsync {
  return async (app) => {
    app.get("/organizations/current", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      const organization = await organizationService.getCurrentOrganizationForUser(context.userId);

      return reply.send({
        id: organization.id,
        name: organization.name,
        type: organization.type,
        owner_user_id: organization.ownerUserId,
        created_at: organization.createdAt.toISOString()
      });
    });

    app.get("/organizations/members", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      const query = organizationMembersQuerySchema.parse(request.query);
      const organization = await organizationService.getCurrentOrganizationForUser(context.userId);
      const result = await organizationService.listMembers(organization.id, query.limit, query.cursor);

      return reply.send(result);
    });
  };
}
