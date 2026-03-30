import type { AppConfig } from "../config/env";

export interface SendOtpInput {
  email: string;
  code: string;
  purpose: string;
}

export interface EmailProvider {
  sendOtp(input: SendOtpInput): Promise<void>;
}

export class LoggingEmailProvider implements EmailProvider {
  constructor(
    private readonly logger: Pick<Console, "info"> = console
  ) {}

  async sendOtp(input: SendOtpInput): Promise<void> {
    this.logger.info(`OTP for ${input.email} (${input.purpose}): ${input.code}`);
  }
}

interface ResendEmailProviderOptions {
  apiKey: string;
  from: string;
  fetcher?: typeof fetch;
}

export class ResendEmailProvider implements EmailProvider {
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: ResendEmailProviderOptions) {
    if (typeof options.fetcher === "function") {
      this.fetcher = options.fetcher;
      return;
    }

    if (typeof globalThis.fetch !== "function") {
      throw new Error("Global fetch is unavailable for the configured email provider.");
    }

    this.fetcher = globalThis.fetch.bind(globalThis);
  }

  async sendOtp(input: SendOtpInput): Promise<void> {
    const response = await this.fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: this.options.from,
        to: [input.email],
        subject: "Your TypeTalk verification code",
        text: `Your TypeTalk verification code is ${input.code}. It expires in 10 minutes.`
      })
    });

    if (!response.ok) {
      throw new Error(`Resend email delivery failed with status ${response.status}.`);
    }
  }
}

export function createEmailProvider(config: AppConfig): EmailProvider {
  if (config.nodeEnv === "test") {
    return new LoggingEmailProvider();
  }

  if (config.emailProviderMode === "log") {
    if (config.appEnv === "production") {
      throw new Error("A real email provider must be configured for production runtimes.");
    }

    return new LoggingEmailProvider();
  }

  return new ResendEmailProvider({
    apiKey: config.emailProviderApiKey,
    from: config.emailFrom
  });
}
