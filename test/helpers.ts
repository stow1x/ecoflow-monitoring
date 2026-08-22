import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { MqttLike } from "../src/sources/private.ts";

const root = fileURLToPath(new URL("../", import.meta.url));

export interface QuotaFixture {
  _capture: { source: string; topic: string; note: string };
  params: Record<string, unknown>;
}

export interface StreamFrame {
  topic: string;
  payload: string;
}

export function loadQuotaFixture(name: string): QuotaFixture {
  return JSON.parse(readFileSync(`${root}fixtures/private/${name}-quota.json`, "utf8"));
}

export function loadStreamFixture(name: string): StreamFrame[] {
  return readFileSync(`${root}fixtures/private/${name}-stream.ndjson`, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

export interface RecordedCall {
  url: string;
  method: string;
  body: string;
  headers: Record<string, string>;
}

export interface FakeResponse {
  status?: number;
  body: unknown;
}

export interface FakeFetch {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>;
  calls: RecordedCall[];
}

export function createFakeFetch(route: (call: RecordedCall) => FakeResponse): FakeFetch {
  const calls: RecordedCall[] = [];

  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const body = request.method === "GET" || request.method === "HEAD" ? "" : await request.text();

    const call: RecordedCall = { url: request.url, method: request.method, body, headers };
    calls.push(call);

    const { status = 200, body: payload } = route(call);
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  };

  return Object.assign(impl, { calls });
}

export interface FakeMqttClient extends MqttLike {
  subscriptions: string[];
  published: { topic: string; payload: string }[];
  ended: boolean;
  emit(event: string, ...args: unknown[]): void;
}

export interface FakeMqttConnect {
  (url: string, options: Record<string, unknown>): MqttLike;
  clients: FakeMqttClient[];
  urls: string[];
  options: Record<string, unknown>[];
}

export function createFakeMqtt(): FakeMqttConnect {
  const clients: FakeMqttClient[] = [];
  const urls: string[] = [];
  const options: Record<string, unknown>[] = [];

  const connect = (url: string, connectOptions: Record<string, unknown>): MqttLike => {
    urls.push(url);
    options.push(connectOptions);
    const listeners = new Map<string, ((...args: never[]) => void)[]>();

    const add = (event: string, handler: (...args: never[]) => void): void => {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
    };

    const client: FakeMqttClient = {
      subscriptions: [],
      published: [],
      ended: false,
      on: (event, handler) => { add(event, handler); },
      once: (event, handler) => { add(event, handler); },
      removeListener(event, handler) {
        listeners.set(event, (listeners.get(event) ?? []).filter((entry) => entry !== handler));
      },
      removeAllListeners(event) {
        listeners.delete(event);
      },
      subscribe(topic) {
        client.subscriptions.push(topic);
      },
      publish(topic, payload) {
        client.published.push({ topic, payload });
      },
      end() {
        client.ended = true;
      },
      emit(event, ...args) {
        for (const handler of [...(listeners.get(event) ?? [])]) {
          Reflect.apply(handler, undefined, args);
        }
      },
    };

    clients.push(client);
    queueMicrotask(() => { client.emit("connect"); });
    return client;
  };

  return Object.assign(connect, { clients, urls, options });
}
