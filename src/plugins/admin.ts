import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "../lib/app-error";
import { normalizeEmail } from "../lib/email";
import { getConfig } from "../config/env";
import { getRequestMetadata } from "../lib/request-metadata";
import { requireAuthContext } from "./auth";
import { SecurityService } from "../modules/security/service";

interface RegisterAdminPluginOptions {
  securityService: SecurityService;
}

export async function registerAdminPlugin(
  app: FastifyInstance,
  options: RegisterAdminPluginOptions
): Promise<void> {
  const config = getConfig();

  app.decorate(
    "authorizeAdmin",
    async function authorizeAdmin(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
      const context = requireAuthContext(request);
      const normalizedEmail = normalizeEmail(context.user.primaryEmail);

      if (config.adminAllowlistEmails.includes(normalizedEmail)) {
        return;
      }

      const metadata = getRequestMetadata(request);
      await options.securityService.recordAdminAccessDenied({
        userId: context.userId,
        organizationId: context.organizationId,
        deviceId: context.session.deviceId,
        requestId: request.id,
        method: request.method,
        path: request.routeOptions.url ?? request.url,
        actorEmail: context.user.primaryEmail,
        ipAddress: metadata.ipAddress,
        countryCode: metadata.ipCountryCode
      });

      throw new AppError(403, "admin_forbidden", "Admin access is required.");
    }
  );
}
