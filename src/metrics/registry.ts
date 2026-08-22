import { Counter, Gauge, Registry, collectDefaultMetrics } from "prom-client";
import { metricDefinitions } from "../domain/fields.ts";

export const DEVICE_LABELS = ["serial", "model"] as const;

export type LabelSet = Record<string, string>;

export interface Metrics {
  registry: Registry;
  telemetry: Map<string, Gauge>;
  deviceUp: Gauge;
  deviceOnline: Gauge;
  deviceLastSeen: Gauge;
  deviceInfo: Gauge;
  sourceUp: Gauge;
  sourceErrors: Counter;
  frames: Counter;
  unmappedFieldCount: Gauge;
}

export interface BuildInfo {
  version?: string;
  mode?: string;
}

export function createMetrics({ version = "0.0.0", mode = "private" }: BuildInfo = {}): Metrics {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: "ecoflow_exporter_" });

  const telemetry = new Map<string, Gauge>();
  for (const definition of metricDefinitions()) {
    telemetry.set(
      definition.name,
      new Gauge({
        name: definition.name,
        help: definition.help,
        labelNames: [...DEVICE_LABELS, ...definition.labelNames],
        registers: [registry],
      }),
    );
  }

  new Gauge({
    name: "ecoflow_build_info",
    help: "Constant 1 series carrying exporter build labels.",
    labelNames: ["version", "mode"],
    registers: [registry],
  }).set({ version, mode }, 1);

  return {
    registry,
    telemetry,
    deviceUp: new Gauge({
      name: "ecoflow_device_up",
      help: "1 when the exporter holds telemetry for this device that is newer than the freshness budget.",
      labelNames: [...DEVICE_LABELS],
      registers: [registry],
    }),
    deviceOnline: new Gauge({
      name: "ecoflow_device_online",
      help: "1 when the EcoFlow cloud reports the device as online.",
      labelNames: [...DEVICE_LABELS],
      registers: [registry],
    }),
    deviceLastSeen: new Gauge({
      name: "ecoflow_device_last_seen_timestamp_seconds",
      help: "Unix timestamp of the most recent telemetry frame accepted for this device.",
      labelNames: [...DEVICE_LABELS],
      registers: [registry],
    }),
    deviceInfo: new Gauge({
      name: "ecoflow_device_info",
      help: "Constant 1 series carrying device identity labels.",
      labelNames: [...DEVICE_LABELS],
      registers: [registry],
    }),
    sourceUp: new Gauge({
      name: "ecoflow_source_up",
      help: "1 when the upstream data source is connected and delivering.",
      labelNames: ["source"],
      registers: [registry],
    }),
    sourceErrors: new Counter({
      name: "ecoflow_source_errors_total",
      help: "Total upstream failures, labelled by a stable machine-readable reason.",
      labelNames: ["source", "reason"],
      registers: [registry],
    }),
    frames: new Counter({
      name: "ecoflow_frames_total",
      help: "Total telemetry frames accepted per device.",
      labelNames: ["serial"],
      registers: [registry],
    }),
    unmappedFieldCount: new Gauge({
      name: "ecoflow_unmapped_field_count",
      help: "Number of distinct payload keys seen for this device that have no field-map entry.",
      labelNames: ["serial"],
      registers: [registry],
    }),
  };
}
