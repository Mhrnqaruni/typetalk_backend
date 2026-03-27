import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app";
import { getConfig } from "../src/config/env";
import { createPrismaClient } from "../src/lib/prisma";

describe("GET /health", () => {
  const prisma = createPrismaClient(getConfig().databaseUrl);
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp({ prisma });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("returns an ok response when the database is reachable", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      database: "ok"
    });
  });
});
