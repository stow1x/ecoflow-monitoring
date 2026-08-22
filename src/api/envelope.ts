export interface ApiEnvelope {
  code: unknown;
  message: unknown;
  data: unknown;
  traceId: unknown;
}

export function readEnvelope(value: unknown): ApiEnvelope {
  if (value === null || typeof value !== "object") {
    return { code: undefined, message: undefined, data: undefined, traceId: undefined };
  }
  return {
    code: "code" in value ? value.code : undefined,
    message: "message" in value ? value.message : undefined,
    data: "data" in value ? value.data : undefined,
    traceId: "eagleEyeTraceId" in value ? value.eagleEyeTraceId : undefined,
  };
}

