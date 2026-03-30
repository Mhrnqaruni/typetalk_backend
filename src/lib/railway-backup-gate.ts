export type RailwayLinkedProject = {
  environment?: string;
  environmentName?: string;
  name?: string;
  project?: string;
  projectPath?: string;
  service?: string | null;
};

export type RailwayConfigFile = {
  projects?: Record<string, RailwayLinkedProject>;
  user?: {
    token?: string;
  };
};

export type RailwayBackupProbeData = {
  project: {
    name?: string | null;
    subscriptionPlanLimit?: unknown;
    subscriptionType?: string | null;
    workspace?: {
      customer?: {
        defaultPaymentMethodId?: string | null;
        isUsageSubscriber?: boolean | null;
        state?: string | null;
        subscriptions?: Array<{
          id?: string | null;
          status?: string | null;
        }> | null;
      } | null;
      id?: string | null;
      members?: Array<{
        email?: string | null;
        role?: string | null;
      }> | null;
      name?: string | null;
      plan?: string | null;
      subscriptionModel?: string | null;
    } | null;
  } | null;
  volumeInstance: {
    id?: string | null;
    mountPath?: string | null;
    service?: {
      name?: string | null;
    } | null;
    state?: string | null;
    volume?: {
      name?: string | null;
    } | null;
  } | null;
  volumeInstanceBackupList?: Array<{
    id?: string | null;
  }> | null;
  volumeInstanceBackupScheduleList?: Array<{
    id?: string | null;
  }> | null;
};

export type RailwayBackupGateResult = {
  evidence: {
    backupCount: number;
    backupScheduleCount: number;
    maxBackupsCount: number | null;
    maxBackupsUsagePercent: number | null;
    project: {
      name: string | null;
      subscriptionType: string | null;
      workspace: {
        id: string | null;
        members: Array<{
          email: string | null;
          role: string | null;
        }>;
        name: string | null;
        plan: string | null;
        subscriptionModel: string | null;
        customer: {
          hasDefaultPaymentMethod: boolean;
          isUsageSubscriber: boolean | null;
          state: string | null;
          subscriptionCount: number;
          subscriptionStatuses: Array<string | null>;
        } | null;
      } | null;
    } | null;
    volumeInstance: {
      id: string | null;
      mountPath: string | null;
      serviceName: string | null;
      state: string | null;
      volumeName: string | null;
    } | null;
  };
  failures: string[];
  nextActions: string[];
  passed: boolean;
};

export type RailwayRunbookMetadata = {
  environments?: Record<
    string,
    {
      volumeInstances?: Array<{
        serviceName?: string | null;
        volumeInstanceId?: string | null;
        volumeName?: string | null;
      }>;
    }
  >;
  projectId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getNumberField(value: unknown, key: string): number | null {
  if (!isRecord(value)) {
    return null;
  }

  const candidate = value[key];
  return typeof candidate === "number" ? candidate : null;
}

function getVolumesPlanLimit(subscriptionPlanLimit: unknown): Record<string, unknown> | null {
  if (!isRecord(subscriptionPlanLimit)) {
    return null;
  }

  const volumes = subscriptionPlanLimit["volumes"];
  return isRecord(volumes) ? volumes : null;
}

export function findLinkedRailwayProject(
  config: RailwayConfigFile,
  cwd: string,
): RailwayLinkedProject | null {
  const entries = Object.entries(config.projects ?? {})
    .map(([configPath, project]) => ({
      path: (project.projectPath ?? configPath).toLowerCase(),
      project,
    }))
    .filter(({ path }) => cwd.toLowerCase().startsWith(path))
    .sort((left, right) => right.path.length - left.path.length);

  return entries[0]?.project ?? null;
}

export function evaluateRailwayBackupGate(probe: RailwayBackupProbeData): RailwayBackupGateResult {
  const volumesPlanLimit = getVolumesPlanLimit(probe.project?.subscriptionPlanLimit);
  const maxBackupsCount = getNumberField(volumesPlanLimit, "maxBackupsCount");
  const maxBackupsUsagePercent = getNumberField(volumesPlanLimit, "maxBackupsUsagePercent");
  const backupScheduleCount = Array.isArray(probe.volumeInstanceBackupScheduleList)
    ? probe.volumeInstanceBackupScheduleList.length
    : 0;
  const backupCount = Array.isArray(probe.volumeInstanceBackupList)
    ? probe.volumeInstanceBackupList.length
    : 0;
  const workspaceCustomer = probe.project?.workspace?.customer;
  const volumeReady = probe.volumeInstance?.state === "READY";
  const backupsAllowed = (maxBackupsCount ?? 0) > 0;

  const failures: string[] = [];
  const nextActions: string[] = [];

  if (!probe.project) {
    failures.push("Project data is missing from the Railway backup probe.");
  }

  if (!probe.volumeInstance) {
    failures.push("Volume instance data is missing from the Railway backup probe.");
  }

  if (!volumeReady) {
    failures.push(
      `Volume instance is not READY (state=${probe.volumeInstance?.state ?? "unknown"}).`,
    );
    nextActions.push(
      "Wait for the Railway Postgres volume to return to READY, then rerun the backup gate.",
    );
  }

  if (!backupsAllowed) {
    failures.push(
      `Project backup allowance is not enabled (maxBackupsCount=${maxBackupsCount ?? "null"}).`,
    );

    if (
      workspaceCustomer?.state === "ACTIVE" &&
      typeof workspaceCustomer.defaultPaymentMethodId === "string" &&
      workspaceCustomer.defaultPaymentMethodId.length > 0
    ) {
      nextActions.push(
        "Railway billing is already active for this workspace, but the current workspace/project plan or capability set still provides zero Postgres backups. Upgrade the live Railway plan or have Railway enable backups out of band, then rerun `npm run railway:backups:check`.",
      );
    } else {
      nextActions.push(
        "Activate Railway billing on a workspace/project plan that includes Postgres backups, then rerun `npm run railway:backups:check`.",
      );
    }
  }

  if (backupScheduleCount <= 0) {
    failures.push("Volume backup schedule list is empty.");

    if (backupsAllowed) {
      nextActions.push(
        "Configure a Railway Postgres backup schedule, then rerun `npm run railway:backups:check`.",
      );
    }
  }

  if (backupCount <= 0) {
    failures.push("Volume backup list is empty.");

    if (backupsAllowed) {
      nextActions.push(
        "Create or wait for at least one Railway Postgres backup record, then rerun `npm run railway:backups:check`.",
      );
    }
  }

  return {
    evidence: {
      backupCount,
      backupScheduleCount,
      maxBackupsCount,
      maxBackupsUsagePercent,
      project: probe.project
        ? {
            name: probe.project.name ?? null,
            subscriptionType: probe.project.subscriptionType ?? null,
            workspace: probe.project.workspace
              ? {
                  id: probe.project.workspace.id ?? null,
                  members: (probe.project.workspace.members ?? []).map((member) => ({
                    email: member.email ?? null,
                    role: member.role ?? null,
                  })),
                  name: probe.project.workspace.name ?? null,
                  plan: probe.project.workspace.plan ?? null,
                  subscriptionModel: probe.project.workspace.subscriptionModel ?? null,
                  customer: probe.project.workspace.customer
                    ? {
                        hasDefaultPaymentMethod: Boolean(
                          probe.project.workspace.customer.defaultPaymentMethodId,
                        ),
                        isUsageSubscriber:
                          typeof probe.project.workspace.customer.isUsageSubscriber === "boolean"
                            ? probe.project.workspace.customer.isUsageSubscriber
                            : null,
                        state: probe.project.workspace.customer.state ?? null,
                        subscriptionCount: Array.isArray(
                          probe.project.workspace.customer.subscriptions,
                        )
                          ? probe.project.workspace.customer.subscriptions.length
                          : 0,
                        subscriptionStatuses: (
                          probe.project.workspace.customer.subscriptions ?? []
                        ).map((subscription) => subscription.status ?? null),
                      }
                    : null,
                }
              : null,
          }
        : null,
      volumeInstance: probe.volumeInstance
        ? {
            id: probe.volumeInstance.id ?? null,
            mountPath: probe.volumeInstance.mountPath ?? null,
            serviceName: probe.volumeInstance.service?.name ?? null,
            state: probe.volumeInstance.state ?? null,
            volumeName: probe.volumeInstance.volume?.name ?? null,
          }
        : null,
    },
    failures,
    nextActions,
    passed: failures.length === 0,
  };
}

export function resolveConfiguredVolumeInstanceId(
  metadata: RailwayRunbookMetadata | null,
  environmentName: string,
  serviceName = "Postgres",
): string | null {
  const environment = metadata?.environments?.[environmentName];
  const matchingVolume = environment?.volumeInstances?.find(
    (volumeInstance) => volumeInstance.serviceName === serviceName,
  );

  return matchingVolume?.volumeInstanceId ?? null;
}
