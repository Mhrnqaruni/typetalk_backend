import type { FastifyPluginAsync } from "fastify";

import { requireAuthContext } from "../../plugins/auth";
import { type AuthService } from "../auth/service";
import { UserService } from "./service";
import {
  deleteSessionParamsSchema,
  patchMeSchema,
  sessionListQuerySchema
} from "./schemas";

interface UserRoutesDependencies {
  authService: AuthService;
  userService: UserService;
}

export function buildUserRoutes({
  authService,
  userService
}: UserRoutesDependencies): FastifyPluginAsync {
  return async (app) => {
    app.get("/me", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      const profile = await userService.getProfile(context.userId);

      return reply.send(profile);
    });

    app.patch("/me", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      const body = patchMeSchema.parse(request.body);
      const updatedUser = await userService.updateProfile(context.userId, {
        displayName: body.display_name,
        avatarUrl: body.avatar_url
      });

      return reply.send(userService.serializeUser(updatedUser));
    });

    app.delete("/me", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      const deletedAt = new Date();

      await authService.revokeAllSessionsForUser(context.userId);
      await userService.softDeleteUser(context.userId, deletedAt);

      return reply.status(204).send();
    });

    app.get("/sessions", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      const query = sessionListQuerySchema.parse(request.query);
      const result = await userService.listSessions(context.userId, query.limit, query.cursor);

      return reply.send(result);
    });

    app.delete("/sessions/:sessionId", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      const params = deleteSessionParamsSchema.parse(request.params);
      const session = await userService.getOwnedSession(context.userId, params.sessionId);

      await authService.revokeSession(session.id);

      return reply.status(204).send();
    });
  };
}
