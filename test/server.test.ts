import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createMetrics } from "../src/metrics/registry.ts";
import { createStore, type UnmappedReport } from "../src/metrics/store.ts";
import { createMetricsServer, type MetricsServerOptions } from "../src/server/index.ts";

async function withServer(options: MetricsServerOptions, run: (base: string) => Promise<void>): Promise<void> {
  const server = createMetricsServer(options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object", "server should be bound to a TCP port");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("metrics are served in the Prometheus exposition format", async () => {
  const metrics = createMetrics({ version: "9.9.9", mode: "private" });
  const store = createStore(metrics, {});
  store.apply({ kind: "devices", at: 0, devices: [{ serial: "S1", model: "RIVER 2", online: true }] });

  await withServer(
    { registry: metrics.registry, isReady: () => true, unmappedReport: () => store.unmappedReport() },
    async (base) => {
      const response = await fetch(`${base}/metrics`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "text/plain; version=0.0.4; charset=utf-8");
      assert.match(await response.text(), /# HELP ecoflow_device_up/);
    },
  );
});

test("health always answers while readiness follows telemetry freshness", async () => {
  const metrics = createMetrics({});
  let ready = false;
  await withServer({ registry: metrics.registry, isReady: () => ready, unmappedReport: () => ({}) }, async (base) => {
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
    assert.equal((await fetch(`${base}/readyz`)).status, 503);
    ready = true;
    assert.equal((await fetch(`${base}/readyz`)).status, 200);
  });
});

test("unknown paths answer 404 and the unmapped report is JSON", async () => {
  const metrics = createMetrics({});
  const report: UnmappedReport = { S1: { model: "RIVER 2", unmapped: ["pd.x"] } };
  await withServer(
    { registry: metrics.registry, isReady: () => true, unmappedReport: () => report },
    async (base) => {
      assert.equal((await fetch(`${base}/nope`)).status, 404);
      const response = await fetch(`${base}/debug/unmapped`);
      assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
      assert.deepEqual(await response.json(), report);
    },
  );
});

test("query strings do not defeat route matching", async () => {
  const metrics = createMetrics({});
  await withServer({ registry: metrics.registry, isReady: () => true, unmappedReport: () => ({}) }, async (base) => {
    assert.equal((await fetch(`${base}/metrics?collect=all`)).status, 200);
  });
});
