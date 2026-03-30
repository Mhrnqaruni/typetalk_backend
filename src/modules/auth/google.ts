import { OAuth2Client } from "google-auth-library";

import { AppError } from "../../lib/app-error";

export type GoogleTokenAudience = "native" | "web";

export interface GoogleIdentityProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

export interface GoogleVerifier {
  verifyIdToken(idToken: string, audience?: GoogleTokenAudience): Promise<GoogleIdentityProfile>;
}

export class GoogleIdTokenVerifier implements GoogleVerifier {
  private readonly clients: Record<GoogleTokenAudience, OAuth2Client>;

  constructor(
    private readonly clientIds: Record<GoogleTokenAudience, string>
  ) {
    this.clients = {
      native: new OAuth2Client(clientIds.native),
      web: new OAuth2Client(clientIds.web)
    };
  }

  async verifyIdToken(
    idToken: string,
    audience: GoogleTokenAudience = "native"
  ): Promise<GoogleIdentityProfile> {
    const clientId = this.clientIds[audience];
    const ticket = await this.clients[audience].verifyIdToken({
      idToken,
      audience: clientId
    });
    const payload = ticket.getPayload();

    if (!payload?.sub || !payload.email) {
      throw new AppError(401, "invalid_google_token", "Google token payload is incomplete.");
    }

    return {
      sub: payload.sub,
      email: payload.email,
      emailVerified: Boolean(payload.email_verified),
      name: payload.name ?? null,
      picture: payload.picture ?? null
    };
  }
}
