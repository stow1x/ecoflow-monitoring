import test from "node:test";
import assert from "node:assert/strict";
import { describeDevices } from "../src/api/openApi.ts";
import { createOfficialSource } from "../src/sources/official.ts";
import { createFakeFetch } from "./helpers.ts";
import type { Config } from "../src/config.ts";
import type { Reading } from "../src/domain/readings.ts";

const DEVICE_LIST = [
  { sn: "D361ZEXXXXXXXXXX", deviceName: "DELTA 3 1500", online: 1 },
  { sn: "R601ZCXXXXXXXXXX", deviceName: "RIVER 2", productName: "RIVER 2", online: 0 },
];

const config: Config = {
  mode: "official",
  apiHost: "https://api-e.ecoflow.com",
  discoveryHost: "https://api-e.ecoflow.com",
  accessKey: "key",
  secretKey: "secret",
  email: null,
  password: null,
  serials: [],
  pollIntervalMs: 60_000,
  snapshotIntervalMs: 300_000,
  deviceTtlMs: 900_000,
  port: 9101,
  logLevel: "info",
  dumpRawDir: null,
};

const listAndQuota = (quota: Record<string, unknown>) =>
  createFakeFetch(({ url }) => ({ body: { code: "0", data: url.includes("device/list") ? DEVICE_LIST : quota } }));

async function collect(source: AsyncGenerator<Reading>, count: number): Promise<Reading[]> {
  const readings: Reading[] = [];
  for await (const reading of source) {
    readings.push(reading);
    if (readings.length >= count) break;
  }
  return readings;
}

test("discovery falls back from productName to deviceName to the serial prefix", () => {
  const devices = describeDevices(
    [
      { sn: "D361ZEXXXXXXXXXX", deviceName: "DELTA 3 1500", online: 1 },
      { sn: "R601ZCXXXXXXXXXX", productName: "RIVER 2", online: 0 },
      { sn: "R621ZEXXXXXXXXXX", online: 1 },
      { sn: "ZZZZZZZZ", online: 1 },
      { deviceName: "no serial at all" },
    ],
    [],
  );
  assert.deepEqual(devices.map((device) => device.model), ["DELTA 3 1500", "RIVER 2", "RIVER 2 Pro", "unknown"]);
  assert.deepEqual(devices.map((device) => device.online), [true, false, true, true]);
});

test("an explicit serial allow-list filters discovery", () => {
  assert.deepEqual(
    describeDevices(DEVICE_LIST, ["R601ZCXXXXXXXXXX"]).map((device) => device.serial),
    ["R601ZCXXXXXXXXXX"],
  );
});

test("signed headers are attached to every request", async () => {
  const fetchImpl = listAndQuota({ "pd.soc": 88 });
  const controller = new AbortController();
  await collect(createOfficialSource(config, { fetchImpl, signal: controller.signal }), 4);
  controller.abort();

  assert.match(fetchImpl.calls[0]?.url ?? "", /\/iot-open\/sign\/device\/list$/);
  assert.match(fetchImpl.calls[1]?.url ?? "", /quota\/all\?sn=D361ZEXXXXXXXXXX$/);
  for (const call of fetchImpl.calls) {
    assert.match(call.headers.sign ?? "", /^[0-9a-f]{64}$/);
    assert.match(call.headers.nonce ?? "", /^\d{6}$/);
    assert.equal(call.headers.accesskey, "key");
    assert.equal(call.method, "GET");
  }
});

test("a successful poll yields transport, devices, then one sample per device", async () => {
  const fetchImpl = listAndQuota({ "pd.soc": 88, "bms_bmsStatus.cellVol": [1, 2] });
  const controller = new AbortController();
  const readings = await collect(createOfficialSource(config, { fetchImpl, signal: controller.signal }), 4);
  controller.abort();

  assert.deepEqual(readings.map((reading) => reading.kind), ["transport", "devices", "sample", "sample"]);
  const sample = readings[2];
  assert.equal(sample?.kind, "sample");
  assert.equal(sample.values["pd.soc"], 88);
  assert.equal(sample.values["bms_bmsStatus.cellVol"], undefined);
});

test("an application-level error code becomes a reason label rather than an exception", async () => {
  const fetchImpl = createFakeFetch(({ url }) =>
    url.includes("device/list")
      ? { body: { code: "0", data: DEVICE_LIST } }
      : { body: { code: "1006", message: "current device is not allowed to get device info" } },
  );
  const controller = new AbortController();
  const readings = await collect(createOfficialSource(config, { fetchImpl, signal: controller.signal }), 4);
  controller.abort();

  const failure = readings[2];
  assert.equal(failure?.kind, "error");
  assert.equal(failure.reason, "api_1006");
  assert.equal(failure.serial, "D361ZEXXXXXXXXXX");
});

test("an HTTP failure on discovery marks the transport down", async () => {
  const fetchImpl = createFakeFetch(() => ({ status: 500, body: {} }));
  const controller = new AbortController();
  const readings = await collect(createOfficialSource(config, { fetchImpl, signal: controller.signal }), 2);
  controller.abort();

  assert.deepEqual(
    readings.map((reading) => (reading.kind === "error" || reading.kind === "transport" ? reading.reason : null)),
    ["http_500", "http_500"],
  );
  const transport = readings[1];
  assert.equal(transport?.kind, "transport");
  assert.equal(transport.state, "down");
});

test("an empty device list is reported as a failure rather than a healthy poll", async () => {
  const fetchImpl = createFakeFetch(() => ({ body: { code: "0", data: [] } }));
  const controller = new AbortController();
  const readings = await collect(createOfficialSource(config, { fetchImpl, signal: controller.signal }), 2);
  controller.abort();

  const failure = readings[0];
  assert.equal(failure?.kind, "error");
  assert.equal(failure.reason, "no_devices_discovered");
});

test("official mode refuses to start without credentials", async () => {
  await assert.rejects(
    () => collect(createOfficialSource({ ...config, accessKey: null }, {}), 1),
    /ECOFLOW_ACCESS_KEY/,
  );
});
