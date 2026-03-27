import type { FastifyPluginAsync } from "fastify";

import { requireAuthContext } from "../../plugins/auth";
import {
  appProfileUpsertSchema,
  dictionaryCreateSchema,
  mapAppProfilePayload,
  mapDictionaryPayload,
  mapPreferencesPayload,
  mapWritingProfilePatchPayload,
  mapWritingProfilePayload,
  preferencesPutSchema,
  syncListQuerySchema,
  writingProfileCreateSchema,
  writingProfilePatchSchema
} from "./schemas";
import { PreferencesService } from "./service";

interface PreferencesRoutesDependencies {
  preferencesService: PreferencesService;
}

export function buildPreferencesRoutes({
  preferencesService
}: PreferencesRoutesDependencies): FastifyPluginAsync {
  return async (app) => {
    app.get("/preferences", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      const result = await preferencesService.getPreferences(context.userId);

      return reply.send(result);
    });

    app.put("/preferences", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      const body = preferencesPutSchema.parse(request.body);
      const result = await preferencesService.putPreferences(
        context.userId,
        mapPreferencesPayload(body)
      );

      return reply.send(result);
    });

    app.get("/dictionary", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      const query = syncListQuerySchema.parse(request.query);
      const result = await preferencesService.listDictionaryEntries(
        context.userId,
        context.organizationId,
        query.limit,
        query.cursor
      );

      return reply.send(result);
    });

    app.post("/dictionary", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      const body = dictionaryCreateSchema.parse(request.body);
      const result = await preferencesService.createDictionaryEntry(
        context.userId,
        context.organizationId,
        mapDictionaryPayload(body)
      );

      return reply.send(result);
    });

    app.patch("/dictionary/:entryId", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      const params = request.params as { entryId: string };
      const body = dictionaryCreateSchema.parse(request.body);
      const result = await preferencesService.updateDictionaryEntry(
        context.userId,
        context.organizationId,
        params.entryId,
        mapDictionaryPayload(body)
      );

      return reply.send(result);
    });

    app.delete("/dictionary/:entryId", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      const params = request.params as { entryId: string };

      await preferencesService.deleteDictionaryEntry(
        context.userId,
        context.organizationId,
        params.entryId
      );

      return reply.status(204).send();
    });

    app.get("/writing-profiles", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      const query = syncListQuerySchema.parse(request.query);
      const result = await preferencesService.listWritingProfiles(
        context.userId,
        context.organizationId,
        query.limit,
        query.cursor
      );

      return reply.send(result);
    });

    app.post("/writing-profiles", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      const body = writingProfileCreateSchema.parse(request.body);
      const result = await preferencesService.createWritingProfile(
        context.userId,
        context.organizationId,
        mapWritingProfilePayload(body)
      );

      return reply.send(result);
    });

    app.patch("/writing-profiles/:profileId", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      const params = request.params as { profileId: string };
      const body = writingProfilePatchSchema.parse(request.body);
      const result = await preferencesService.updateWritingProfile(
        context.userId,
        context.organizationId,
        params.profileId,
        mapWritingProfilePatchPayload(body)
      );

      return reply.send(result);
    });

    app.get("/app-profiles", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      const query = syncListQuerySchema.parse(request.query);
      const result = await preferencesService.listAppProfiles(
        context.userId,
        context.organizationId,
        query.limit,
        query.cursor
      );

      return reply.send(result);
    });

    app.put("/app-profiles/:appKey", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      const params = request.params as { appKey: string };
      const body = appProfileUpsertSchema.parse(request.body);
      const result = await preferencesService.upsertAppProfile(
        context.userId,
        context.organizationId,
        params.appKey,
        mapAppProfilePayload(body)
      );

      return reply.send(result);
    });
  };
}
