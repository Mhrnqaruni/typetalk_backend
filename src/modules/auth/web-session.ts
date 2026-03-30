import type { FastifyReply, FastifyRequest } from "fastify";

import type { AppConfig } from "../../config/env";
import { AppError } from "../../lib/app-error";

export function setWebRefreshCookie(
  reply: FastifyReply,
  refreshToken: string,
  config: AppConfig
): void {
  reply.setCookie(config.webAuthRefreshCookieName, refreshToken, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: true
  });
}

export function clearWebRefreshCookie(reply: FastifyReply, config: AppConfig): void {
  reply.clearCookie(config.webAuthRefreshCookieName, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: true
  });
}

export function requireWebRefreshCookie(request: FastifyRequest, config: AppConfig): string {
  const refreshToken = request.cookies[config.webAuthRefreshCookieName];

  if (!refreshToken) {
    throw new AppError(401, "missing_refresh_cookie", "Refresh cookie is required.");
  }

  return refreshToken;
}

export function resolveTrustedBrowserOrigin(request: FastifyRequest): string | null {
  if (typeof request.headers.origin === "string" && request.headers.origin.trim()) {
    return request.headers.origin.trim();
  }

  if (typeof request.headers.referer !== "string" || !request.headers.referer.trim()) {
    return null;
  }

  try {
    return new URL(request.headers.referer).origin;
  } catch {
    return null;
  }
}

export function assertTrustedBrowserOrigin(
  request: FastifyRequest,
  config: AppConfig
): string {
  const origin = resolveTrustedBrowserOrigin(request);

  if (!origin) {
    throw new AppError(403, "missing_browser_origin", "Origin or Referer header is required.");
  }

  if (!config.allowedOrigins.includes(origin)) {
    throw new AppError(403, "origin_not_allowed", "Origin is not allowed.");
  }

  return origin;
}

export function toWebAuthPayload<T extends { refresh_token: string }>(
  authResult: T
): Omit<T, "refresh_token"> {
  const { refresh_token: _refreshToken, ...payload } = authResult;
  return payload;
}
