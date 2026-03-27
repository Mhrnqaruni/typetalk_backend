import { Prisma, PrismaClient } from "@prisma/client";

import { AppError } from "./app-error";
import { hashIdempotencyPayload } from "./crypto";

const DEFAULT_IDEMPOTENCY_TTL_HOURS = 24;
const MAX_IDEMPOTENCY_ATTEMPTS = 3;

type JsonResponse = Prisma.JsonObject | Prisma.JsonArray | string | number | boolean | null;

class RetryIdempotencyExecutionError extends Error {}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = sortJsonValue((value as Record<string, unknown>)[key]);
        return accumulator;
      }, {});
  }

  return value;
}

export function buildUserScopedIdempotencyScope(
  routeName: string,
  userId: string,
  organizationId?: string | null
): string {
  return organizationId
    ? `${routeName}:user:${userId}:org:${organizationId}`
    : `${routeName}:user:${userId}`;
}

export function createIdempotencyRequestHash(payload: unknown, secret: string): string {
  return hashIdempotencyPayload(JSON.stringify(sortJsonValue(payload)), secret);
}

export interface IdempotentExecutionResult<T extends JsonResponse> {
  statusCode: number;
  body: T;
  replayed: boolean;
}

export async function executeIdempotentRequest<T extends JsonResponse>(options: {
  prisma: PrismaClient;
  scope: string;
  idempotencyKey: string;
  requestHash: string;
  expiresAt?: Date;
  execute: (transaction: Prisma.TransactionClient) => Promise<{
    statusCode: number;
    body: T;
  }>;
}): Promise<IdempotentExecutionResult<T>> {
  const expiresAt = options.expiresAt ?? new Date(Date.now() + DEFAULT_IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000);
  let lastError: unknown = null;

  for (let attempt = 0; attempt < MAX_IDEMPOTENCY_ATTEMPTS; attempt += 1) {
    const now = new Date();

    try {
      return await options.prisma.$transaction(async (transaction) => {
        const existing = await transaction.idempotencyKey.findUnique({
          where: {
            scope_idempotencyKey: {
              scope: options.scope,
              idempotencyKey: options.idempotencyKey
            }
          }
        });

        if (existing) {
          if (existing.expiresAt <= now) {
            const deleteResult = await transaction.idempotencyKey.deleteMany({
              where: {
                scope: options.scope,
                idempotencyKey: options.idempotencyKey,
                expiresAt: {
                  lte: now
                }
              }
            });

            if (deleteResult.count !== 1) {
              throw new RetryIdempotencyExecutionError();
            }
          } else {
            if (existing.requestHash !== options.requestHash) {
              throw new AppError(
                409,
                "idempotency_key_conflict",
                "Idempotency key was already used with a different request."
              );
            }

            if (existing.responseStatus === null || existing.responseBodyJson === null) {
              throw new AppError(
                409,
                "idempotency_in_progress",
                "Idempotent request is still being processed."
              );
            }

            return {
              statusCode: existing.responseStatus,
              body: existing.responseBodyJson as T,
              replayed: true
            };
          }
        }

        await transaction.idempotencyKey.create({
          data: {
            scope: options.scope,
            idempotencyKey: options.idempotencyKey,
            requestHash: options.requestHash,
            expiresAt
          }
        });

        const result = await options.execute(transaction);

        await transaction.idempotencyKey.update({
          where: {
            scope_idempotencyKey: {
              scope: options.scope,
              idempotencyKey: options.idempotencyKey
            }
          },
          data: {
            responseStatus: result.statusCode,
            responseBodyJson: result.body as Prisma.InputJsonValue
          }
        });

        return {
          statusCode: result.statusCode,
          body: result.body,
          replayed: false
        };
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      });
    } catch (error) {
      lastError = error;

      if (error instanceof AppError) {
        throw error;
      }

      if (error instanceof RetryIdempotencyExecutionError) {
        continue;
      }

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2002" || error.code === "P2034")
      ) {
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}
