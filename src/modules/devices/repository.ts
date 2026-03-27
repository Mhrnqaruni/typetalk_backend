import { Prisma, PrismaClient, type Device } from "@prisma/client";

import type { DeviceHeartbeatInput, DeviceInput } from "./schemas";

type DbClient = PrismaClient | Prisma.TransactionClient;

export class DeviceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertDeviceForUser(
    userId: string,
    input: DeviceInput | undefined,
    maxActiveDevices: number,
    transaction: DbClient
  ): Promise<Device | null> {
    if (!input) {
      return null;
    }

    await transaction.$queryRaw`SELECT id FROM "users" WHERE id = ${userId} FOR UPDATE`;

    const existing = await transaction.device.findUnique({
      where: {
        userId_installationId: {
          userId,
          installationId: input.installationId
        }
      }
    });

    if (existing) {
      return transaction.device.update({
        where: { id: existing.id },
        data: {
          platform: input.platform,
          deviceName: input.deviceName ?? null,
          osVersion: input.osVersion ?? null,
          appVersion: input.appVersion ?? null,
          locale: input.locale ?? null,
          timezone: input.timezone ?? null,
          lastSeenAt: new Date()
        }
      });
    }

    const deviceCount = await transaction.device.count({
      where: { userId }
    });

    if (deviceCount >= maxActiveDevices) {
      throw new Error("MAX_ACTIVE_DEVICES_EXCEEDED");
    }

    return transaction.device.create({
      data: {
        userId,
        platform: input.platform,
        installationId: input.installationId,
        deviceName: input.deviceName ?? null,
        osVersion: input.osVersion ?? null,
        appVersion: input.appVersion ?? null,
        locale: input.locale ?? null,
        timezone: input.timezone ?? null,
        lastSeenAt: new Date()
      }
    });
  }

  async updateOwnedDeviceHeartbeat(
    userId: string,
    deviceId: string,
    input: DeviceHeartbeatInput,
    transaction?: DbClient
  ): Promise<Device | null> {
    const client = transaction ?? this.prisma;
    const data: Prisma.DeviceUpdateManyMutationInput = {
      lastSeenAt: new Date()
    };

    if (input.deviceName !== undefined) {
      data.deviceName = input.deviceName ?? null;
    }

    if (input.osVersion !== undefined) {
      data.osVersion = input.osVersion ?? null;
    }

    if (input.appVersion !== undefined) {
      data.appVersion = input.appVersion ?? null;
    }

    if (input.locale !== undefined) {
      data.locale = input.locale ?? null;
    }

    if (input.timezone !== undefined) {
      data.timezone = input.timezone ?? null;
    }

    const updateResult = await client.device.updateMany({
      where: {
        id: deviceId,
        userId
      },
      data
    });

    if (updateResult.count !== 1) {
      return null;
    }

    return client.device.findUnique({
      where: {
        id: deviceId
      }
    });
  }

  async listDevicesForUser(
    userId: string,
    limit: number,
    cursor?: {
      lastSeenAt: Date;
      id: string;
    }
  ) {
    return this.prisma.device.findMany({
      where: {
        userId,
        ...(cursor
          ? {
              OR: [
                {
                  lastSeenAt: {
                    lt: cursor.lastSeenAt
                  }
                },
                {
                  lastSeenAt: cursor.lastSeenAt,
                  id: {
                    lt: cursor.id
                  }
                }
              ]
            }
          : {})
      },
      orderBy: [
        { lastSeenAt: "desc" },
        { id: "desc" }
      ],
      take: limit + 1
    });
  }

  async findOwnedDevice(
    userId: string,
    deviceId: string,
    transaction?: DbClient
  ): Promise<Device | null> {
    const client = transaction ?? this.prisma;

    return client.device.findFirst({
      where: {
        id: deviceId,
        userId
      }
    });
  }

  async deleteOwnedDevice(
    userId: string,
    deviceId: string,
    transaction?: DbClient
  ): Promise<boolean> {
    const client = transaction ?? this.prisma;
    const deleteResult = await client.device.deleteMany({
      where: {
        id: deviceId,
        userId
      }
    });

    return deleteResult.count === 1;
  }
}
