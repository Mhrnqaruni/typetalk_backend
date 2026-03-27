import { z } from "zod";

export const MAX_SYNC_JSON_BYTES = 8 * 1024;
export const MAX_SYNC_JSON_DEPTH = 4;
export const MAX_SYNC_JSON_KEYS = 50;
export const MAX_SYNC_JSON_KEY_LENGTH = 64;

const FORBIDDEN_KEY_PREFIXES = ["$", "__"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isJsonPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function validateJsonNode(
  value: unknown,
  depth: number,
  state: { keyCount: number },
  fieldName: string,
  ctx: z.RefinementCtx
): void {
  if (depth > MAX_SYNC_JSON_DEPTH) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${fieldName} must not exceed ${MAX_SYNC_JSON_DEPTH} levels of nesting.`
    });
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      validateJsonNode(entry, depth + 1, state, fieldName, ctx);
    }
    return;
  }

  if (isPlainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      state.keyCount += 1;

      if (state.keyCount > MAX_SYNC_JSON_KEYS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${fieldName} must not contain more than ${MAX_SYNC_JSON_KEYS} total keys.`
        });
        return;
      }

      if (key.length > MAX_SYNC_JSON_KEY_LENGTH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${fieldName} keys must be at most ${MAX_SYNC_JSON_KEY_LENGTH} characters long.`
        });
        return;
      }

      if (FORBIDDEN_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${fieldName} keys must not start with $ or __.`
        });
        return;
      }

      validateJsonNode(entry, depth + 1, state, fieldName, ctx);
    }
    return;
  }

  if (!isJsonPrimitive(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${fieldName} must contain only JSON-compatible values.`
    });
  }
}

export function createBoundedJsonObjectSchema(fieldName: string) {
  return z.custom<Record<string, unknown>>((value) => isPlainObject(value), {
    message: `${fieldName} must be a JSON object.`
  }).superRefine((value, ctx) => {
    const serialized = JSON.stringify(value);
    const serializedBytes = Buffer.byteLength(serialized, "utf8");

    if (serializedBytes > MAX_SYNC_JSON_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${fieldName} must be at most ${MAX_SYNC_JSON_BYTES} bytes when serialized.`
      });
      return;
    }

    validateJsonNode(value, 1, { keyCount: 0 }, fieldName, ctx);
  });
}
