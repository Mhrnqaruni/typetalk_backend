import { z } from "zod";

import { createBoundedJsonObjectSchema } from "../../lib/json-bounds";

const featureCodeSchema = z.string().trim().min(1).max(50);
const providerSchema = z.string().trim().min(1).max(50);
const providerSessionRefSchema = z.string().trim().min(1).max(200);

export const realtimeSessionCreateSchema = z.object({
  device_id: z.string().min(1),
  feature_code: featureCodeSchema,
  provider: providerSchema,
  provider_session_ref: providerSessionRefSchema.nullable().optional()
}).strict();

export const usageFinalizeSchema = z.object({
  realtime_session_id: z.string().min(1),
  client_request_id: z.string().trim().min(1).max(100).nullable().optional()
}).strict();

export const usageEventCreateSchema = z.object({
  realtime_session_id: z.string().min(1).optional(),
  device_id: z.string().min(1).optional(),
  feature_code: featureCodeSchema.optional(),
  provider: providerSchema,
  word_count: z.coerce.number().int().nonnegative().default(0),
  audio_seconds: z.coerce.number().int().nonnegative().default(0),
  request_count: z.coerce.number().int().nonnegative().default(0),
  metadata_json: createBoundedJsonObjectSchema("metadata_json").optional()
}).strict().superRefine((value, ctx) => {
  if (!value.realtime_session_id && (!value.device_id || !value.feature_code)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Telemetry usage events require realtime_session_id or device_id plus feature_code."
    });
  }
});

export const usageQuotaQuerySchema = z.object({
  feature_code: featureCodeSchema.optional()
}).strict();

export interface RealtimeSessionCreateInput {
  deviceId: string;
  featureCode: string;
  provider: string;
  providerSessionRef?: string | null;
}

export function mapRealtimeSessionCreatePayload(
  payload: z.infer<typeof realtimeSessionCreateSchema>
): RealtimeSessionCreateInput {
  return {
    deviceId: payload.device_id,
    featureCode: payload.feature_code,
    provider: payload.provider,
    providerSessionRef: payload.provider_session_ref ?? null
  };
}

export interface UsageFinalizeInput {
  realtimeSessionId: string;
  clientRequestId?: string | null;
}

export function mapUsageFinalizePayload(
  payload: z.infer<typeof usageFinalizeSchema>
): UsageFinalizeInput {
  return {
    realtimeSessionId: payload.realtime_session_id,
    clientRequestId: payload.client_request_id ?? null
  };
}

export interface UsageTelemetryInput {
  realtimeSessionId?: string | null;
  deviceId?: string | null;
  featureCode?: string | null;
  provider: string;
  wordCount: number;
  audioSeconds: number;
  requestCount: number;
  metadataJson?: Record<string, unknown>;
}

export function mapUsageEventPayload(
  payload: z.infer<typeof usageEventCreateSchema>
): UsageTelemetryInput {
  return {
    realtimeSessionId: payload.realtime_session_id ?? null,
    deviceId: payload.device_id ?? null,
    featureCode: payload.feature_code ?? null,
    provider: payload.provider,
    wordCount: payload.word_count,
    audioSeconds: payload.audio_seconds,
    requestCount: payload.request_count,
    metadataJson: payload.metadata_json
  };
}
