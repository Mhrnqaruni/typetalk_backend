import type { FastifyPluginAsync } from "fastify";

import { getConfig } from "../../config/env";
import { getRequestMetadata } from "../../lib/request-metadata";
import { mapDevicePayload } from "../devices/schemas";
import { type AuthRateLimiter } from "./rate-limiter";
import {
  googleSignInSchema,
  requestEmailCodeSchema,
  verifyEmailCodeSchema
} from "./schemas";
import { type AuthService } from "./service";
import {
  assertTrustedBrowserOrigin,
  clearWebRefreshCookie,
  requireWebRefreshCookie,
  setWebRefreshCookie,
  toWebAuthPayload
} from "./web-session";

interface WebAuthRoutesDependencies {
  authService: AuthService;
  authRateLimiter: AuthRateLimiter;
}

export function buildWebAuthRoutes({
  authService,
  authRateLimiter
}: WebAuthRoutesDependencies): FastifyPluginAsync {
  return async (app) => {
    const config = getConfig();

    app.post("/email/request-code", {
      preHandler: async (request) => {
        await authRateLimiter.assertCanRequestCode(getRequestMetadata(request));
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
        await authRateLimiter.assertCanRequestCode(getRequestMetadata(request));
      }
    }, async (request, reply) => {
      const body = requestEmailCodeSchema.parse(request.body);
      await authService.resendEmailCode(body, getRequestMetadata(request));

      return reply.status(202).send({
        status: "accepted"
      });
    });

    app.post("/email/verify-code", {
      preHandler: [async (request) => {
        assertTrustedBrowserOrigin(request, config);
      }, async (request) => {
        await authRateLimiter.assertCanVerifyCode(getRequestMetadata(request));
      }]
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

      setWebRefreshCookie(reply, result.refresh_token, config);
      return reply.send(toWebAuthPayload(result));
    });

    app.post("/google", {
      preHandler: async (request) => {
        assertTrustedBrowserOrigin(request, config);
      }
    }, async (request, reply) => {
      const body = googleSignInSchema.parse(request.body);
      const result = await authService.signInWithGoogle(
        {
          idToken: body.id_token,
          device: mapDevicePayload(body.device),
          audience: "web"
        },
        getRequestMetadata(request)
      );

      setWebRefreshCookie(reply, result.refresh_token, config);
      return reply.send(toWebAuthPayload(result));
    });

    app.post("/refresh", {
      preHandler: async (request) => {
        assertTrustedBrowserOrigin(request, config);
      }
    }, async (request, reply) => {
      const refreshToken = requireWebRefreshCookie(request, config);
      const result = await authService.refreshSession(refreshToken, getRequestMetadata(request));

      setWebRefreshCookie(reply, result.refresh_token, config);
      return reply.send(toWebAuthPayload(result));
    });

    app.post("/logout", {
      preHandler: async (request) => {
        assertTrustedBrowserOrigin(request, config);
      }
    }, async (request, reply) => {
      const refreshToken = request.cookies[config.webAuthRefreshCookieName];

      if (refreshToken) {
        await authService.revokeSessionByRefreshToken(refreshToken);
      }

      clearWebRefreshCookie(reply, config);
      return reply.status(204).send();
    });
  };
}
