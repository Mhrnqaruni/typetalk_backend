import type { FastifyRequest } from "fastify";

export interface RequestMetadata {
  userAgent: string | null;
  ipAddress: string | null;
  ipCountryCode: string | null;
}

export function getIpCountryCode(request: FastifyRequest): string | null {
  const headerValue = request.headers["x-country-code"] ?? request.headers["cf-ipcountry"];

  return typeof headerValue === "string" ? headerValue : null;
}

export function getRequestMetadata(request: FastifyRequest): RequestMetadata {
  return {
    userAgent: typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : null,
    ipAddress: request.ip ?? null,
    ipCountryCode: getIpCountryCode(request)
  };
}
