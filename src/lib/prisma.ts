import { PrismaClient } from "@prisma/client";

import { getConfig } from "../config/env";

declare global {
  // eslint-disable-next-line no-var
  var __typetalkPrisma__: PrismaClient | undefined;
}

export function createPrismaClient(databaseUrl?: string): PrismaClient {
  const resolvedDatabaseUrl = databaseUrl ?? getConfig().databaseUrl;

  return new PrismaClient({
    datasources: {
      db: {
        url: resolvedDatabaseUrl
      }
    }
  });
}

export function getPrismaClient(): PrismaClient {
  if (!global.__typetalkPrisma__) {
    global.__typetalkPrisma__ = createPrismaClient();
  }

  return global.__typetalkPrisma__;
}
