import test from "node:test";
import assert from "node:assert/strict";
import { createMetrics, type Metrics } from "../src/metrics/registry.ts";
import { createStore, type Store } from "../src/metrics/store.ts";
import { normalizeParams } from "../src/domain/telemetry.ts";
import { loadQuotaFixture } from "./helpers.ts";
import type { DeviceDescriptor } from "../src/domain/device.ts";
import type { QuotaValues } from "../src/domain/telemetry.ts";
import type { SampleReading } from "../src/domain/readings.ts";

const DELTA: DeviceDescriptor = { serial: "D361ZEXXXXXXXXXX", model: "DELTA 3 1500", online: true };
const RIVER: DeviceDescriptor = { serial: "R601ZCXXXXXXXXXX", model: "RIVER 2", online: true };
const AT = 1_000_000;

function harness(deviceTtlMs = 900_000, now: () => number = () => AT): { metrics: Metrics; store: Store } {
  const metrics = createMetrics({ version: "1.2.3", mode: "private" });
  return { metrics, store: createStore(metrics, { deviceTtlMs, clock: { now } }) };
}

const sampleOf = (device: DeviceDescriptor, values: QuotaValues, at = AT): SampleReading => ({
  kind: "sample",
  at,
  serial: device.serial,
  model: device.model,
  values,
});

test("a sample writes scaled, labelled series", async () => {
  const { metrics, store } = harness();
  store.apply({ kind: "devices", at: 0, devices: [DELTA] });
  store.apply(sampleOf(DELTA, { "pd.soc": 87, "bms_bmsStatus.vol": 55028, "pd.typec1Watts": 12 }));

  const text = await metrics.registry.metrics();
  assert.match(text, /ecoflow_battery_soc_percent\{serial="D361ZEXXXXXXXXXX",model="DELTA 3 1500"\} 87\n/);
  assert.match(text, /ecoflow_battery_voltage_volts\{serial="D361ZEXXXXXXXXXX",model="DELTA 3 1500"\} 55\.028\n/);
  assert.match(text, /ecoflow_usb_output_power_watts\{serial="D361ZEXXXXXXXXXX",model="DELTA 3 1500",port="typec1"\} 12\n/);
  assert.match(text, /ecoflow_device_up\{serial="D361ZEXXXXXXXXXX",model="DELTA 3 1500"\} 1\n/);
  assert.match(text, /ecoflow_device_last_seen_timestamp_seconds\{serial="D361ZEXXXXXXXXXX",model="DELTA 3 1500"\} 1000\n/);
});

test("the highest-priority source wins when several keys carry the same measurement", async () => {
  const { metrics, store } = harness();
  store.apply(sampleOf(DELTA, { "pd.soc": 87, "bms_emsStatus.f32LcdShowSoc": 88.5, "bms_bmsStatus.soc": 12 }));
  assert.match(await metrics.registry.metrics(), /ecoflow_battery_soc_percent\{[^}]*\} 88\.5\n/);
});

test("a lower-priority source cannot overwrite a higher-priority one in a later frame", async () => {
  const { metrics, store } = harness();
  store.apply(sampleOf(DELTA, { "bms_emsStatus.f32LcdShowSoc": 88.5 }));
  store.apply(sampleOf(DELTA, { "pd.soc": 42 }));
  assert.match(await metrics.registry.metrics(), /ecoflow_battery_soc_percent\{[^}]*\} 88\.5\n/);
});

test("the winning source keeps updating in later frames", async () => {
  const { metrics, store } = harness();
  store.apply(sampleOf(DELTA, { "bms_emsStatus.f32LcdShowSoc": 88.5 }));
  store.apply(sampleOf(DELTA, { "bms_emsStatus.f32LcdShowSoc": 91 }));
  assert.match(await metrics.registry.metrics(), /ecoflow_battery_soc_percent\{[^}]*\} 91\n/);
});

test("scaling follows the serial prefix even when the owner renamed the device", async () => {
  const { metrics, store } = harness();
  const renamed = { ...RIVER, model: "Balcony battery" };
  store.apply({ kind: "devices", at: 0, devices: [renamed] });
  store.apply(sampleOf(renamed, { "bms_bmsStatus.vol": 13 }));
  assert.match(await metrics.registry.metrics(), /ecoflow_battery_voltage_volts\{serial="R601ZCXXXXXXXXXX",model="Balcony battery"\} 13\n/);
});

test("a sentinel remain-time is dropped instead of published as a real estimate", async () => {
  const { metrics, store } = harness();
  store.apply(sampleOf(DELTA, { "bms_emsStatus.chgRemainTime": 5939, "bms_emsStatus.dsgRemainTime": 120 }));
  const text = await metrics.registry.metrics();
  assert.doesNotMatch(text, /ecoflow_battery_time_to_full_seconds\{serial="D361ZEXXXXXXXXXX"/);
  assert.match(text, /ecoflow_battery_time_to_empty_seconds\{serial="D361ZEXXXXXXXXXX",model="DELTA 3 1500"\} 7200\n/);
});

test("a frame carrying only ignored keys does not refresh device freshness", async () => {
  let clockValue = AT;
  const { metrics, store } = harness(60_000, () => clockValue);
  store.apply({ kind: "devices", at: 0, devices: [DELTA] });
  store.apply(sampleOf(DELTA, { "pd.soc": 87 }));

  clockValue = AT + 61_000;
  store.apply(sampleOf(DELTA, { "pd.pdInfoFull": 300000, "pd.bmsInfoIncre": 15000 }, clockValue));
  store.sweep();

  const text = await metrics.registry.metrics();
  assert.match(text, /ecoflow_device_up\{serial="D361ZEXXXXXXXXXX",model="DELTA 3 1500"\} 0\n/);
  assert.doesNotMatch(text, /ecoflow_battery_soc_percent\{serial="D361ZEXXXXXXXXXX"/);
  assert.match(text, /ecoflow_frames_total\{serial="D361ZEXXXXXXXXXX"\} 2\n/);
});

test("stale devices lose their telemetry series instead of reporting zero", async () => {
  let clockValue = AT;
  const { metrics, store } = harness(60_000, () => clockValue);
  store.apply({ kind: "devices", at: 0, devices: [DELTA] });
  store.apply(sampleOf(DELTA, { "pd.soc": 87 }));
  assert.equal(store.hasFreshDevice(), true);

  clockValue = AT + 61_000;
  store.sweep();

  const text = await metrics.registry.metrics();
  assert.doesNotMatch(text, /ecoflow_battery_soc_percent\{serial="D361ZEXXXXXXXXXX"/);
  assert.match(text, /ecoflow_device_up\{serial="D361ZEXXXXXXXXXX",model="DELTA 3 1500"\} 0\n/);
  assert.equal(store.hasFreshDevice(), false);
});

test("a device that disappears from discovery is removed entirely", async () => {
  const { metrics, store } = harness();
  store.apply({ kind: "devices", at: 0, devices: [DELTA] });
  store.apply(sampleOf(DELTA, { "pd.soc": 87 }));
  store.apply({ kind: "devices", at: 1, devices: [] });

  assert.doesNotMatch(await metrics.registry.metrics(), /D361ZEXXXXXXXXXX/);
});

test("a renamed model does not leave the old label set behind", async () => {
  const { metrics, store } = harness();
  store.apply(sampleOf({ ...DELTA, model: "unknown" }, { "pd.soc": 50 }));
  store.apply(sampleOf(DELTA, { "pd.soc": 87 }));

  const text = await metrics.registry.metrics();
  assert.doesNotMatch(text, /model="unknown"/);
  assert.match(text, /ecoflow_battery_soc_percent\{serial="D361ZEXXXXXXXXXX",model="DELTA 3 1500"\} 87\n/);
});

test("upstream failures increment a counter labelled by reason", async () => {
  const { metrics, store } = harness();
  store.apply({ kind: "error", at: 0, source: "official", reason: "api_1006" });
  store.apply({ kind: "error", at: 0, source: "official", reason: "api_1006" });
  store.apply({ kind: "transport", at: 0, source: "official", state: "down", reason: "api_1006" });

  const text = await metrics.registry.metrics();
  assert.match(text, /ecoflow_source_errors_total\{source="official",reason="api_1006"\} 2\n/);
  assert.match(text, /ecoflow_source_up\{source="official"\} 0\n/);
});

test("unmapped keys are counted and reported without becoming series", async () => {
  const { metrics, store } = harness();
  store.apply(sampleOf(DELTA, { "pd.somethingBrandNew": 5, "pd.soc": 10 }));

  const text = await metrics.registry.metrics();
  assert.doesNotMatch(text, /somethingBrandNew/);
  assert.match(text, /ecoflow_unmapped_field_count\{serial="D361ZEXXXXXXXXXX"\} 1\n/);
  assert.deepEqual(store.unmappedReport()[DELTA.serial]?.unmapped, ["pd.somethingBrandNew"]);
});

test("ignored and disputed keys do not inflate the unmapped count", () => {
  const { store } = harness();
  store.apply(sampleOf(DELTA, { "pd.pdInfoFull": 300000, "mppt.outWatts": 0, "bms_emsStatus.chgState": 1 }));
  assert.deepEqual(store.unmappedReport()[DELTA.serial]?.unmapped, []);
});

test("build info carries the version and mode alongside process metrics", async () => {
  const { metrics } = harness();
  const text = await metrics.registry.metrics();
  assert.match(text, /ecoflow_build_info\{version="1\.2\.3",mode="private"\} 1\n/);
  assert.match(text, /ecoflow_exporter_process_cpu_seconds_total/);
});

test("captured payloads produce telemetry for both real devices", async () => {
  const { metrics, store } = harness();
  store.apply({ kind: "devices", at: 0, devices: [DELTA, RIVER] });
  for (const [name, device] of [
    ["d361", DELTA],
    ["r601", RIVER],
  ] as const) {
    const { values } = normalizeParams(loadQuotaFixture(name).params);
    store.apply({ kind: "sample", at: AT, serial: device.serial, model: device.model, values });
  }

  const text = await metrics.registry.metrics();
  assert.match(text, /ecoflow_battery_soc_percent\{serial="D361ZEXXXXXXXXXX",model="DELTA 3 1500"\} 100\n/);
  assert.match(text, /ecoflow_battery_soc_percent\{serial="R601ZCXXXXXXXXXX",model="RIVER 2"\} 88\.5\n/);
  assert.match(text, /ecoflow_battery_design_capacity_amp_hours\{serial="D361ZEXXXXXXXXXX",model="DELTA 3 1500"\} 30\n/);
  assert.match(text, /ecoflow_battery_design_capacity_amp_hours\{serial="R601ZCXXXXXXXXXX",model="RIVER 2"\} 20\n/);
  assert.match(text, /ecoflow_ac_input_voltage_volts\{serial="D361ZEXXXXXXXXXX",model="DELTA 3 1500"\} 225\.365\n/);
  assert.match(text, /ecoflow_energy_discharged_watt_hours\{serial="R601ZCXXXXXXXXXX",model="RIVER 2",path="ac"\} 12719\n/);
});
