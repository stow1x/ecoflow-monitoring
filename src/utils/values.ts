export function coerceScalar(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") {
    if (value.trim() === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function readStringField(value: unknown, field: string): string | null {
  if (value === null || typeof value !== "object" || !(field in value)) return null;
  const candidate: unknown = Reflect.get(value, field);
  if (typeof candidate === "string") return candidate;
  if (typeof candidate === "number") return String(candidate);
  return null;
}
