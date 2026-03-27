import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestHarness } from "../helpers/app";
import { resetDatabase } from "../helpers/db";

describe("error handling", () => {
  let harness: Awaited<ReturnType<typeof createTestHarness>>;

  beforeAll(async () => {
    harness = await createTestHarness();
    harness.app.get("/__test__/boom", async () => {
      throw new Error("sensitive prisma path C:\\secret\\internal.ts");
    });
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
  });

  afterAll(async () => {
    await harness.app.close();
    await harness.prisma.$disconnect();
  });

  it("does not leak internal error details in 5xx responses", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/__test__/boom"
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe("internal_error");
    expect(response.json().error.message).toBe("Internal server error.");
    expect(response.body).not.toContain("C:\\secret\\internal.ts");
  });
});
