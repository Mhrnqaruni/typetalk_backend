import type { FastifyRequest } from "fastify";

import type { AppConfig } from "../config/env";

export interface ErrorTrackerContext {
  requestId: string;
  method: string;
  url: string;
  userId?: string | null;
}

export interface ErrorTracker {
  captureException(error: unknown, context: ErrorTrackerContext, request: FastifyRequest): Promise<void>;
}

class NoopErrorTracker implements ErrorTracker {
  async captureException(): Promise<void> {}
}

class LogErrorTracker implements ErrorTracker {
  constructor(private readonly dsn: string | null) {}

  async captureException(
    error: unknown,
    context: ErrorTrackerContext,
    request: FastifyRequest
  ): Promise<void> {
    request.log.error(
      {
        err: error,
        error_tracking: {
          enabled: true,
          dsn_configured: Boolean(this.dsn),
          context
        }
      },
      "Captured unexpected error for optional error tracking"
    );
  }
}

export function createErrorTracker(config: AppConfig): ErrorTracker {
  if (!config.errorTrackingEnabled) {
    return new NoopErrorTracker();
  }

  return new LogErrorTracker(config.errorTrackingDsn);
}
