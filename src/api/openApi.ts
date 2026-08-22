import { createHttpClient, type FetchLike, type KyInstance } from "./client.ts";
import { readEnvelope } from "./envelope.ts";
import { EcoflowApiError, toTransportError } from "./errors.ts";
import { buildQueryString, newNonce, newTimestamp, signRequest } from "./signing.ts";
import { resolveModel, type DeviceDescriptor } from "../domain/device.ts";
import type { QuotaValues } from "../domain/telemetry.ts";

const DEVICE_LIST_PATH = "/iot-open/sign/device/list";
const QUOTA_ALL_PATH = "/iot-open/sign/device/quota/all";

export interface RawDeviceEntry {
  sn?: string;
  deviceName?: string;
  productName?: string;
  online?: number | boolean;
}

export interface OpenApiOptions {
  host: string;
  accessKey: string;
  secretKey: string;
  fetchImpl?: FetchLike | undefined;
  http?: KyInstance;
}

export interface OpenApiClient {
  listDevices(): Promise<RawDeviceEntry[]>;
  quotaAll(serial: string): Promise<QuotaValues>;
}

export function describeDevices(rawList: RawDeviceEntry[], allowedSerials: string[]): DeviceDescriptor[] {
  const allowed = allowedSerials.length > 0 ? new Set(allowedSerials) : null;
  const described: DeviceDescriptor[] = [];

  for (const entry of rawList) {
    const serial = entry.sn;
    if (!serial) continue;
    if (allowed && !allowed.has(serial.toUpperCase())) continue;
    described.push({
      serial,
      model: resolveModel({ productName: entry.productName, deviceName: entry.deviceName, serial }),
      online: entry.online === 1 || entry.online === true,
    });
  }
  return described;
}

export function createOpenApiClient({ host, accessKey, secretKey, fetchImpl, http }: OpenApiOptions): OpenApiClient {
  const base = host.replace(/\/+$/, "");
  const client = http ?? createHttpClient({ fetchImpl });

  async function request(path: string, params?: Record<string, unknown>): Promise<unknown> {
    const signed = signRequest(params, {
      accessKey,
      secretKey,
      nonce: newNonce(),
      timestamp: newTimestamp(),
    });
    const query = buildQueryString(params);

    let payload: unknown;
    try {
      payload = await client
        .get(`${base}${path}${query ? `?${query}` : ""}`, {
          headers: {
            accessKey: signed.accessKey,
            nonce: signed.nonce,
            timestamp: signed.timestamp,
            sign: signed.sign,
          },
        })
        .json();
    } catch (error) {
      throw toTransportError(error);
    }

    const envelope = readEnvelope(payload);
    if (String(envelope.code) !== "0") {
      throw new EcoflowApiError(envelope.code, envelope.message, envelope.traceId);
    }
    return envelope.data;
  }

  return {
    async listDevices() {
      const data: unknown = await request(DEVICE_LIST_PATH);
      if (!Array.isArray(data)) return [];
      const entries: unknown[] = data;
      return entries.filter((entry): entry is RawDeviceEntry => entry !== null && typeof entry === "object");
    },
    async quotaAll(serial) {
      const data = await request(QUOTA_ALL_PATH, { sn: serial });
      return data !== null && typeof data === "object" ? Object.fromEntries(Object.entries(data)) : {};
    },
  };
}
