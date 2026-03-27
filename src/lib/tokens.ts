import jwt, { type JwtPayload } from "jsonwebtoken";

import { AppError } from "./app-error";

export interface AccessTokenPayload extends JwtPayload {
  sub: string;
  sid: string;
  type: "access";
}

interface AccessTokenOptions {
  secret: string;
  algorithm: "HS256";
  expiresInMinutes: number;
}

export function issueAccessToken(
  payload: AccessTokenPayload,
  options: AccessTokenOptions
): string {
  return jwt.sign(payload, options.secret, {
    algorithm: options.algorithm,
    expiresIn: `${options.expiresInMinutes}m`
  });
}

export function verifyAccessToken(
  token: string,
  options: Pick<AccessTokenOptions, "secret" | "algorithm">
): AccessTokenPayload {
  const decoded = jwt.verify(token, options.secret, {
    algorithms: [options.algorithm]
  });

  if (!decoded || typeof decoded === "string") {
    throw new AppError(401, "invalid_access_token", "Access token is invalid.");
  }

  if (decoded.type !== "access" || typeof decoded.sub !== "string" || typeof decoded.sid !== "string") {
    throw new AppError(401, "invalid_access_token", "Access token payload is invalid.");
  }

  return decoded as AccessTokenPayload;
}

export function buildRefreshToken(sessionId: string, secret: string): string {
  return `${sessionId}.${secret}`;
}

export function parseRefreshToken(token: string): { sessionId: string; secret: string } | null {
  const separatorIndex = token.indexOf(".");

  if (separatorIndex <= 0 || separatorIndex === token.length - 1) {
    return null;
  }

  return {
    sessionId: token.slice(0, separatorIndex),
    secret: token.slice(separatorIndex + 1)
  };
}
