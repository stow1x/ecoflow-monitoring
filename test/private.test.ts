import test from "node:test";
import assert from "node:assert/strict";
import { createPrivateSource } from "../src/sources/private.ts";
import { createFakeFetch, createFakeMqtt, loadStreamFixture, type FakeFetch, type FakeMqttConnect } from "./helpers.ts";
import type { Config } from "../src/config.ts";
import type { Reading } from "../src/domain/readings.ts";

const LOGIN = { code: "0", data: { token: "tok", user: { userId: "42", name: "tester" } } };
const CERT = {
  code: "0",
  data: {
    certificateAccount: "app-account",
    certificatePassword: "app-password",
    url: "mqtt-e.ecoflow.com",
    port: "8883",
    protocol: "mqtts",
  },
};

const config: Config = {
  mode: "private",
  apiHost: "https://api.ecoflow.com",
  discoveryHost: "https://api-e.ecoflow.com",
  accessKey: null,
  secretKey: null,
  email: "someone@example.com",
  password: "secret",
  serials: ["D361ZEXXXXXXXXXX"],
  pollIntervalMs: 60_000,
  snapshotIntervalMs: 300_000,
  deviceTtlMs: 900_000,
  port: 9101,
  logLevel: "info",
  dumpRawDir: null,
};

const routedFetch = (): FakeFetch => createFakeFetch(({ url }) => ({ body: url.includes("/auth/login") ? LOGIN : CERT }));

interface Attached {
  next(): Promise<Reading>;
  stop(): Promise<void>;
  mqttConnect: FakeMqttConnect;
}

function attach(overrides: { fetchImpl?: FakeFetch } = {}): Attached {
  const mqttConnect = createFakeMqtt();
  const controller = new AbortController();
  const source = createPrivateSource(config, {
    fetchImpl: overrides.fetchImpl ?? routedFetch(),
    mqttConnect,
    signal: controller.signal,
  });
  const iterator = source[Symbol.asyncIterator]();

  return {
    async next() {
      const result = await iterator.next();
      assert.equal(result.done, false, "source ended before producing the expected reading");
      return result.value;
    },
    async stop() {
      controller.abort();
      await iterator.return(undefined);
    },
    mqttConnect,
  };
}

test("a connected session subscribes per device and requests a snapshot", async () => {
  const session = attach();
  const discovery = await session.next();
  const transport = await session.next();

  assert.equal(discovery.kind, "devices");
  assert.deepEqual(discovery.devices, [{ serial: "D361ZEXXXXXXXXXX", model: "DELTA 3 1500", online: true }]);
  assert.equal(transport.kind, "transport");
  assert.equal(transport.state, "up");

  assert.equal(session.mqttConnect.urls[0], "mqtts://mqtt-e.ecoflow.com:8883");
  assert.match(String(session.mqttConnect.options[0]?.clientId), /^ANDROID_[0-9A-F]{32}_42$/);

  const client = session.mqttConnect.clients[0];
  assert.deepEqual(client?.subscriptions, [
    "/app/device/property/D361ZEXXXXXXXXXX",
    "/app/42/D361ZEXXXXXXXXXX/thing/property/get_reply",
  ]);
  assert.equal(client?.published.length, 1);
  assert.match(client?.published[0]?.topic ?? "", /thing\/property\/get$/);
  assert.equal(JSON.parse(client?.published[0]?.payload ?? "{}").operateType, "latestQuotas");

  await session.stop();
});

test("captured frames become samples with canonical dotted keys", async () => {
  const session = attach();
  await session.next();
  await session.next();

  for (const frame of loadStreamFixture("d361")) {
    session.mqttConnect.clients[0]?.emit("message", "/app/device/property/D361ZEXXXXXXXXXX", Buffer.from(frame.payload));
  }

  for (let index = 0; index < 3; index += 1) {
    const reading = await session.next();
    assert.equal(reading.kind, "sample");
    assert.equal(reading.serial, "D361ZEXXXXXXXXXX");
    assert.equal(reading.model, "DELTA 3 1500");
    assert.ok(Object.keys(reading.values).length > 0);
    for (const key of Object.keys(reading.values)) assert.match(key, /^(pd|inv|mppt|bms_[A-Za-z]+)\./);
  }

  await session.stop();
});

test("frames for an unknown serial are ignored", async () => {
  const session = attach();
  await session.next();
  await session.next();

  const client = session.mqttConnect.clients[0];
  client?.emit("message", "/app/device/property/UNKNOWN0000", Buffer.from(JSON.stringify({ params: { "pd.soc": 1 } })));
  client?.emit("message", "/app/device/property/D361ZEXXXXXXXXXX", Buffer.from(JSON.stringify({ params: { "pd.soc": 42 } })));

  const reading = await session.next();
  assert.equal(reading.kind, "sample");
  assert.equal(reading.values["pd.soc"], 42);

  await session.stop();
});

test("malformed payloads become an error reading instead of crashing the stream", async () => {
  const session = attach();
  await session.next();
  await session.next();

  session.mqttConnect.clients[0]?.emit("message", "/app/device/property/D361ZEXXXXXXXXXX", Buffer.from("<html>"));

  const reading = await session.next();
  assert.equal(reading.kind, "error");
  assert.equal(reading.reason, "payload_not_json");

  await session.stop();
});

test("a failed session is reported and retried rather than throwing", async () => {
  const session = attach({ fetchImpl: createFakeFetch(() => ({ body: { code: "7005", message: "wrong password" } })) });

  const failure = await session.next();
  assert.equal(failure.kind, "error");
  assert.equal(failure.reason, "login_7005");

  const transport = await session.next();
  assert.equal(transport.kind, "transport");
  assert.equal(transport.state, "down");

  await session.stop();
});

test("the source never publishes to a control topic", async () => {
  const session = attach();
  await session.next();
  await session.next();

  for (const published of session.mqttConnect.clients[0]?.published ?? []) {
    assert.doesNotMatch(published.topic, /\/(set|quota)$/);
  }

  await session.stop();
});

test("the mqtt client is closed when the consumer stops iterating", async () => {
  const session = attach();
  await session.next();
  await session.next();
  await session.stop();

  assert.equal(session.mqttConnect.clients[0]?.ended, true);
});
