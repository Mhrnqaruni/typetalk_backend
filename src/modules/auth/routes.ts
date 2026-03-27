import type { FastifyPluginAsync, FastifyRequest } from "fastify";

import { mapDevicePayload } from "../devices/schemas";
import { requireAuthContext } from "../../plugins/auth";
import { type AuthRateLimiter } from "./rate-limiter";
import { type AuthService } from "./service";
import {
  googleSignInSchema,
  linkGoogleSchema,
  refreshSchema,
  requestEmailCodeSchema,
  verifyEmailCodeSchema
} from "./schemas";

interface AuthRoutesDependencies {
  authService: AuthService;
  authRateLimiter: AuthRateLimiter;
}

function getRequestMetadata(request: FastifyRequest) {
  const ipCountryCode = request.headers["x-country-code"] ?? request.headers["cf-ipcountry"];

  return {
    userAgent: typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : null,
    ipAddress: request.ip,
    ipCountryCode: typeof ipCountryCode === "string" ? ipCountryCode : null
  };
}

export function buildAuthRoutes({
  authService,
  authRateLimiter
}: AuthRoutesDependencies): FastifyPluginAsync {
  return async (app) => {
    app.post("/email/request-code", {
      preHandler: async (request) => {
        authRateLimiter.assertCanRequestCode(request.ip);
      }
    }, async (request, reply) => {
      const body = requestEmailCodeSchema.parse(request.body);
      await authService.requestEmailCode(body, getRequestMetadata(request));

      return reply.status(202).send({
        status: "accepted"
      });
    });

    app.post("/email/resend-code", {
      preHandler: async (request) => {
        authRateLimiter.assertCanRequestCode(request.ip);
      }
    }, async (request, reply) => {
      const body = requestEmailCodeSchema.parse(request.body);
      await authService.resendEmailCode(body, getRequestMetadata(request));

      return reply.status(202).send({
        status: "accepted"
      });
    });

    app.post("/email/verify-code", {
      preHandler: async (request) => {
        authRateLimiter.assertCanVerifyCode(request.ip);
      }
    }, async (request, reply) => {
      const body = verifyEmailCodeSchema.parse(request.body);
      const result = await authService.verifyEmailCode(
        {
          email: body.email,
          code: body.code,
          purpose: body.purpose,
          device: mapDevicePayload(body.device)
        },
        getRequestMetadata(request)
      );

      return reply.send(result);
    });

    app.post("/google", async (request, reply) => {
      const body = googleSignInSchema.parse(request.body);
      const result = await authService.signInWithGoogle(
        {
          idToken: body.id_token,
          device: mapDevicePayload(body.device)
        },
        getRequestMetadata(request)
      );

      return reply.send(result);
    });

    app.post("/link/google", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const body = linkGoogleSchema.parse(request.body);
      const context = requireAuthContext(request);
      const result = await authService.linkGoogle(context, {
        idToken: body.id_token
      });

      return reply.send(result);
    });

    app.post("/refresh", async (request, reply) => {
      const body = refreshSchema.parse(request.body);
      const result = await authService.refreshSession(body.refresh_token, getRequestMetadata(request));

      return reply.send(result);
    });

    app.post("/logout", {
      preHandler: [app.authenticate]
    }, async (request, reply) => {
      const context = requireAuthContext(request);
      await authService.revokeSession(context.sessionId);

      return reply.status(204).send();
    });
  };
}
