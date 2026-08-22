import { DISPUTED_FIELDS, IGNORED_FIELDS, getFieldTable } from "../domain/fields.ts";
import type { DevicesReading, Reading, SampleReading } from "../domain/readings.ts";
import type { Logger } from "../utils/logger.ts";
import type { LabelSet, Metrics } from "./registry.ts";

interface DeviceState {
  model: string;
  lastSeenMs: number;
  written: Map<string, Map<string, LabelSet>>;
  sourceKeyByMetric: Map<string, { priority: number; key: string }>;
  unmapped: Set<string>;
}

export type UnmappedReport = Record<string, { model: string; unmapped: string[] }>;

export interface Store {
  apply(reading: Reading): void;
  sweep(): void;
  hasFreshDevice(): boolean;
  unmappedReport(): UnmappedReport;
}

export interface StoreOptions {
  deviceTtlMs?: number;
  clock?: { now(): number };
  logger?: Logger;
}

export function createStore(
  metrics: Metrics,
  { deviceTtlMs = 900_000, clock = Date, logger }: StoreOptions = {},
): Store {
  const devices = new Map<string, DeviceState>();

  function forgetTelemetry(state: DeviceState): void {
    for (const [metricName, labelSets] of state.written) {
      const gauge = metrics.telemetry.get(metricName);
      if (!gauge) continue;
      for (const labels of labelSets.values()) gauge.remove(labels);
    }
    state.written.clear();
    state.sourceKeyByMetric.clear();
  }

  function forgetDevice(serial: string, state: DeviceState): void {
    forgetTelemetry(state);
    const labels = { serial, model: state.model };
    metrics.deviceUp.remove(labels);
    metrics.deviceOnline.remove(labels);
    metrics.deviceLastSeen.remove(labels);
    metrics.deviceInfo.remove(labels);
    metrics.unmappedFieldCount.remove({ serial });
    metrics.frames.remove({ serial });
  }

  function ensureDevice(serial: string, model: string): DeviceState {
    const existing = devices.get(serial);
    if (!existing) {
      const created: DeviceState = {
        model,
        lastSeenMs: 0,
        written: new Map(),
        sourceKeyByMetric: new Map(),
        unmapped: new Set(),
      };
      devices.set(serial, created);
      return created;
    }
    if (model && model !== existing.model) {
      forgetDevice(serial, existing);
      existing.model = model;
    }
    return existing;
  }

  function applySample(reading: SampleReading): void {
    const state = ensureDevice(reading.serial, reading.model);
    const table = getFieldTable(reading.serial);
    const labels: LabelSet = { serial: reading.serial, model: state.model };
    let wroteTelemetry = false;

    for (const [key, value] of Object.entries(reading.values)) {
      const spec = table[key];
      if (!spec) {
        if (!IGNORED_FIELDS[key] && !DISPUTED_FIELDS[key] && !state.unmapped.has(key)) {
          state.unmapped.add(key);
          logger?.once(`unmapped:${state.model}:${key}`, "debug", "unmapped telemetry key", {
            serial: reading.serial,
            model: state.model,
            key,
          });
        }
        continue;
      }

      if (spec.sentinel !== null && value >= spec.sentinel) continue;

      const winner = state.sourceKeyByMetric.get(spec.metric);
      if (winner && winner.key !== key && winner.priority > spec.priority) continue;

      const gauge = metrics.telemetry.get(spec.metric);
      if (!gauge) continue;

      const metricLabels: LabelSet = spec.labels ? { ...labels, ...spec.labels } : labels;
      gauge.set(metricLabels, value * spec.scale);
      state.sourceKeyByMetric.set(spec.metric, { priority: spec.priority, key });
      wroteTelemetry = true;

      let labelSets = state.written.get(spec.metric);
      if (!labelSets) {
        labelSets = new Map();
        state.written.set(spec.metric, labelSets);
      }
      labelSets.set(JSON.stringify(metricLabels), metricLabels);
    }

    metrics.frames.inc({ serial: reading.serial });
    metrics.unmappedFieldCount.set({ serial: reading.serial }, state.unmapped.size);
    if (!wroteTelemetry) return;

    state.lastSeenMs = reading.at;
    metrics.deviceLastSeen.set(labels, reading.at / 1000);
    metrics.deviceUp.set(labels, 1);
    metrics.deviceInfo.set(labels, 1);
  }

  function applyDevices(reading: DevicesReading): void {
    const seen = new Set<string>();
    for (const entry of reading.devices) {
      seen.add(entry.serial);
      const state = ensureDevice(entry.serial, entry.model);
      const labels = { serial: entry.serial, model: state.model };
      metrics.deviceInfo.set(labels, 1);
      metrics.deviceOnline.set(labels, entry.online ? 1 : 0);
      if (!state.lastSeenMs) metrics.deviceUp.set(labels, 0);
    }
    for (const [serial, state] of devices) {
      if (seen.has(serial)) continue;
      forgetDevice(serial, state);
      devices.delete(serial);
    }
  }

  return {
    apply(reading) {
      switch (reading.kind) {
        case "devices":
          applyDevices(reading);
          return;
        case "sample":
          applySample(reading);
          return;
        case "error":
          metrics.sourceErrors.inc({ source: reading.source, reason: reading.reason });
          return;
        case "transport":
          metrics.sourceUp.set({ source: reading.source }, reading.state === "up" ? 1 : 0);
          return;
      }
    },
    sweep() {
      const cutoff = clock.now() - deviceTtlMs;
      for (const [serial, state] of devices) {
        if (!state.lastSeenMs || state.lastSeenMs >= cutoff) continue;
        forgetTelemetry(state);
        metrics.deviceUp.set({ serial, model: state.model }, 0);
        state.lastSeenMs = 0;
      }
    },
    hasFreshDevice() {
      const cutoff = clock.now() - deviceTtlMs;
      for (const state of devices.values()) {
        if (state.lastSeenMs && state.lastSeenMs >= cutoff) return true;
      }
      return false;
    },
    unmappedReport() {
      const report: UnmappedReport = {};
      for (const [serial, state] of devices) {
        report[serial] = { model: state.model, unmapped: [...state.unmapped].sort() };
      }
      return report;
    },
  };
}
