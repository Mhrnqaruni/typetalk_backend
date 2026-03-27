import { z } from "zod";

export const devicePayloadSchema = z.object({
  platform: z.enum(["ANDROID", "WINDOWS"]),
  installation_id: z.string().min(1),
  device_name: z.string().min(1).max(200).nullable().optional(),
  os_version: z.string().min(1).max(100).nullable().optional(),
  app_version: z.string().min(1).max(100).nullable().optional(),
  locale: z.string().min(1).max(50).nullable().optional(),
  timezone: z.string().min(1).max(100).nullable().optional()
}).strict();

export const deviceHeartbeatSchema = z.object({
  device_name: z.string().min(1).max(200).nullable().optional(),
  os_version: z.string().min(1).max(100).nullable().optional(),
  app_version: z.string().min(1).max(100).nullable().optional(),
  locale: z.string().min(1).max(50).nullable().optional(),
  timezone: z.string().min(1).max(100).nullable().optional()
}).strict();

export const deviceListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().optional(),
  cursor: z.string().min(1).optional()
}).strict();

export interface DeviceInput {
  platform: "ANDROID" | "WINDOWS";
  installationId: string;
  deviceName?: string | null;
  osVersion?: string | null;
  appVersion?: string | null;
  locale?: string | null;
  timezone?: string | null;
}

export function mapDevicePayload(device?: z.infer<typeof devicePayloadSchema>): DeviceInput | undefined {
  if (!device) {
    return undefined;
  }

  return {
    platform: device.platform,
    installationId: device.installation_id,
    deviceName: device.device_name ?? null,
    osVersion: device.os_version ?? null,
    appVersion: device.app_version ?? null,
    locale: device.locale ?? null,
    timezone: device.timezone ?? null
  };
}

export interface DeviceHeartbeatInput {
  deviceName?: string | null;
  osVersion?: string | null;
  appVersion?: string | null;
  locale?: string | null;
  timezone?: string | null;
}

export function mapDeviceHeartbeatPayload(
  payload: z.infer<typeof deviceHeartbeatSchema>
): DeviceHeartbeatInput {
  return {
    deviceName: payload.device_name,
    osVersion: payload.os_version,
    appVersion: payload.app_version,
    locale: payload.locale,
    timezone: payload.timezone
  };
}
