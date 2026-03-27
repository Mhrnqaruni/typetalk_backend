import { Prisma, PrismaClient, type Device } from "@prisma/client";

import { getConfig } from "../../config/env";
import { AppError } from "../../lib/app-error";
import {
  buildUserScopedIdempotencyScope,
  createIdempotencyRequestHash,
  executeIdempotentRequest
} from "../../lib/idempotency";
import { decodeCursor, encodeCursor, getPageLimit } from "../../lib/pagination";
import { AuthRepository } from "../auth/repository";
import { DeviceRepository } from "./repository";
import type { DeviceHeartbeatInput, DeviceInput } from "./schemas";

export class DeviceService {
  private readonly config = getConfig();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly repository: DeviceRepository,
    private readonly authRepository: AuthRepository
  ) {}

  async upsertDeviceForUser(
    userId: string,
    input: DeviceInput | undefined,
    transaction: Prisma.TransactionClient
  ): Promise<Device | null> {
    try {
      return await this.repository.upsertDeviceForUser(
        userId,
        input,
        this.config.maxActiveDevicesPerUser,
        transaction
      );
    } catch (error) {
      if (error instanceof Error && error.message === "MAX_ACTIVE_DEVICES_EXCEEDED") {
        throw new AppError(400, "device_limit_exceeded", "Maximum active devices exceeded.");
      }

      throw error;
    }
  }

  async registerDevice(
    userId: string,
    input: DeviceInput,
    idempotencyKey: string
  ): Promise<{
    statusCode: number;
    body: {
      device: ReturnType<DeviceService["serializeDevice"]>;
    };
  }> {
    const requestHash = createIdempotencyRequestHash(input, this.config.appEncryptionKey);
    const scope = buildUserScopedIdempotencyScope("devices.register", userId);

    const result = await executeIdempotentRequest({
      prisma: this.prisma,
      scope,
      idempotencyKey,
      requestHash,
      execute: async (transaction) => {
        const device = await this.upsertDeviceForUser(userId, input, transaction);

        if (!device) {
          throw new AppError(400, "invalid_device", "Device payload is required.");
        }

        return {
          statusCode: 200,
          body: {
            device: this.serializeDevice(device)
          }
        };
      }
    });

    return {
      statusCode: result.statusCode,
      body: result.body
    };
  }

  async heartbeatDevice(
    userId: string,
    deviceId: string,
    input: DeviceHeartbeatInput
  ): Promise<{
    device: ReturnType<DeviceService["serializeDevice"]>;
  }> {
    const device = await this.repository.updateOwnedDeviceHeartbeat(userId, deviceId, input);

    if (!device) {
      throw new AppError(404, "device_not_found", "Device was not found.");
    }

    return {
      device: this.serializeDevice(device)
    };
  }

  async listDevices(userId: string, limit?: number, cursor?: string) {
    const resolvedLimit = getPageLimit(limit);
    const decodedCursor = decodeCursor<{ lastSeenAt: string; id: string }>(cursor);
    const devices = await this.repository.listDevicesForUser(
      userId,
      resolvedLimit,
      decodedCursor
        ? {
            lastSeenAt: new Date(decodedCursor.lastSeenAt),
            id: decodedCursor.id
          }
        : undefined
    );

    const hasNextPage = devices.length > resolvedLimit;
    const pageItems = hasNextPage ? devices.slice(0, resolvedLimit) : devices;
    const nextItem = pageItems[pageItems.length - 1];

    return {
      items: pageItems.map((device) => this.serializeDevice(device)),
      next_cursor: hasNextPage && nextItem
        ? encodeCursor({
            lastSeenAt: nextItem.lastSeenAt.toISOString(),
            id: nextItem.id
          })
        : null
    };
  }

  async deleteDevice(userId: string, deviceId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const device = await this.repository.findOwnedDevice(userId, deviceId, transaction);

      if (!device) {
        throw new AppError(404, "device_not_found", "Device was not found.");
      }

      const revokedAt = new Date();
      await this.authRepository.revokeSessionsForDevice(userId, deviceId, revokedAt, transaction);
      await this.repository.deleteOwnedDevice(userId, deviceId, transaction);
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable
    });
  }

  serializeDevice(device: Device) {
    return {
      id: device.id,
      platform: device.platform,
      installation_id: device.installationId,
      device_name: device.deviceName,
      os_version: device.osVersion,
      app_version: device.appVersion,
      locale: device.locale,
      timezone: device.timezone,
      last_seen_at: device.lastSeenAt.toISOString(),
      created_at: device.createdAt.toISOString()
    };
  }
}
