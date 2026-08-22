import type { DeviceDescriptor } from "./device.ts";
import type { QuotaValues } from "./telemetry.ts";

export type SourceName = "official" | "private";

export interface DevicesReading {
  kind: "devices";
  at: number;
  devices: DeviceDescriptor[];
}

export interface SampleReading {
  kind: "sample";
  at: number;
  serial: string;
  model: string;
  values: QuotaValues;
}

export interface ErrorReading {
  kind: "error";
  at: number;
  source: SourceName;
  reason: string;
  serial?: string;
}

export interface TransportReading {
  kind: "transport";
  at: number;
  source: SourceName;
  state: "up" | "down";
  reason: string;
}

export type Reading = DevicesReading | SampleReading | ErrorReading | TransportReading;
