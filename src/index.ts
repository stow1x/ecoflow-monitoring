import { readFile } from "node:fs/promises";
import { ConfigError, loadConfig } from "./config.ts";
import { createLogger } from "./utils/logger.ts";
import { readStringField } from "./utils/values.ts";
import { createMetrics } from "./metrics/registry.ts";
import { createStore } from "./metrics/store.ts";
import { createMetricsServer } from "./server/index.ts";
import { RawLogDirectoryError, createRawLogger, type RawFrame, type RawLogger } from "./utils/rawlog.ts";
import { createSource } from "./sources/index.ts";
import type { Config } from "./config.ts";

const SWEEP_INTERVAL_MS = 15_000;

async function packageVersion(): Promise<string> {
  try {
    const manifest: unknown = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    return readStringField(manifest, "version") ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export async function main(): Promise<void> {
  let config: Config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n\nCopy .env.example to .env and fill it in.\n`);
      process.exit(78);
    }
    throw error;
  }

  const logger = createLogger({ level: config.logLevel });
  const metrics = createMetrics({ version: await packageVersion(), mode: config.mode });
  const store = createStore(metrics, { deviceTtlMs: config.deviceTtlMs, logger });
  let rawLogger: RawLogger | null = null;
  try {
    rawLogger = createRawLogger(config.dumpRawDir);
  } catch (error) {
    if (error instanceof RawLogDirectoryError) {
      process.stderr.write(`${error.message}\n\nPoint DUMP_RAW_DIR at a writable path, or unset it.\n`);
      process.exit(78);
    }
    throw error;
  }
  if (rawLogger) logger.info("writing raw frames", { file: rawLogger.file });

  const server = createMetricsServer({
    registry: metrics.registry,
    isReady: () => store.hasFreshDevice(),
    unmappedReport: () => store.unmappedReport(),
  });

  const listening = Promise.withResolvers<void>();
  server.listen(config.port, () => { listening.resolve(); });
  await listening.promise;
  logger.info("exporter listening", { port: config.port, mode: config.mode });

  const controller = new AbortController();
  const sweepTimer = setInterval(() => { store.sweep(); }, SWEEP_INTERVAL_MS);
  sweepTimer.unref();

  const shutdown = (signal: string): void => {
    logger.info("shutting down", { signal });
    controller.abort();
    clearInterval(sweepTimer);
    server.close();
    void rawLogger?.close();
  };
  process.once("SIGTERM", () => { shutdown("SIGTERM"); });
  process.once("SIGINT", () => { shutdown("SIGINT"); });

  const source = createSource(config, {
    signal: controller.signal,
    ...(rawLogger ? { onRaw: (frame: RawFrame) => { rawLogger.write(frame); } } : {}),
  });

  for await (const reading of source) {
    store.apply(reading);
    if (reading.kind === "error") {
      logger.warn("upstream failure", { source: reading.source, reason: reading.reason, serial: reading.serial });
    }
    if (reading.kind === "transport") {
      logger.info("transport state", { source: reading.source, state: reading.state, reason: reading.reason });
    }
  }

  logger.info("source ended");
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  await main();
}
