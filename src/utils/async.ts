export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  if (signal?.aborted) {
    resolve();
    return promise;
  }
  const finish = (): void => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", finish);
    resolve();
  };
  const timer = setTimeout(finish, ms);
  signal?.addEventListener("abort", finish, { once: true });
  return promise;
}

const BACKOFF_BASE_MS = 1000;
const BACKOFF_CEILING_MS = 300_000;

export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const exponential = Math.min(BACKOFF_CEILING_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(random() * exponential);
}
