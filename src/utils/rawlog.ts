import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { SourceName } from "../domain/readings.ts";

export interface RawFrame {
  source: SourceName;
  endpoint?: string;
  topic?: string;
  serial?: string;
  payload: unknown;
}

const SECRET_PATTERN =
  /("(?:token|password|secret|secretKey|accessKey|authorization|certificatePassword|sign)"\s*:\s*)("[^"]*"|-?\d+(?:\.\d+)?|true|false|null)/gi;

const SERIAL_VISIBLE_PREFIX = 6;

export class RawLogDirectoryError extends Error {
  constructor(directory: string, cause: unknown) {
    super(`DUMP_RAW_DIR is not writable: ${directory} (${cause instanceof Error ? cause.message : String(cause)})`);
    this.name = "RawLogDirectoryError";
  }
}

export function scrubSecrets(text: string): string {
  return text.replace(SECRET_PATTERN, '$1"[redacted]"');
}

export function maskSerial(serial: string): string {
  return `${serial.slice(0, SERIAL_VISIBLE_PREFIX)}${"X".repeat(Math.max(0, serial.length - SERIAL_VISIBLE_PREFIX))}`;
}

export interface RawLogger {
  file: string;
  write(frame: RawFrame): void;
  close(): Promise<void>;
}

export function createRawLogger(directory: string | null): RawLogger | null {
  if (!directory) return null;
  try {
    mkdirSync(directory, { recursive: true });
  } catch (error) {
    throw new RawLogDirectoryError(directory, error);
  }

  const file = join(directory, `ecoflow-raw-${new Date().toISOString().replaceAll(":", "-")}.ndjson`);
  const stream = createWriteStream(file, { flags: "a" });

  return {
    file,
    write(frame) {
      let line = scrubSecrets(JSON.stringify({ at: Date.now(), ...frame }));
      if (frame.serial) line = line.replaceAll(frame.serial, maskSerial(frame.serial));
      stream.write(`${line}\n`);
    },
    close() {
      const { promise, resolve } = Promise.withResolvers<void>();
      stream.end(resolve);
      return promise;
    },
  };
}
