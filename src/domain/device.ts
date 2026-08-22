export interface DeviceDescriptor {
  serial: string;
  model: string;
  online: boolean;
}

export interface ModelHints {
  productName?: string | undefined;
  deviceName?: string | undefined;
  serial?: string | undefined;
}

export const UNKNOWN_MODEL = "unknown";

export const SERIAL_PREFIX_LENGTH = 4;

const SERIAL_PREFIX_MODELS: readonly (readonly [string, string])[] = [
  ["D361", "DELTA 3 1500"],
  ["D362", "DELTA 3 Plus"],
  ["D381", "DELTA 3 Max"],
  ["D351", "DELTA 3"],
  ["R601", "RIVER 2"],
  ["R611", "RIVER 2 Max"],
  ["R621", "RIVER 2 Pro"],
  ["R331", "DELTA 2"],
  ["R351", "DELTA 2 Max"],
];

export function resolveModel({ productName, deviceName, serial }: ModelHints = {}): string {
  const named = productName?.trim() || deviceName?.trim();
  if (named) return named;

  const upper = (serial ?? "").toUpperCase();
  for (const [prefix, model] of SERIAL_PREFIX_MODELS) {
    if (upper.startsWith(prefix)) return model;
  }
  return UNKNOWN_MODEL;
}

export function serialPrefix(serial: string): string {
  return serial.slice(0, SERIAL_PREFIX_LENGTH).toUpperCase();
}
