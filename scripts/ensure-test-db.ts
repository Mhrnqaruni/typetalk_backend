import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const PG_BIN_DIR = process.env["PG_BIN_DIR"] ?? "C:\\Program Files\\PostgreSQL\\17\\bin";
const HOST = process.env["TEST_DB_HOST"] ?? "127.0.0.1";
const PORT = process.env["TEST_DB_PORT"] ?? "55432";
const DATA_DIR = path.join(process.cwd(), ".tmp", "postgres", "data");
const LOG_PATH = path.join(process.cwd(), ".tmp", "postgres", "postgres.log");
const REQUIRED_DATABASES = ["typetalk_dev", "typetalk_test"] as const;

function binaryPath(name: string): string {
  return path.join(PG_BIN_DIR, `${name}.exe`);
}

function tailLog(logPath: string, maxLines = 40): string {
  if (!existsSync(logPath)) {
    return "PostgreSQL log file does not exist yet.";
  }

  const lines = readFileSync(logPath, "utf8").trim().split(/\r?\n/);
  return lines.slice(-maxLines).join("\n");
}

function runCommand(
  command: string,
  args: string[],
  allowFailure = false,
): SpawnSyncReturns<string> {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true,
  });

  if (!allowFailure && result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    throw new Error(
      [`Command failed: ${command} ${args.join(" ")}`, stderr, stdout]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return result;
}

function isDatabaseReady(): boolean {
  const result = runCommand(binaryPath("pg_isready"), ["-h", HOST, "-p", PORT], true);
  return result.status === 0;
}

function ensureRequiredDatabases(): void {
  for (const databaseName of REQUIRED_DATABASES) {
    const existsResult = runCommand(
      binaryPath("psql"),
      [
        "-w",
        "-h",
        HOST,
        "-p",
        PORT,
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-Atqc",
        `SELECT 1 FROM pg_database WHERE datname = '${databaseName}'`,
      ],
      true,
    );

    if (existsResult.stdout?.trim() === "1") {
      continue;
    }

    runCommand(binaryPath("createdb"), [
      "-w",
      "-h",
      HOST,
      "-p",
      PORT,
      "-U",
      "postgres",
      databaseName,
    ]);
  }
}

async function startDatabaseIfNeeded(): Promise<void> {
  if (!existsSync(DATA_DIR)) {
    throw new Error(
      `Expected local PostgreSQL data directory at ${DATA_DIR}, but it does not exist.`,
    );
  }

  if (isDatabaseReady()) {
    ensureRequiredDatabases();
    process.stdout.write(`Test database already ready at ${HOST}:${PORT}.\n`);
    return;
  }

  const pidPath = path.join(DATA_DIR, "postmaster.pid");

  if (existsSync(pidPath)) {
    rmSync(pidPath, { force: true });
  }

  mkdirSync(path.dirname(LOG_PATH), { recursive: true });

  const startResult = runCommand(
    binaryPath("pg_ctl"),
    ["start", "-w", "-t", "30", "-D", DATA_DIR, "-l", LOG_PATH, "-o", `-p ${PORT} -h ${HOST}`],
    true,
  );

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (isDatabaseReady()) {
      ensureRequiredDatabases();
      process.stdout.write(`Test database ready at ${HOST}:${PORT}.\n`);
      return;
    }

    await delay(500);
  }

  const stderr = startResult.stderr?.trim();
  const stdout = startResult.stdout?.trim();
  throw new Error(
    [
      `Failed to start local PostgreSQL test cluster at ${HOST}:${PORT}.`,
      stderr,
      stdout,
      tailLog(LOG_PATH),
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
}

void startDatabaseIfNeeded().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
