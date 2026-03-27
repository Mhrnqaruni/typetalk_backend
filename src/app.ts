import cors from "@fastify/cors";
import { Prisma, type PrismaClient } from "@prisma/client";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";

import { getConfig } from "./config/env";
import { AppError } from "./lib/app-error";
import { createEmailProvider, type EmailProvider } from "./lib/email-provider";
import { getPrismaClient } from "./lib/prisma";
import { buildAuthRoutes } from "./modules/auth/routes";
import { GoogleIdTokenVerifier, type GoogleVerifier } from "./modules/auth/google";
import { createAuthRateLimiter, type AuthRateLimiter } from "./modules/auth/rate-limiter";
import { AuthRepository } from "./modules/auth/repository";
import { AuthService } from "./modules/auth/service";
import { buildBillingRoutes, buildStripeWebhookRoutes } from "./modules/billing/routes";
import { LiveGooglePlayProvider } from "./modules/billing/google-play";
import { BillingRepository } from "./modules/billing/repository";
import type { GooglePlayProvider, StripeProvider } from "./modules/billing/provider";
import { BillingService } from "./modules/billing/service";
import { LiveStripeProvider } from "./modules/billing/stripe";
import { DeviceRepository } from "./modules/devices/repository";
import { buildDeviceRoutes } from "./modules/devices/routes";
import { DeviceService } from "./modules/devices/service";
import { buildEntitlementRoutes } from "./modules/entitlements/routes";
import { EntitlementRepository } from "./modules/entitlements/repository";
import { EntitlementService } from "./modules/entitlements/service";
import { buildHealthRoutes } from "./modules/health/routes";
import { buildOrganizationRoutes } from "./modules/organizations/routes";
import { OrganizationService } from "./modules/organizations/service";
import { buildPreferencesRoutes } from "./modules/preferences/routes";
import { PreferencesRepository } from "./modules/preferences/repository";
import { PreferencesService } from "./modules/preferences/service";
import { SecurityRepository } from "./modules/security/repository";
import { SecurityService } from "./modules/security/service";
import { buildUsageRoutes } from "./modules/usage/routes";
import { UsageRepository } from "./modules/usage/repository";
import { UsageService } from "./modules/usage/service";
import { buildUserRoutes } from "./modules/users/routes";
import { UserService } from "./modules/users/service";
import { registerAuthPlugin } from "./plugins/auth";

interface BuildAppOptions {
  prisma?: PrismaClient;
  emailProvider?: EmailProvider;
  googleVerifier?: GoogleVerifier;
  authRateLimiter?: AuthRateLimiter;
  stripeProvider?: StripeProvider;
  googlePlayProvider?: GooglePlayProvider;
}

export async function buildApp(
  options: BuildAppOptions = {}
): Promise<FastifyInstance> {
  const config = getConfig();
  const prisma = options.prisma ?? getPrismaClient();
  const emailProvider = options.emailProvider ?? createEmailProvider(config);
  const googleVerifier = options.googleVerifier ?? new GoogleIdTokenVerifier(config.googleClientId);
  const authRateLimiter = options.authRateLimiter ?? createAuthRateLimiter(config);
  const stripeProvider = options.stripeProvider
    ?? new LiveStripeProvider(config.stripeSecretKey, config.stripeWebhookSecret);
  const googlePlayProvider = options.googlePlayProvider
    ?? new LiveGooglePlayProvider(
      config.playPackageName,
      config.playServiceAccountJson,
      config.playPubsubAudience,
      config.playPubsubServiceAccount
    );
  const securityRepository = new SecurityRepository(prisma);
  const securityService = new SecurityService(securityRepository);
  const organizationService = new OrganizationService(prisma);
  const userService = new UserService(prisma);
  const authRepository = new AuthRepository(prisma);
  const billingRepository = new BillingRepository(prisma);
  const entitlementRepository = new EntitlementRepository(prisma);
  const entitlementService = new EntitlementService(billingRepository, entitlementRepository);
  const deviceRepository = new DeviceRepository(prisma);
  const deviceService = new DeviceService(prisma, deviceRepository, authRepository);
  const preferencesRepository = new PreferencesRepository(prisma);
  const preferencesService = new PreferencesService(prisma, preferencesRepository);
  const usageRepository = new UsageRepository(prisma);
  const usageService = new UsageService(
    prisma,
    usageRepository,
    deviceRepository,
    billingRepository,
    entitlementService
  );
  const billingService = new BillingService(
    prisma,
    billingRepository,
    entitlementService,
    stripeProvider,
    googlePlayProvider
  );
  const authService = new AuthService(
    prisma,
    authRepository,
    deviceService,
    userService,
    organizationService,
    securityService,
    emailProvider,
    googleVerifier
  );
  const app = Fastify({
    logger: true,
    bodyLimit: config.maxJsonBodyBytes,
    requestIdHeader: "x-request-id"
  });

  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || config.allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin not allowed"), false);
    }
  });

  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id;
    const prismaAppError = mapPrismaError(error);
    const normalizedError = prismaAppError ?? error;
    const message = normalizedError instanceof Error ? normalizedError.message : "Request failed.";

    request.log.error({ err: error }, "Request failed");

    if (normalizedError instanceof ZodError) {
      reply.status(400).send({
        error: {
          code: "validation_error",
          message: "Request validation failed.",
          details: normalizedError.flatten()
        },
        request_id: requestId
      });

      return;
    }

    if (normalizedError instanceof AppError) {
      reply.status(normalizedError.statusCode).send({
        error: {
          code: normalizedError.code,
          message: normalizedError.message,
          details: normalizedError.details
        },
        request_id: requestId
      });

      return;
    }

    const statusCode = typeof (normalizedError as { statusCode?: number }).statusCode === "number"
      ? (normalizedError as { statusCode: number }).statusCode
      : 500;

    reply.status(statusCode).send({
      error: {
        code: statusCode >= 500 ? "internal_error" : "request_error",
        message: statusCode >= 500 ? "Internal server error." : message,
        details: null
      },
      request_id: requestId
    });
  });

  app.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  await registerAuthPlugin(app, { authService });
  await app.register(buildHealthRoutes({ prisma }));
  await app.register(buildAuthRoutes({ authService, authRateLimiter }), {
    prefix: "/v1/auth"
  });
  await app.register(buildDeviceRoutes({ deviceService }), {
    prefix: "/v1/devices"
  });
  await app.register(buildUserRoutes({ authService, userService }), {
    prefix: "/v1"
  });
  await app.register(buildOrganizationRoutes({ organizationService }), {
    prefix: "/v1"
  });
  await app.register(buildPreferencesRoutes({ preferencesService }), {
    prefix: "/v1"
  });
  await app.register(buildBillingRoutes({ billingService }), {
    prefix: "/v1/billing"
  });
  await app.register(buildStripeWebhookRoutes({ billingService }), {
    prefix: "/v1/webhooks"
  });
  await app.register(buildEntitlementRoutes({ entitlementService }), {
    prefix: "/v1"
  });
  await app.register(buildUsageRoutes({ usageService }), {
    prefix: "/v1"
  });

  app.get("/", async () => ({
    service: "typetalk-backend",
    status: "ok"
  }));

  return app;
}

function mapPrismaError(error: unknown): AppError | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return null;
  }

  if (error.code === "P2002") {
    return new AppError(409, "resource_conflict", "Request conflicts with existing data.");
  }

  if (error.code === "P2025") {
    return new AppError(404, "resource_not_found", "Resource was not found.");
  }

  return null;
}
