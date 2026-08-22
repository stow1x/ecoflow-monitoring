import { EventEmitter, on } from "node:events";
import { randomUUID } from "node:crypto";
import mqtt from "mqtt";
import { createAppApiClient, type AppSession, type MqttCertificate } from "../api/appApi.ts";
import { NoDevicesError, failureReason } from "../api/errors.ts";
import { createOpenApiClient, describeDevices } from "../api/openApi.ts";
import type { FetchLike } from "../api/client.ts";
import { resolveModel, type DeviceDescriptor } from "../domain/device.ts";
import type { Reading } from "../domain/readings.ts";
import { normalizeParams } from "../domain/telemetry.ts";
import { backoffMs, sleep } from "../utils/async.ts";
import type { RawFrame } from "../utils/rawlog.ts";
import type { Config } from "../config.ts";
import type { PrivateDeps } from "./index.ts";

const SOURCE = "private" as const;

export interface MqttLike {
  on(event: "message", handler: (topic: string, payload: Buffer) => void): void;
  once(event: "connect" | "close" | "error", handler: (error?: Error) => void): void;
  removeListener(event: "connect" | "close" | "error", handler: (error?: Error) => void): void;
  removeAllListeners(event: "message"): void;
  subscribe(topic: string, options: { qos: 1 }): void;
  publish(topic: string, payload: string, options: { qos: 1 }): void;
  end(force?: boolean): void;
}

export type MqttConnectLike = (url: string, options: Record<string, unknown>) => MqttLike;

interface SessionDeps {
  fetchImpl: FetchLike | undefined;
  mqttConnect: MqttConnectLike;
  onRaw?: ((frame: RawFrame) => void) | undefined;
}

function readQuotaParams(message: unknown): unknown {
  if (message === null || typeof message !== "object") return undefined;
  if ("params" in message && message.params) return message.params;
  if (!("data" in message) || message.data === null || typeof message.data !== "object") return undefined;
  return "quotaMap" in message.data ? message.data.quotaMap : undefined;
}

function connectMqtt(certificate: MqttCertificate, userId: string, mqttConnect: MqttConnectLike): Promise<MqttLike> {
  const { promise, resolve, reject } = Promise.withResolvers<MqttLike>();
  const client = mqttConnect(`mqtts://${certificate.url}:${certificate.port}`, {
    username: certificate.certificateAccount,
    password: certificate.certificatePassword,
    clientId: `ANDROID_${randomUUID().replaceAll("-", "").toUpperCase()}_${userId}`,
    protocolVersion: 5,
    clean: true,
    reconnectPeriod: 0,
  });

  const onConnect = (): void => {
    client.removeListener("error", onError);
    resolve(client);
  };
  const onError = (error?: Error): void => {
    client.removeListener("connect", onConnect);
    client.end(true);
    reject(error ?? new Error("mqtt connection failed"));
  };
  client.once("connect", onConnect);
  client.once("error", onError);
  return promise;
}

async function discoverDevices(config: Config, fetchImpl: FetchLike | undefined): Promise<DeviceDescriptor[]> {
  if (config.accessKey && config.secretKey) {
    const client = createOpenApiClient({
      host: config.discoveryHost,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
      fetchImpl,
    });
    return describeDevices(await client.listDevices(), config.serials);
  }
  return config.serials.map((serial) => ({ serial, model: resolveModel({ serial }), online: true }));
}

function snapshotRequest(): string {
  return JSON.stringify({
    id: String(Math.floor(Math.random() * 900_000) + 100_000),
    version: "1.1",
    moduleType: 0,
    operateType: "latestQuotas",
    params: {},
  });
}

async function runSession(
  config: Config,
  { fetchImpl, mqttConnect, onRaw }: SessionDeps,
  emit: (reading: Reading) => void,
  signal: AbortSignal,
): Promise<void> {
  if (!config.email || !config.password) throw new Error("private mode requires ECOFLOW_EMAIL and ECOFLOW_PASSWORD");

  const appApi = createAppApiClient({ host: config.apiHost, fetchImpl });
  const session: AppSession = await appApi.login(config.email, config.password);
  const certificate = await appApi.certificate(session);

  const devices = await discoverDevices(config, fetchImpl);
  if (devices.length === 0) throw new NoDevicesError();
  const modelBySerial = new Map(devices.map((device) => [device.serial, device.model]));
  emit({ kind: "devices", at: Date.now(), devices });

  const client = await connectMqtt(certificate, session.userId, mqttConnect);
  const closed = Promise.withResolvers<void>();
  const stop = (): void => { closed.resolve(); };
  client.once("close", stop);
  client.once("error", stop);
  signal.addEventListener("abort", stop, { once: true });
  if (signal.aborted) stop();

  let snapshotTimer: NodeJS.Timeout | undefined;
  try {
    emit({ kind: "transport", at: Date.now(), source: SOURCE, state: "up", reason: "mqtt_connected" });

    for (const { serial } of devices) {
      client.subscribe(`/app/device/property/${serial}`, { qos: 1 });
      client.subscribe(`/app/${session.userId}/${serial}/thing/property/get_reply`, { qos: 1 });
    }

    const requestSnapshots = (): void => {
      const payload = snapshotRequest();
      for (const { serial } of devices) {
        client.publish(`/app/${session.userId}/${serial}/thing/property/get`, payload, { qos: 1 });
      }
    };
    requestSnapshots();
    snapshotTimer = setInterval(requestSnapshots, config.snapshotIntervalMs);

    client.on("message", (topic, payload) => {
      const segments = topic.split("/");
      const serial = devices.find((device) => segments.includes(device.serial))?.serial;
      if (!serial) return;
      const raw = payload.toString();
      onRaw?.({ source: SOURCE, topic, serial, payload: raw });

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        emit({ kind: "error", at: Date.now(), source: SOURCE, serial, reason: "payload_not_json" });
        return;
      }

      const params = readQuotaParams(parsed);
      if (!params) return;

      const { values } = normalizeParams(params);
      if (Object.keys(values).length === 0) return;

      emit({
        kind: "sample",
        at: Date.now(),
        serial,
        model: modelBySerial.get(serial) ?? resolveModel({ serial }),
        values,
      });
    });

    await closed.promise;
  } finally {
    clearInterval(snapshotTimer);
    signal.removeEventListener("abort", stop);
    client.removeAllListeners("message");
    client.end(true);
  }
}

export async function* createPrivateSource(
  config: Config,
  { fetchImpl, mqttConnect = mqtt.connect, signal, onRaw }: PrivateDeps = {},
): AsyncGenerator<Reading> {
  const stopper = new AbortController();
  if (signal?.aborted) stopper.abort();
  else signal?.addEventListener("abort", () => { stopper.abort(); }, { once: true });

  const emitter = new EventEmitter<{ reading: [Reading]; end: [] }>();
  emitter.setMaxListeners(0);
  const readings = on(emitter, "reading", { close: ["end"] });
  const emit = (reading: Reading): void => {
    emitter.emit("reading", reading);
  };

  const aborted = (): boolean => stopper.signal.aborted;

  const driver = (async () => {
    let failures = 0;
    while (!aborted()) {
      try {
        await runSession(config, { fetchImpl, mqttConnect, onRaw }, emit, stopper.signal);
        failures = 0;
        if (aborted()) break;
        emit({ kind: "transport", at: Date.now(), source: SOURCE, state: "down", reason: "mqtt_closed" });
      } catch (error) {
        failures += 1;
        const reason = failureReason(error);
        emit({ kind: "error", at: Date.now(), source: SOURCE, reason });
        emit({ kind: "transport", at: Date.now(), source: SOURCE, state: "down", reason });
      }
      if (aborted()) break;
      await sleep(backoffMs(failures + 1), stopper.signal);
    }
    emitter.emit("end");
  })();

  try {
    for await (const event of readings) {
      const [reading] = event as [Reading];
      yield reading;
    }
  } finally {
    stopper.abort();
    await driver;
  }
}
