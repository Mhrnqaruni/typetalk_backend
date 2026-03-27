import { buildApp } from "./app";
import { getConfig } from "./config/env";
import { getPrismaClient } from "./lib/prisma";

async function startServer(): Promise<void> {
  const config = getConfig();
  const prisma = getPrismaClient();
  const app = await buildApp({ prisma });

  try {
    await app.listen({
      host: config.host,
      port: config.port
    });
  } catch (error) {
    app.log.error({ err: error }, "Failed to start server");
    await prisma.$disconnect();
    process.exit(1);
  }

  const close = async (): Promise<void> => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}

void startServer();
