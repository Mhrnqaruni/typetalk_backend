import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getConfig } from "../../src/config/env";
import { buildUserScopedIdempotencyScope } from "../../src/lib/idempotency";
import { createTestHarness } from "../helpers/app";
import { resetDatabase } from "../helpers/db";

describe("device routes", () => {
  let harness: Awaited<ReturnType<typeof createTestHarness>>;
  const config = getConfig();

  beforeAll(async () => {
    harness = await createTestHarness();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
    harness.emailProvider.sentOtps.length = 0;
    await harness.authRateLimiter.reset();
  });

  afterAll(async () => {
    await harness.app.close();
    await harness.prisma.$disconnect();
  });

  async function signIn(
    email: string,
    device?: {
      platform: "ANDROID" | "WINDOWS";
      installation_id: string;
      device_name?: string;
    }
  ) {
    await harness.app.inject({
      method: "POST",
      url: "/v1/auth/email/request-code",
      payload: {
        email
      }
    });

    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/email/verify-code",
      payload: {
        email,
        code: harness.emailProvider.latestCodeFor(email),
        ...(device ? { device } : {})
      }
    });

    expect(response.statusCode).toBe(200);
    return response.json();
  }

  it("registers devices idempotently and rejects missing keys or payload conflicts", async () => {
    const session = await signIn("devices@example.com");

    const missingKeyResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/devices/register",
      headers: {
        authorization: `Bearer ${session.access_token}`
      },
      payload: {
        platform: "WINDOWS",
        installation_id: "windows-primary"
      }
    });

    expect(missingKeyResponse.statusCode).toBe(400);
    expect(missingKeyResponse.json().error.code).toBe("missing_idempotency_key");

    const firstResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/devices/register",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": "register-key-1"
      },
      payload: {
        platform: "WINDOWS",
        installation_id: "windows-primary",
        device_name: "Primary Laptop"
      }
    });

    expect(firstResponse.statusCode).toBe(200);
    expect(firstResponse.json().device.installation_id).toBe("windows-primary");

    const replayResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/devices/register",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": "register-key-1"
      },
      payload: {
        platform: "WINDOWS",
        installation_id: "windows-primary",
        device_name: "Primary Laptop"
      }
    });

    expect(replayResponse.statusCode).toBe(200);
    expect(replayResponse.json()).toEqual(firstResponse.json());

    const deviceCount = await harness.prisma.device.count({
      where: {
        userId: session.user.id
      }
    });

    expect(deviceCount).toBe(1);

    const conflictResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/devices/register",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": "register-key-1"
      },
      payload: {
        platform: "WINDOWS",
        installation_id: "windows-primary",
        device_name: "Renamed Laptop"
      }
    });

    expect(conflictResponse.statusCode).toBe(409);
    expect(conflictResponse.json().error.code).toBe("idempotency_key_conflict");
  });

  it("replays concurrent same-user duplicates and isolates idempotency scope across users", async () => {
    const firstUser = await signIn("first-device-user@example.com");
    const secondUser = await signIn("second-device-user@example.com");
    const payload = {
      platform: "WINDOWS" as const,
      installation_id: "shared-key-device",
      device_name: "Shared Key Device"
    };

    const responses = await Promise.all([
      harness.app.inject({
        method: "POST",
        url: "/v1/devices/register",
        headers: {
          authorization: `Bearer ${firstUser.access_token}`,
          "idempotency-key": "shared-register-key"
        },
        payload
      }),
      harness.app.inject({
        method: "POST",
        url: "/v1/devices/register",
        headers: {
          authorization: `Bearer ${firstUser.access_token}`,
          "idempotency-key": "shared-register-key"
        },
        payload
      })
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(responses[0].json()).toEqual(responses[1].json());

    const firstUserDeviceCount = await harness.prisma.device.count({
      where: {
        userId: firstUser.user.id
      }
    });

    expect(firstUserDeviceCount).toBe(1);

    const secondUserResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/devices/register",
      headers: {
        authorization: `Bearer ${secondUser.access_token}`,
        "idempotency-key": "shared-register-key"
      },
      payload
    });

    expect(secondUserResponse.statusCode).toBe(200);

    const secondUserDeviceCount = await harness.prisma.device.count({
      where: {
        userId: secondUser.user.id
      }
    });
    const idempotencyKeyCount = await harness.prisma.idempotencyKey.count({
      where: {
        idempotencyKey: "shared-register-key"
      }
    });

    expect(secondUserDeviceCount).toBe(1);
    expect(idempotencyKeyCount).toBe(2);
  });

  it("re-executes registration after an expired idempotency key is backdated", async () => {
    const session = await signIn("devices-expiry@example.com");
    const idempotencyKey = "expired-register-key";
    const payload = {
      platform: "WINDOWS" as const,
      installation_id: "expired-device",
      device_name: "Expiry Device"
    };

    const firstResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/devices/register",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": idempotencyKey
      },
      payload
    });

    expect(firstResponse.statusCode).toBe(200);

    const firstDevice = await harness.prisma.device.findUniqueOrThrow({
      where: {
        userId_installationId: {
          userId: session.user.id,
          installationId: payload.installation_id
        }
      }
    });

    await harness.prisma.idempotencyKey.update({
      where: {
        scope_idempotencyKey: {
          scope: buildUserScopedIdempotencyScope("devices.register", session.user.id),
          idempotencyKey
        }
      },
      data: {
        expiresAt: new Date(Date.now() - 60_000)
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 1_200));

    const secondResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/devices/register",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": idempotencyKey
      },
      payload
    });

    expect(secondResponse.statusCode).toBe(200);
    expect(secondResponse.json().device.id).toBe(firstResponse.json().device.id);
    expect(secondResponse.json().device.last_seen_at).not.toBe(firstResponse.json().device.last_seen_at);

    const secondDevice = await harness.prisma.device.findUniqueOrThrow({
      where: {
        userId_installationId: {
          userId: session.user.id,
          installationId: payload.installation_id
        }
      }
    });
    const refreshedIdempotencyKey = await harness.prisma.idempotencyKey.findUniqueOrThrow({
      where: {
        scope_idempotencyKey: {
          scope: buildUserScopedIdempotencyScope("devices.register", session.user.id),
          idempotencyKey
        }
      }
    });

    expect(secondDevice.id).toBe(firstDevice.id);
    expect(secondDevice.lastSeenAt.getTime()).toBeGreaterThan(firstDevice.lastSeenAt.getTime());
    expect(refreshedIdempotencyKey.responseBodyJson).toMatchObject({
      device: {
        id: firstDevice.id,
        last_seen_at: secondResponse.json().device.last_seen_at
      }
    });
  });

  it("updates owned device heartbeat metadata and rejects foreign device ids", async () => {
    const owner = await signIn("heartbeat-owner@example.com");
    const otherUser = await signIn("heartbeat-other@example.com");

    const registerResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/devices/register",
      headers: {
        authorization: `Bearer ${owner.access_token}`,
        "idempotency-key": "heartbeat-register-key"
      },
      payload: {
        platform: "WINDOWS",
        installation_id: "heartbeat-device",
        device_name: "Before Heartbeat"
      }
    });

    const deviceId = registerResponse.json().device.id;
    const beforeHeartbeat = await harness.prisma.device.findUniqueOrThrow({
      where: {
        id: deviceId
      }
    });

    const heartbeatResponse = await harness.app.inject({
      method: "PATCH",
      url: `/v1/devices/${deviceId}/heartbeat`,
      headers: {
        authorization: `Bearer ${owner.access_token}`
      },
      payload: {
        device_name: "After Heartbeat",
        os_version: "Windows 11",
        app_version: "1.2.3",
        locale: "en-SG",
        timezone: "Asia/Singapore"
      }
    });

    expect(heartbeatResponse.statusCode).toBe(200);
    expect(heartbeatResponse.json().device.device_name).toBe("After Heartbeat");

    const afterHeartbeat = await harness.prisma.device.findUniqueOrThrow({
      where: {
        id: deviceId
      }
    });

    expect(afterHeartbeat.deviceName).toBe("After Heartbeat");
    expect(afterHeartbeat.osVersion).toBe("Windows 11");
    expect(afterHeartbeat.lastSeenAt.getTime()).toBeGreaterThanOrEqual(beforeHeartbeat.lastSeenAt.getTime());

    const foreignHeartbeat = await harness.app.inject({
      method: "PATCH",
      url: `/v1/devices/${deviceId}/heartbeat`,
      headers: {
        authorization: `Bearer ${otherUser.access_token}`
      },
      payload: {
        device_name: "Foreign Update"
      }
    });

    expect(foreignHeartbeat.statusCode).toBe(404);
    expect(foreignHeartbeat.json().error.code).toBe("device_not_found");
  });

  it("lists only owned devices with cursor pagination", async () => {
    const owner = await signIn("devices-list-owner@example.com");
    const otherUser = await signIn("devices-list-other@example.com");

    await harness.app.inject({
      method: "POST",
      url: "/v1/devices/register",
      headers: {
        authorization: `Bearer ${owner.access_token}`,
        "idempotency-key": "list-owner-1"
      },
      payload: {
        platform: "WINDOWS",
        installation_id: "owner-device-1",
        device_name: "Owner Device 1"
      }
    });

    await harness.app.inject({
      method: "POST",
      url: "/v1/devices/register",
      headers: {
        authorization: `Bearer ${owner.access_token}`,
        "idempotency-key": "list-owner-2"
      },
      payload: {
        platform: "WINDOWS",
        installation_id: "owner-device-2",
        device_name: "Owner Device 2"
      }
    });

    await harness.app.inject({
      method: "POST",
      url: "/v1/devices/register",
      headers: {
        authorization: `Bearer ${otherUser.access_token}`,
        "idempotency-key": "list-other-1"
      },
      payload: {
        platform: "WINDOWS",
        installation_id: "other-device-1",
        device_name: "Other Device 1"
      }
    });

    const firstPage = await harness.app.inject({
      method: "GET",
      url: "/v1/devices?limit=1",
      headers: {
        authorization: `Bearer ${owner.access_token}`
      }
    });

    expect(firstPage.statusCode).toBe(200);
    expect(firstPage.json().items).toHaveLength(1);
    expect(firstPage.json().next_cursor).toBeTruthy();
    expect(firstPage.json().items[0].device_name).toMatch(/Owner Device/);

    const secondPage = await harness.app.inject({
      method: "GET",
      url: `/v1/devices?limit=1&cursor=${encodeURIComponent(firstPage.json().next_cursor)}`,
      headers: {
        authorization: `Bearer ${owner.access_token}`
      }
    });

    expect(secondPage.statusCode).toBe(200);
    expect(secondPage.json().items).toHaveLength(1);
    expect(secondPage.json().items[0].device_name).toMatch(/Owner Device/);
    expect(secondPage.json().items[0].device_name).not.toBe(firstPage.json().items[0].device_name);

    const ownerItems = [firstPage.json().items[0], secondPage.json().items[0]];
    expect(ownerItems.every((item: { installation_id: string }) => item.installation_id.startsWith("owner-device-"))).toBe(true);
  });

  it("deletes owned devices, revokes linked sessions, and frees a registration slot", async () => {
    const ownerPrimary = await signIn("devices-delete-owner@example.com", {
      platform: "WINDOWS",
      installation_id: "owned-session-device",
      device_name: "Owned Session Device"
    });
    const ownerSecondary = await signIn("devices-delete-owner@example.com", {
      platform: "WINDOWS",
      installation_id: "surviving-session-device",
      device_name: "Surviving Session Device"
    });
    const otherUser = await signIn("devices-delete-other@example.com");
    const ownedDevice = await harness.prisma.device.findUniqueOrThrow({
      where: {
        userId_installationId: {
          userId: ownerPrimary.user.id,
          installationId: "owned-session-device"
        }
      }
    });

    await harness.prisma.device.createMany({
      data: Array.from({ length: config.maxActiveDevicesPerUser - 2 }, (_, index) => ({
        userId: ownerPrimary.user.id,
        platform: "WINDOWS",
        installationId: `seeded-device-${index + 1}`,
        deviceName: `Seeded Device ${index + 1}`,
        lastSeenAt: new Date(),
        createdAt: new Date()
      }))
    });

    const foreignDeleteResponse = await harness.app.inject({
      method: "DELETE",
      url: `/v1/devices/${ownedDevice.id}`,
      headers: {
        authorization: `Bearer ${otherUser.access_token}`
      }
    });

    expect(foreignDeleteResponse.statusCode).toBe(404);
    expect(foreignDeleteResponse.json().error.code).toBe("device_not_found");

    const overCapResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/devices/register",
      headers: {
        authorization: `Bearer ${ownerSecondary.access_token}`,
        "idempotency-key": "devices-delete-over-cap"
      },
      payload: {
        platform: "WINDOWS",
        installation_id: "overflow-device"
      }
    });

    expect(overCapResponse.statusCode).toBe(400);
    expect(overCapResponse.json().error.code).toBe("device_limit_exceeded");

    const deleteResponse = await harness.app.inject({
      method: "DELETE",
      url: `/v1/devices/${ownedDevice.id}`,
      headers: {
        authorization: `Bearer ${ownerSecondary.access_token}`
      }
    });

    expect(deleteResponse.statusCode).toBe(204);

    const deletedDevice = await harness.prisma.device.findUnique({
      where: {
        id: ownedDevice.id
      }
    });
    const revokedSession = await harness.prisma.session.findUniqueOrThrow({
      where: {
        id: ownerPrimary.session.id
      }
    });

    expect(deletedDevice).toBeNull();
    expect(revokedSession.revokedAt).not.toBeNull();

    const meAfterDelete = await harness.app.inject({
      method: "GET",
      url: "/v1/me",
      headers: {
        authorization: `Bearer ${ownerPrimary.access_token}`
      }
    });

    expect(meAfterDelete.statusCode).toBe(401);
    expect(meAfterDelete.json().error.code).toBe("invalid_access_token");

    const refreshAfterDelete = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: {
        refresh_token: ownerPrimary.refresh_token
      }
    });

    expect(refreshAfterDelete.statusCode).toBe(401);
    expect(refreshAfterDelete.json().error.code).toBe("invalid_refresh_token");

    const listResponse = await harness.app.inject({
      method: "GET",
      url: "/v1/devices?limit=20",
      headers: {
        authorization: `Bearer ${ownerSecondary.access_token}`
      }
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().items.find((item: { id: string }) => item.id === ownedDevice.id)).toBeUndefined();

    const replacementResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/devices/register",
      headers: {
        authorization: `Bearer ${ownerSecondary.access_token}`,
        "idempotency-key": "devices-delete-replacement"
      },
      payload: {
        platform: "WINDOWS",
        installation_id: "replacement-device"
      }
    });

    expect(replacementResponse.statusCode).toBe(200);

    const remainingOwnerDeviceCount = await harness.prisma.device.count({
      where: {
        userId: ownerPrimary.user.id
      }
    });

    expect(remainingOwnerDeviceCount).toBe(config.maxActiveDevicesPerUser);
  });
});
