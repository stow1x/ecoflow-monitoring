import { coerceScalar } from "../utils/values.ts";

export type QuotaValues = Record<string, number>;

export interface NormalizedPayload {
  values: QuotaValues;
  nonScalar: string[];
}

const PREFIX_ALIASES: Record<string, string> = {
  bmsMaster: "bms_bmsStatus",
  bmsSlave: "bms_slave",
  ems: "bms_emsStatus",
  bmsInfo: "bms_bmsInfo",
  invStatus: "inv",
  pdStatus: "pd",
  mpptStatus: "mppt",
};

export function canonicalKey(key: string): string {
  const dot = key.indexOf(".");
  if (dot < 0) return key;
  const alias = PREFIX_ALIASES[key.slice(0, dot)];
  return alias ? `${alias}${key.slice(dot)}` : key;
}

export function normalizeParams(params: unknown): NormalizedPayload {
  const values: QuotaValues = {};
  const nonScalar: string[] = [];
  if (params === null || typeof params !== "object") return { values, nonScalar };

  for (const [rawKey, rawValue] of Object.entries(params)) {
    const scalar = coerceScalar(rawValue);
    if (scalar === null) {
      nonScalar.push(rawKey);
      continue;
    }
    values[canonicalKey(rawKey)] = scalar;
  }
  return { values, nonScalar };
}
