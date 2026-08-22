import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createMetrics } from "../src/metrics/registry.ts";
import { createStore } from "../src/metrics/store.ts";
import { normalizeParams } from "../src/domain/telemetry.ts";
import { loadQuotaFixture } from "./helpers.ts";
import type { DeviceDescriptor } from "../src/domain/device.ts";

const GOLDEN_PATH = fileURLToPath(new URL("./golden/metrics.txt", import.meta.url));
const FROZEN_AT = 1_700_000_000_000;

const DEVICES: readonly (readonly [string, DeviceDescriptor])[] = [
  ["d361", { serial: "D361ZEXXXXXXXXXX", model: "DELTA 3 1500", online: true }],
  ["r601", { serial: "R601ZCXXXXXXXXXX", model: "RIVER 2", online: true }],
];

async function renderExposition(): Promise<string> {
  const metrics = createMetrics({ version: "0.0.0-golden", mode: "private" });
  const store = createStore(metrics, { deviceTtlMs: 900_000, clock: { now: () => FROZEN_AT } });

  store.apply({ kind: "transport", at: FROZEN_AT, source: "private", state: "up", reason: "mqtt_connected" });
  store.apply({ kind: "devices", at: FROZEN_AT, devices: DEVICES.map(([, device]) => device) });
  for (const [fixture, device] of DEVICES) {
    const { values } = normalizeParams(loadQuotaFixture(fixture).params);
    store.apply({ kind: "sample", at: FROZEN_AT, serial: device.serial, model: device.model, values });
  }

  const exposition = await metrics.registry.metrics();
  return exposition
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.includes("ecoflow_exporter_"))
    .join("\n");
}

test("the exposition rendered from the captured fixtures matches the golden file", async () => {
  const rendered = await renderExposition();

  if (process.env.UPDATE_GOLDEN === "1" || !existsSync(GOLDEN_PATH)) {
    writeFileSync(GOLDEN_PATH, `${rendered}\n`);
  }

  assert.equal(
    rendered,
    readFileSync(GOLDEN_PATH, "utf8").trimEnd(),
    "exposition drifted from test/golden/metrics.txt; rerun with UPDATE_GOLDEN=1 and review the diff",
  );
});

test("the golden exposition covers both devices and stays free of unmapped keys", async () => {
  const rendered = await renderExposition();
  assert.match(rendered, /ecoflow_battery_soc_percent\{serial="D361ZEXXXXXXXXXX",model="DELTA 3 1500"\} 100\n/);
  assert.match(rendered, /ecoflow_battery_soc_percent\{serial="R601ZCXXXXXXXXXX",model="RIVER 2"\} 88\.5\n/);
  assert.doesNotMatch(rendered, /sysVer|packSn|hwVersion|pdInfoFull/);
});
