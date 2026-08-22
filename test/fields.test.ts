import test from "node:test";
import assert from "node:assert/strict";
import { DISPUTED_FIELDS, FIELD_MAP, SERIAL_PREFIX_PATCHES, getFieldTable, metricDefinitions } from "../src/domain/fields.ts";
import { loadQuotaFixture } from "./helpers.ts";

const UNIT_SUFFIXES = [
  "_percent",
  "_watts",
  "_volts",
  "_amperes",
  "_celsius",
  "_seconds",
  "_hertz",
  "_watt_hours",
  "_amp_hours",
  "_milliohms",
  "_enabled",
  "_connected",
  "_code",
  "_cycles",
  "_level",
  "_events",
];

test("every metric name is prefixed and carries a recognised unit suffix", () => {
  for (const spec of Object.values(FIELD_MAP)) {
    assert.ok(spec.metric.startsWith("ecoflow_"), `${spec.metric} is missing the ecoflow_ prefix`);
    assert.ok(UNIT_SUFFIXES.some((suffix) => spec.metric.endsWith(suffix)), `${spec.metric} has no recognised unit suffix`);
  }
});

test("every field carries help text that reads as a sentence", () => {
  for (const [key, spec] of Object.entries(FIELD_MAP)) {
    assert.ok(spec.help.length > 10, `${key} has no useful help text`);
    assert.ok(spec.help.endsWith("."), `${key} help text does not end in a period`);
  }
});

test("fields sharing a metric name agree on help text and label names", () => {
  const seen = new Map<string, { help: string; labelNames: string }>();
  for (const spec of Object.values(FIELD_MAP)) {
    const labelNames = spec.labels ? Object.keys(spec.labels).sort().join(",") : "";
    const previous = seen.get(spec.metric);
    if (!previous) {
      seen.set(spec.metric, { help: spec.help, labelNames });
      continue;
    }
    assert.equal(spec.help, previous.help, `${spec.metric} has conflicting help text`);
    assert.equal(labelNames, previous.labelNames, `${spec.metric} has conflicting label names`);
  }
});

test("unlabelled aliases for one metric have distinct priorities", () => {
  const priorities = new Map<string, Map<number, string>>();
  for (const [key, spec] of Object.entries(FIELD_MAP)) {
    if (spec.labels) continue;
    const bucket = priorities.get(spec.metric) ?? new Map<number, string>();
    const clash = bucket.get(spec.priority);
    assert.equal(clash, undefined, `${spec.metric} has ${key} and ${clash} both at priority ${spec.priority}`);
    bucket.set(spec.priority, key);
    priorities.set(spec.metric, bucket);
  }
});

test("disputed fields are documented and never exported", () => {
  for (const [key, reason] of Object.entries(DISPUTED_FIELDS)) {
    assert.equal(FIELD_MAP[key], undefined, `${key} is disputed but present in the field map`);
    assert.ok(reason.length > 40, `${key} needs a real explanation`);
  }
});

test("serial-prefix patches only override fields that exist", () => {
  for (const [prefix, patch] of Object.entries(SERIAL_PREFIX_PATCHES)) {
    for (const key of Object.keys(patch)) {
      assert.ok(FIELD_MAP[key], `${prefix} patches unknown field ${key}`);
    }
  }
});

test("RIVER 2 reports pack voltage in volts while DELTA 3 1500 reports millivolts", () => {
  const river = getFieldTable("R601ZCXXXXXXXXXX")["bms_bmsStatus.vol"];
  const delta = getFieldTable("D361ZEXXXXXXXXXX")["bms_bmsStatus.vol"];
  assert.equal(river?.scale, 1);
  assert.equal(delta?.scale, 0.001);

  const riverRaw = Number(loadQuotaFixture("r601").params["bms_bmsStatus.vol"]);
  const deltaRaw = Number(loadQuotaFixture("d361").params["bms_bmsStatus.vol"]);
  const riverVolts = riverRaw * (river?.scale ?? 0);
  const deltaVolts = deltaRaw * (delta?.scale ?? 0);
  assert.ok(riverVolts > 10 && riverVolts < 16, `RIVER 2 pack voltage should land near 13 V, got ${riverVolts}`);
  assert.ok(deltaVolts > 40 && deltaVolts < 60, `DELTA 3 1500 pack voltage should land near 55 V, got ${deltaVolts}`);
});

test("scaling follows the serial prefix rather than the editable display name", () => {
  assert.equal(getFieldTable("R601ZCXXXXXXXXXX"), getFieldTable("r601zcyyyyyyyyyy"));
  assert.equal(getFieldTable("D361ZEXXXXXXXXXX"), FIELD_MAP);
  assert.notEqual(getFieldTable("R601ZCXXXXXXXXXX"), FIELD_MAP);
});

test("the remain-time sentinel is declared so it can be filtered out", () => {
  for (const key of ["bms_emsStatus.chgRemainTime", "bms_emsStatus.dsgRemainTime"]) {
    const spec = FIELD_MAP[key];
    assert.equal(spec?.sentinel, 5939, `${key} must declare the not-applicable ceiling`);
  }
  for (const name of ["d361", "r601"]) {
    const raw = Number(loadQuotaFixture(name).params["bms_emsStatus.chgRemainTime"]);
    assert.ok(raw >= 5939, `${name} fixture should carry the sentinel, got ${raw}`);
  }
});

test("metric definitions collapse aliases into one declaration per name", () => {
  const definitions = metricDefinitions();
  const names = definitions.map((definition) => definition.name);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(definitions.find((definition) => definition.name === "ecoflow_usb_output_power_watts")?.labelNames, ["port"]);
  assert.deepEqual(definitions.find((definition) => definition.name === "ecoflow_battery_soc_percent")?.labelNames, []);
});
