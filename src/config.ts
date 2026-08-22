import type { SourceName } from "./domain/readings.ts";
import type { LogLevel } from "./utils/logger.ts";

export interface Config {
  mode: SourceName;
  apiHost: string;
  discoveryHost: string;
  accessKey: string | null;
  secretKey: string | null;
  email: string | null;
  password: string | null;
  serials: string[];
  pollIntervalMs: number;
  snapshotIntervalMs: number;
  deviceTtlMs: number;
  port: number;
  logLevel: LogLevel;
  dumpRawDir: string | null;
}

export class ConfigError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Invalid configuration:\n  ${problems.join("\n  ")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

const DEFAULT_OFFICIAL_HOST = "https://api-e.ecoflow.com";
const DEFAULT_PRIVATE_HOST = "https://api.ecoflow.com";
const LOG_LEVELS: Record<string, true> = { error: true, warn: true, info: true, debug: true };

type Env = Record<string, string | undefined>;

interface Bounds {
  min: number;
  max: number;
}

function readSeconds(env: Env, name: string, fallback: number, { min, max }: Bounds, problems: string[]): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback * 1000;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    problems.push(`${name}: expected an integer between ${min} and ${max}, got ${JSON.stringify(raw)}`);
    return fallback * 1000;
  }
  return value * 1000;
}

function readPort(env: Env, problems: string[]): number {
  const raw = env.EXPORTER_PORT;
  if (raw === undefined || raw === "") return 9101;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    problems.push(`EXPORTER_PORT: expected an integer between 1 and 65535, got ${JSON.stringify(raw)}`);
    return 9101;
  }
  return value;
}

export function loadConfig(env: Env = process.env): Config {
  const problems: string[] = [];

  const rawMode = (env.ECOFLOW_MODE ?? "private").trim().toLowerCase();
  if (rawMode !== "private" && rawMode !== "official") {
    problems.push(`ECOFLOW_MODE: expected "private" or "official", got ${JSON.stringify(env.ECOFLOW_MODE)}`);
  }
  const mode = (rawMode === "official" ? "official" : "private") satisfies SourceName;

  const accessKey = env.ECOFLOW_ACCESS_KEY?.trim() || null;
  const secretKey = env.ECOFLOW_SECRET_KEY?.trim() || null;
  const email = env.ECOFLOW_EMAIL?.trim() || null;
  const password = env.ECOFLOW_PASSWORD || null;
  const serials = (env.ECOFLOW_SERIALS ?? "")
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean);

  const hasOfficialKeys = Boolean(accessKey && secretKey);

  if (rawMode === "official" && !hasOfficialKeys) {
    problems.push("ECOFLOW_ACCESS_KEY and ECOFLOW_SECRET_KEY are both required when ECOFLOW_MODE=official");
  }
  if (rawMode === "private") {
    if (!email) problems.push("ECOFLOW_EMAIL is required when ECOFLOW_MODE=private");
    if (!password) problems.push("ECOFLOW_PASSWORD is required when ECOFLOW_MODE=private");
    if (!serials.length && !hasOfficialKeys) {
      problems.push(
        "ECOFLOW_SERIALS is required when ECOFLOW_MODE=private, because the app API exposes no device-list endpoint. " +
          "Alternatively set ECOFLOW_ACCESS_KEY and ECOFLOW_SECRET_KEY so devices can be discovered over the official API.",
      );
    }
  }

  const logLevel = (env.LOG_LEVEL ?? "info").trim().toLowerCase();
  if (!LOG_LEVELS[logLevel]) {
    problems.push(`LOG_LEVEL: expected one of error|warn|info|debug, got ${JSON.stringify(env.LOG_LEVEL)}`);
  }

  const config: Config = {
    mode,
    apiHost: (env.ECOFLOW_API_HOST?.trim() || (mode === "official" ? DEFAULT_OFFICIAL_HOST : DEFAULT_PRIVATE_HOST)).replace(/\/+$/, ""),
    discoveryHost: (env.ECOFLOW_DISCOVERY_HOST?.trim() || DEFAULT_OFFICIAL_HOST).replace(/\/+$/, ""),
    accessKey,
    secretKey,
    email,
    password,
    serials,
    pollIntervalMs: readSeconds(env, "POLL_INTERVAL_SECONDS", 60, { min: 10, max: 86_400 }, problems),
    snapshotIntervalMs: readSeconds(env, "SNAPSHOT_INTERVAL_SECONDS", 300, { min: 30, max: 86_400 }, problems),
    deviceTtlMs: readSeconds(env, "DEVICE_TTL_SECONDS", 900, { min: 30, max: 86_400 }, problems),
    port: readPort(env, problems),
    logLevel: (LOG_LEVELS[logLevel] ? logLevel : "info") as LogLevel,
    dumpRawDir: env.DUMP_RAW_DIR?.trim() || null,
  };

  if (problems.length) throw new ConfigError(problems);
  return Object.freeze(config);
}
