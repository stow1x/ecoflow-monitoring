import type { Config } from "../config.ts";
import type { Reading } from "../domain/readings.ts";
import type { FetchLike } from "../api/client.ts";
import type { RawFrame } from "../utils/rawlog.ts";
import { createOfficialSource } from "./official.ts";
import { createPrivateSource, type MqttConnectLike } from "./private.ts";

export interface SourceDeps {
  fetchImpl?: FetchLike | undefined;
  signal?: AbortSignal | undefined;
  onRaw?: ((frame: RawFrame) => void) | undefined;
}

export interface PrivateDeps extends SourceDeps {
  mqttConnect?: MqttConnectLike | undefined;
}

export function createSource(config: Config, deps: PrivateDeps = {}): AsyncGenerator<Reading> {
  return config.mode === "official" ? createOfficialSource(config, deps) : createPrivateSource(config, deps);
}
