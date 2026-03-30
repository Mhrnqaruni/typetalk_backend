import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  evaluateRailwayBackupGate,
  findLinkedRailwayProject,
  type RailwayBackupProbeData,
  type RailwayConfigFile,
  resolveConfiguredVolumeInstanceId,
  type RailwayLinkedProject,
  type RailwayRunbookMetadata,
} from "../lib/railway-backup-gate";

const DEFAULT_GRAPHQL_ENDPOINT = "https://backboard.railway.app/graphql/v2";
const DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".railway", "config.json");
const DEFAULT_METADATA_PATH = path.join(process.cwd(), "runbooks", "railway.production.json");

const BACKUP_GATE_QUERY = `
  query BackupGate($projectId: String!, $volumeInstanceId: String!) {
    project(id: $projectId) {
      name
      subscriptionType
      subscriptionPlanLimit
      workspace {
        customer {
          defaultPaymentMethodId
          isUsageSubscriber
          state
          subscriptions {
            id
            status
          }
        }
        id
        name
        plan
        subscriptionModel
        members {
          email
          role
        }
      }
    }
    volumeInstance(id: $volumeInstanceId) {
      id
      state
      mountPath
      service {
        name
      }
      volume {
        name
      }
    }
    volumeInstanceBackupScheduleList(volumeInstanceId: $volumeInstanceId) {
      id
    }
    volumeInstanceBackupList(volumeInstanceId: $volumeInstanceId) {
      id
    }
  }
`;

type ParsedArgs = {
  configPath?: string;
  endpoint?: string;
  projectId?: string;
  volumeInstanceId?: string;
};

type GraphQlResponse = {
  data?: RailwayBackupProbeData;
  errors?: Array<{
    message?: string;
  }>;
};

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token.startsWith("--config-path=")) {
      parsed.configPath = token.slice("--config-path=".length);
      continue;
    }

    if (token === "--config-path" && next) {
      parsed.configPath = next;
      index += 1;
      continue;
    }

    if (token.startsWith("--endpoint=")) {
      parsed.endpoint = token.slice("--endpoint=".length);
      continue;
    }

    if (token === "--endpoint" && next) {
      parsed.endpoint = next;
      index += 1;
      continue;
    }

    if (token.startsWith("--project-id=")) {
      parsed.projectId = token.slice("--project-id=".length);
      continue;
    }

    if (token === "--project-id" && next) {
      parsed.projectId = next;
      index += 1;
      continue;
    }

    if (token.startsWith("--volume-instance-id=")) {
      parsed.volumeInstanceId = token.slice("--volume-instance-id=".length);
      continue;
    }

    if (token === "--volume-instance-id" && next) {
      parsed.volumeInstanceId = next;
      index += 1;
      continue;
    }
  }

  return parsed;
}

async function loadRailwayConfig(configPath: string): Promise<RailwayConfigFile> {
  const contents = await readFile(configPath, "utf8");
  return JSON.parse(contents) as RailwayConfigFile;
}

async function loadRailwayMetadata(metadataPath: string): Promise<RailwayRunbookMetadata | null> {
  try {
    const contents = await readFile(metadataPath, "utf8");
    return JSON.parse(contents) as RailwayRunbookMetadata;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function getRailwayToken(config: RailwayConfigFile): string {
  const token =
    process.env["RAILWAY_API_TOKEN"] ??
    process.env["RAILWAY_TOKEN"] ??
    config.user?.token;

  if (!token) {
    throw new Error(
      "Railway auth token not found. Set RAILWAY_API_TOKEN or RAILWAY_TOKEN, or log in with the Railway CLI first.",
    );
  }

  return token;
}

function getProjectId(parsedArgs: ParsedArgs, config: RailwayConfigFile): string {
  const linkedProject = findLinkedRailwayProject(config, process.cwd());
  const projectId =
    parsedArgs.projectId ??
    process.env["npm_config_project_id"] ??
    process.env["RAILWAY_PROJECT_ID"] ??
    linkedProject?.project;

  if (!projectId) {
    throw new Error(
      "Railway project id not found. Pass --project-id, set RAILWAY_PROJECT_ID, or run inside a linked Railway project directory.",
    );
  }

  return projectId;
}

function getVolumeInstanceId(
  parsedArgs: ParsedArgs,
  linkedProject: RailwayLinkedProject | null,
  metadata: RailwayRunbookMetadata | null,
): string {
  const configuredVolumeInstanceId = resolveConfiguredVolumeInstanceId(
    metadata,
    linkedProject?.environmentName ?? "production",
  );
  const volumeInstanceId =
    parsedArgs.volumeInstanceId ??
    process.env["npm_config_volume_instance_id"] ??
    process.env["RAILWAY_VOLUME_INSTANCE_ID"] ??
    configuredVolumeInstanceId;

  if (!volumeInstanceId) {
    throw new Error(
      "Railway volume instance id not found. Pass --volume-instance-id, set RAILWAY_VOLUME_INSTANCE_ID, or add the committed production metadata file.",
    );
  }

  return volumeInstanceId;
}

async function fetchBackupGateData(
  endpoint: string,
  token: string,
  projectId: string,
  volumeInstanceId: string,
): Promise<RailwayBackupProbeData> {
  const response = await fetch(endpoint, {
    body: JSON.stringify({
      query: BACKUP_GATE_QUERY,
      variables: {
        projectId,
        volumeInstanceId,
      },
    }),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Railway GraphQL request failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as GraphQlResponse;

  if (payload.errors?.length) {
    const messages = payload.errors.map((error) => error.message ?? "Unknown GraphQL error");
    throw new Error(`Railway GraphQL returned errors: ${messages.join("; ")}`);
  }

  if (!payload.data) {
    throw new Error("Railway GraphQL returned no data.");
  }

  return payload.data;
}

async function main(): Promise<void> {
  const parsedArgs = parseArgs(process.argv.slice(2));
  const configPath = parsedArgs.configPath ?? DEFAULT_CONFIG_PATH;
  const endpoint = parsedArgs.endpoint ?? DEFAULT_GRAPHQL_ENDPOINT;
  const config = await loadRailwayConfig(configPath);
  const metadata = await loadRailwayMetadata(DEFAULT_METADATA_PATH);
  const linkedProject = findLinkedRailwayProject(config, process.cwd());
  const token = getRailwayToken(config);
  const projectId = getProjectId(parsedArgs, config);
  const volumeInstanceId = getVolumeInstanceId(parsedArgs, linkedProject, metadata);
  const probe = await fetchBackupGateData(endpoint, token, projectId, volumeInstanceId);
  const result = evaluateRailwayBackupGate(probe);

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.passed ? 0 : 1;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
