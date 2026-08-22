import { HTTPError, TimeoutError } from "ky";

export class EcoflowApiError extends Error {
  readonly code: string;
  readonly reason: string;
  readonly traceId: string;

  constructor(code: unknown, message: unknown, traceId: unknown) {
    super(`EcoFlow API error ${String(code)}: ${String(message)}`);
    this.name = "EcoflowApiError";
    this.code = String(code);
    this.reason = `api_${String(code)}`;
    this.traceId = typeof traceId === "string" ? traceId : "";
  }
}

export class EcoflowHttpError extends Error {
  readonly reason: string;

  constructor(status: number) {
    super(`EcoFlow API returned HTTP ${status}`);
    this.name = "EcoflowHttpError";
    this.reason = `http_${status}`;
  }
}

export class EcoflowTimeoutError extends Error {
  readonly reason = "timeout";

  constructor() {
    super("EcoFlow API request timed out");
    this.name = "EcoflowTimeoutError";
  }
}

export class NoDevicesError extends Error {
  readonly reason = "no_devices_discovered";

  constructor() {
    super("No devices matched ECOFLOW_SERIALS, or the account exposes none");
    this.name = "NoDevicesError";
  }
}

export class PrivateAuthError extends Error {
  readonly reason: string;

  constructor(stage: string, code: unknown, message: unknown) {
    super(`EcoFlow app ${stage} failed (${String(code)}): ${String(message)}`);
    this.name = "PrivateAuthError";
    this.reason = `${stage}_${String(code)}`;
  }
}

export function toTransportError(error: unknown): Error {
  if (error instanceof HTTPError) return new EcoflowHttpError(error.response.status);
  if (error instanceof TimeoutError) return new EcoflowTimeoutError();
  return error instanceof Error ? error : new Error(String(error));
}

export function failureReason(error: unknown): string {
  if (error !== null && typeof error === "object" && "reason" in error && typeof error.reason === "string") {
    return error.reason;
  }
  return "request_failed";
}
