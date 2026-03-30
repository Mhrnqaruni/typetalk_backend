import { Writable } from "node:stream";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestHarness } from "../helpers/app";
import { resetDatabase } from "../helpers/db";

describe("error handling", () => {
  let harness: Awaited<ReturnType<typeof createTestHarness>>;
  const capturedLogs: string[] = [];
  const errorTracker = {
    captureException: vi.fn().mockResolvedValue(undefined)
  };
  const loggerStream = new Writable({
    write(chunk, _encoding, callback) {
      capturedLogs.push(chunk.toString());
      callback();
    }
  });

  beforeAll(async () => {
    harness = await createTestHarness({
      errorTracker,
      loggerStream
    });
    harness.app.get("/__test__/boom", async () => {
      throw new Error("sensitive prisma path C:\\secret\\internal.ts");
    });
    harness.app.post("/__test__/log-redaction", async (request, reply) => {
      request.log.info({
        headers: {
          authorization: "Bearer super-secret"
        },
        body: {
          refresh_token: "refresh-secret",
          raw_ip_ciphertext: "ciphertext-secret",
          code: "123456"
        }
      }, "redaction-check");

      return reply.status(204).send();
    });
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
    capturedLogs.length = 0;
    errorTracker.captureException.mockClear();
  });

  afterAll(async () => {
    await harness.app.close();
    await harness.prisma.$disconnect();
  });

  it("does not leak internal error details in 5xx responses and calls the error tracker hook", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/__test__/boom"
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe("internal_error");
    expect(response.json().error.message).toBe("Internal server error.");
    expect(response.body).not.toContain("C:\\secret\\internal.ts");
    expect(errorTracker.captureException).toHaveBeenCalledTimes(1);
    expect(errorTracker.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        method: "GET",
        url: "/__test__/boom"
      }),
      expect.any(Object)
    );
  });

  it("redacts sensitive request fields from structured logs", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/__test__/log-redaction"
    });

    expect(response.statusCode).toBe(204);

    const joinedLogs = capturedLogs.join("\n");

    expect(joinedLogs).toContain("[REDACTED]");
    expect(joinedLogs).not.toContain("Bearer super-secret");
    expect(joinedLogs).not.toContain("refresh-secret");
    expect(joinedLogs).not.toContain("ciphertext-secret");
    expect(joinedLogs).not.toContain("\"code\":\"123456\"");
  });
});
