import { createHmac, randomInt } from "node:crypto";

export type SignableParams = Record<string, unknown> | undefined;

export interface SignContext {
  accessKey: string;
  nonce: string;
  timestamp: string;
}

export function flattenParams(
  input: unknown,
  parentKey = "",
  accumulator: Record<string, string> = {},
): Record<string, string> {
  if (Array.isArray(input)) {
    input.forEach((item, index) => flattenParams(item, `${parentKey}[${index}]`, accumulator));
  } else if (input !== null && typeof input === "object") {
    for (const [key, nested] of Object.entries(input)) {
      flattenParams(nested, parentKey ? `${parentKey}.${key}` : key, accumulator);
    }
  } else {
    accumulator[parentKey] = String(input);
  }
  return accumulator;
}

export function buildSignString(params: SignableParams, { accessKey, nonce, timestamp }: SignContext): string {
  const flat = flattenParams(params ?? {});
  const body = Object.keys(flat)
    .sort()
    .map((key) => `${key}=${flat[key]}`)
    .join("&");
  const suffix = `accessKey=${accessKey}&nonce=${nonce}&timestamp=${timestamp}`;
  return body ? `${body}&${suffix}` : suffix;
}

export function buildQueryString(params: SignableParams): string {
  const flat = flattenParams(params ?? {});
  return Object.keys(flat)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(flat[key] ?? "")}`)
    .join("&");
}

export interface SignedHeaders {
  accessKey: string;
  nonce: string;
  timestamp: string;
  sign: string;
}

export function signRequest(
  params: SignableParams,
  { secretKey, ...context }: SignContext & { secretKey: string },
): SignedHeaders {
  return {
    ...context,
    sign: createHmac("sha256", secretKey).update(buildSignString(params, context), "utf8").digest("hex"),
  };
}

export const newNonce = (): string => String(randomInt(100_000, 1_000_000));
export const newTimestamp = (): string => String(Date.now());
