import { AppError } from "./app-error";

export function getPageLimit(limit: number | undefined, defaultLimit = 20, maxLimit = 50): number {
  if (!limit || Number.isNaN(limit)) {
    return defaultLimit;
  }

  return Math.min(Math.max(limit, 1), maxLimit);
}

export function encodeCursor(payload: Record<string, string>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor<T extends Record<string, string>>(cursor?: string): T | null {
  if (!cursor) {
    return null;
  }

  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    return JSON.parse(decoded) as T;
  } catch (error) {
    throw new AppError(400, "invalid_cursor", "Cursor is invalid.", error);
  }
}
