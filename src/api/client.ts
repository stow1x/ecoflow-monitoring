import ky, { type KyInstance } from "ky";

export type FetchLike = typeof fetch;

export interface HttpClientOptions {
  fetchImpl?: FetchLike | undefined;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export function createHttpClient({ fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS }: HttpClientOptions = {}): KyInstance {
  return ky.create({
    retry: 0,
    timeout: timeoutMs,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}

export type { KyInstance };
