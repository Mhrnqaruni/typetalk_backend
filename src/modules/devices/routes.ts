import type { FastifyPluginAsync } from "fastify";

import { AppError } from "../../lib/app-error";
import { requireAuthContext } from "../../plugins/auth";
import { DeviceService } from "./service";
import {
  deviceHeartbeatSchema,
  deviceListQuerySchema,
  devicePayloadSchema,
  mapDeviceHeartbeatPayload,
  mapDevicePayload
} from "./schemas";

interface DeviceRoutesDependencies {
  deviceService: DeviceService;
}

function getRequiredIdempotencyKey(headerValue: string | string[] | undefined): string {
  const idempotencyKey = Array.isArray(headerValue) ? headerValue[0] : headerValue;

  if (!idempotencyKey || !idempotencyKey.trim()) {
    throw new AppError(400, "missing_idempotency_key", "Idempotency-Key header is required.");
  }

  return idempotencyKey.trim();
}

export function buildDeviceRoutes({
  deviceService
}: DeviceRoutesDependencies): FastifyPluginAsync {
  return async (app) => {
    app.post("/register", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      const body = devicePayloadSchema.parse(request.body);
      const result = await deviceService.registerDevice(
        context.userId,
        mapDevicePayload(body)!,
        getRequiredIdempotencyKey(request.headers["idempotency-key"])
      );

      return reply.status(result.statusCode).send(result.body);
    });

    app.patch("/:deviceId/heartbeat", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      const params = request.params as { deviceId: string };
      const body = deviceHeartbeatSchema.parse(request.body);
      const result = await deviceService.heartbeatDevice(
        context.userId,
        params.deviceId,
        mapDeviceHeartbeatPayload(body)
      );

      return reply.send(result);
    });

    app.get("/", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      const query = deviceListQuerySchema.parse(request.query);
      const result = await deviceService.listDevices(context.userId, query.limit, query.cursor);

      return reply.send(result);
    });

    app.delete("/:deviceId", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      const params = request.params as { deviceId: string };

      await deviceService.deleteDevice(context.userId, params.deviceId);

      return reply.status(204).send();
    });
  };
}
