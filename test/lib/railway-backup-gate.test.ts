import { describe, expect, it } from "vitest";

import {
  evaluateRailwayBackupGate,
  findLinkedRailwayProject,
  resolveConfiguredVolumeInstanceId,
  type RailwayBackupProbeData,
  type RailwayConfigFile,
  type RailwayRunbookMetadata,
} from "../../src/lib/railway-backup-gate";

describe("findLinkedRailwayProject", () => {
  it("prefers the longest matching linked project path", () => {
    const config: RailwayConfigFile = {
      projects: {
        "C:\\Users\\User": {
          project: "root-project",
          projectPath: "C:\\Users\\User",
        },
        "C:\\Users\\User\\Desktop\\voice to clip\\TypeTalk\\backend": {
          project: "backend-project",
          projectPath: "C:\\Users\\User\\Desktop\\voice to clip\\TypeTalk\\backend",
        },
      },
    };

    expect(
      findLinkedRailwayProject(
        config,
        "C:\\Users\\User\\Desktop\\voice to clip\\TypeTalk\\backend\\phase_8",
      ),
    ).toEqual({
      project: "backend-project",
      projectPath: "C:\\Users\\User\\Desktop\\voice to clip\\TypeTalk\\backend",
    });
  });
});

describe("evaluateRailwayBackupGate", () => {
  it("passes when backup allowance, schedule, and backup evidence are all present", () => {
    const probe: RailwayBackupProbeData = {
      project: {
        name: "TypeTalk",
        subscriptionPlanLimit: {
          volumes: {
            maxBackupsCount: 7,
            maxBackupsUsagePercent: 50,
          },
        },
        subscriptionType: "pro",
        workspace: {
          customer: {
            defaultPaymentMethodId: "pm_123",
            isUsageSubscriber: true,
            state: "ACTIVE",
            subscriptions: [{ id: "sub_123", status: "active" }],
          },
          id: "workspace-id",
          members: [
            {
              email: "mehran.gharuni@gmail.com",
              role: "ADMIN",
            },
          ],
          name: "Workspace",
          plan: "PRO",
          subscriptionModel: "USER",
        },
      },
      volumeInstance: {
        id: "volume-instance-id",
        mountPath: "/var/lib/postgresql/data",
        service: {
          name: "Postgres",
        },
        state: "READY",
        volume: {
          name: "postgres-volume",
        },
      },
      volumeInstanceBackupList: [{ id: "backup-1" }],
      volumeInstanceBackupScheduleList: [{ id: "schedule-1" }],
    };

    expect(evaluateRailwayBackupGate(probe)).toMatchObject({
      evidence: {
        backupCount: 1,
        backupScheduleCount: 1,
        maxBackupsCount: 7,
      },
      failures: [],
      nextActions: [],
      passed: true,
    });
  });

  it("fails with a plan-upgrade remediation when Railway billing is active but backups are unavailable", () => {
    const probe: RailwayBackupProbeData = {
      project: {
        name: "TypeTalk",
        subscriptionPlanLimit: {
          volumes: {
            maxBackupsCount: 0,
            maxBackupsUsagePercent: 0,
          },
        },
        subscriptionType: "hobby",
        workspace: {
          customer: {
            defaultPaymentMethodId: "pm_123",
            isUsageSubscriber: true,
            state: "ACTIVE",
            subscriptions: [{ id: "sub_123", status: "active" }],
          },
          id: "workspace-id",
          members: [],
          name: "Workspace",
          plan: "HOBBY",
          subscriptionModel: "USER",
        },
      },
      volumeInstance: {
        id: "volume-instance-id",
        mountPath: "/var/lib/postgresql/data",
        service: {
          name: "Postgres",
        },
        state: "READY",
        volume: {
          name: "postgres-volume",
        },
      },
      volumeInstanceBackupList: [],
      volumeInstanceBackupScheduleList: [],
    };

    expect(evaluateRailwayBackupGate(probe)).toMatchObject({
      evidence: {
        backupCount: 0,
        backupScheduleCount: 0,
        maxBackupsCount: 0,
        project: {
          workspace: {
            customer: {
              hasDefaultPaymentMethod: true,
              isUsageSubscriber: true,
              state: "ACTIVE",
              subscriptionCount: 1,
              subscriptionStatuses: ["active"],
            },
          },
        },
      },
      failures: [
        "Project backup allowance is not enabled (maxBackupsCount=0).",
        "Volume backup schedule list is empty.",
        "Volume backup list is empty.",
      ],
      nextActions: [
        "Railway billing is already active for this workspace, but the current workspace/project plan or capability set still provides zero Postgres backups. Upgrade the live Railway plan or have Railway enable backups out of band, then rerun `npm run railway:backups:check`.",
      ],
      passed: false,
    });
  });

  it("guides the operator to configure a schedule and first backup once the plan allows backups", () => {
    const probe: RailwayBackupProbeData = {
      project: {
        name: "TypeTalk",
        subscriptionPlanLimit: {
          volumes: {
            maxBackupsCount: 7,
            maxBackupsUsagePercent: 50,
          },
        },
        subscriptionType: "pro",
        workspace: {
          customer: {
            defaultPaymentMethodId: "pm_123",
            isUsageSubscriber: true,
            state: "ACTIVE",
            subscriptions: [{ id: "sub_123", status: "active" }],
          },
          id: "workspace-id",
          members: [],
          name: "Workspace",
          plan: "PRO",
          subscriptionModel: "USER",
        },
      },
      volumeInstance: {
        id: "volume-instance-id",
        mountPath: "/var/lib/postgresql/data",
        service: {
          name: "Postgres",
        },
        state: "READY",
        volume: {
          name: "postgres-volume",
        },
      },
      volumeInstanceBackupList: [],
      volumeInstanceBackupScheduleList: [],
    };

    expect(evaluateRailwayBackupGate(probe)).toMatchObject({
      failures: ["Volume backup schedule list is empty.", "Volume backup list is empty."],
      nextActions: [
        "Configure a Railway Postgres backup schedule, then rerun `npm run railway:backups:check`.",
        "Create or wait for at least one Railway Postgres backup record, then rerun `npm run railway:backups:check`.",
      ],
      passed: false,
    });
  });
});

describe("resolveConfiguredVolumeInstanceId", () => {
  it("returns the committed volume instance id for the matching environment and service", () => {
    const metadata: RailwayRunbookMetadata = {
      environments: {
        production: {
          volumeInstances: [
            {
              serviceName: "Postgres",
              volumeInstanceId: "prod-volume-instance",
              volumeName: "postgres-volume",
            },
          ],
        },
      },
      projectId: "project-id",
    };

    expect(resolveConfiguredVolumeInstanceId(metadata, "production")).toBe(
      "prod-volume-instance",
    );
  });
});
