import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadConfig } from "../src/config.ts";
import { createLogger } from "../src/utils/logger.ts";
import { createSource } from "../src/sources/index.ts";
import { scrubSecrets } from "../src/utils/rawlog.ts";
import type { Reading } from "../src/domain/readings.ts";

const durationSeconds = Number(process.env.CAPTURE_SECONDS ?? 360);
const outputPath = resolve(process.env.CAPTURE_OUT ?? "capture.ndjson");

const config = loadConfig();
const logger = createLogger({ level: config.logLevel });

const scrubbedSerials = new Map<string, string>();
const scrubSerial = (serial: string): string => {
  const known = scrubbedSerials.get(serial);
  if (known) return known;
  const masked = `${serial.slice(0, 6)}${"X".repeat(Math.max(0, serial.length - 6))}`;
  scrubbedSerials.set(serial, masked);
  return masked;
};

mkdirSync(dirname(outputPath), { recursive: true });

const controller = new AbortController();
const stopTimer = setTimeout(() => { controller.abort(); }, durationSeconds * 1000);
process.once("SIGINT", () => { controller.abort(); });

const counts = new Map<string, number>();
const keys = new Map<string, Set<string>>();

const record = (reading: Reading): void => {
  let masked = reading;
  if (reading.kind === "sample") {
    masked = { ...reading, serial: scrubSerial(reading.serial) };
  } else if (reading.kind === "devices") {
    masked = { ...reading, devices: reading.devices.map((device) => ({ ...device, serial: scrubSerial(device.serial) })) };
  } else if (reading.kind === "error" && reading.serial) {
    masked = { ...reading, serial: scrubSerial(reading.serial) };
  }
  appendFileSync(outputPath, `${scrubSecrets(JSON.stringify(masked))}\n`);
};

logger.info("capturing", { out: outputPath, seconds: durationSeconds, mode: config.mode });

for await (const reading of createSource(config, { signal: controller.signal })) {
  record(reading);
  if (reading.kind !== "sample") continue;
  const serial = scrubSerial(reading.serial);
  counts.set(serial, (counts.get(serial) ?? 0) + 1);
  const seen = keys.get(serial) ?? new Set<string>();
  for (const key of Object.keys(reading.values)) seen.add(key);
  keys.set(serial, seen);
}

clearTimeout(stopTimer);

for (const [serial, frames] of counts) {
  logger.info("captured device", { serial, frames, distinctKeys: keys.get(serial)?.size ?? 0 });
}
