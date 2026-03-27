import { OAuth2Client } from "google-auth-library";

import { AppError } from "../../lib/app-error";

export interface GoogleIdentityProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

export interface GoogleVerifier {
  verifyIdToken(idToken: string): Promise<GoogleIdentityProfile>;
}

export class GoogleIdTokenVerifier implements GoogleVerifier {
  private readonly client: OAuth2Client;

  constructor(private readonly clientId: string) {
    this.client = new OAuth2Client(clientId);
  }

  async verifyIdToken(idToken: string): Promise<GoogleIdentityProfile> {
    const ticket = await this.client.verifyIdToken({
      idToken,
      audience: this.clientId
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
