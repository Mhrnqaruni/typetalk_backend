import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../lib/app-error";
import { type AuthContext, type AuthService } from "../modules/auth/service";

interface RegisterAuthPluginOptions {
  authService: AuthService;
}

function extractBearerToken(request: FastifyRequest): string {
  const authorizationHeader = request.headers.authorization;

  if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
    throw new AppError(401, "missing_authorization", "Authorization header is required.");
  }

  return authorizationHeader.slice("Bearer ".length);
}

export async function registerAuthPlugin(
  app: FastifyInstance,
  options: RegisterAuthPluginOptions
): Promise<void> {
  app.decorateRequest("auth", null);
  app.decorate(
    "authenticate",
    async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
      const token = extractBearerToken(request);
      const context = await options.authService.authenticateAccessToken(token);

      request.auth = context;
    }
  );
}

export function requireAuthContext(request: FastifyRequest): AuthContext {
  if (!request.auth) {
    throw new AppError(401, "unauthorized", "Authentication is required.");
  }

  return request.auth;
}
