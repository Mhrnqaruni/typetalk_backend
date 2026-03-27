import type { PrismaClient } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";

interface HealthRouteDependencies {
  prisma: PrismaClient;
}

export function buildHealthRoutes({
  prisma
}: HealthRouteDependencies): FastifyPluginAsync {
  return async (app) => {
    app.get("/health", async (_request, reply) => {
      try {
        await prisma.$queryRaw`SELECT 1`;

        return reply.send({
          status: "ok",
          database: "ok"
        });
      } catch (error) {
        requestLog(app, error);

        return reply.status(503).send({
          status: "degraded",
          database: "error"
        });
      }
    });
  };
}

function requestLog(app: { log: { error: (details: unknown, message: string) => void } }, error: unknown): void {
  app.log.error({ err: error }, "Health check database probe failed");
}
