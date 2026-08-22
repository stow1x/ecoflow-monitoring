import { NoDevicesError, failureReason } from "../api/errors.ts";
import { createOpenApiClient, describeDevices } from "../api/openApi.ts";
import type { DeviceDescriptor } from "../domain/device.ts";
import type { Reading } from "../domain/readings.ts";
import { normalizeParams } from "../domain/telemetry.ts";
import { backoffMs, sleep } from "../utils/async.ts";
import type { Config } from "../config.ts";
import type { SourceDeps } from "./index.ts";

const SOURCE = "official" as const;

export async function* createOfficialSource(
  config: Config,
  { fetchImpl, signal, onRaw }: SourceDeps = {},
): AsyncGenerator<Reading> {
  if (!config.accessKey || !config.secretKey) {
    throw new Error("official mode requires ECOFLOW_ACCESS_KEY and ECOFLOW_SECRET_KEY");
  }

  const client = createOpenApiClient({
    host: config.apiHost,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
    fetchImpl,
  });

  let failures = 0;

  while (!signal?.aborted) {
    let devices: DeviceDescriptor[];
    try {
      const rawList = await client.listDevices();
      onRaw?.({ source: SOURCE, endpoint: "device/list", payload: rawList });
      devices = describeDevices(rawList, config.serials);
      if (devices.length === 0) throw new NoDevicesError();
      failures = 0;
      yield { kind: "transport", at: Date.now(), source: SOURCE, state: "up", reason: "device_list_ok" };
      yield { kind: "devices", at: Date.now(), devices };
    } catch (error) {
      failures += 1;
      const reason = failureReason(error);
      yield { kind: "error", at: Date.now(), source: SOURCE, reason };
      yield { kind: "transport", at: Date.now(), source: SOURCE, state: "down", reason };
      await sleep(backoffMs(failures), signal);
      continue;
    }

    for (const device of devices) {
      if (signal?.aborted) break;
      try {
        const quota = await client.quotaAll(device.serial);
        onRaw?.({ source: SOURCE, endpoint: "device/quota/all", serial: device.serial, payload: quota });
        const { values } = normalizeParams(quota);
        yield { kind: "sample", at: Date.now(), serial: device.serial, model: device.model, values };
      } catch (error) {
        yield {
          kind: "error",
          at: Date.now(),
          source: SOURCE,
          serial: device.serial,
          reason: failureReason(error),
        };
      }
    }

    await sleep(config.pollIntervalMs, signal);
  }
}
