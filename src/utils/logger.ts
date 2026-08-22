export type LogLevel = "error" | "warn" | "info" | "debug";

export type LogFields = Record<string, unknown>;

export interface Logger {
  error(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  debug(message: string, fields?: LogFields): void;
  once(key: string, level: LogLevel, message: string, fields?: LogFields): void;
}

const SEVERITY: Record<LogLevel, number> = { error: 50, warn: 40, info: 30, debug: 20 };

const SECRET_KEYS = /^(password|secretkey|secret|token|authorization|certificatepassword|sign|accesskey)$/i;

function redact(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== "object") return value;
  if (depth > 4) return "[truncated]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SECRET_KEYS.test(key) ? "[redacted]" : redact(item, depth + 1);
  }
  return out;
}

export interface LoggerOptions {
  level?: LogLevel;
  stream?: NodeJS.WritableStream;
}

export function createLogger({ level = "info", stream = process.stdout }: LoggerOptions = {}): Logger {
  const threshold = SEVERITY[level];
  const emitted = new Set<string>();

  const write = (severity: LogLevel, message: string, fields?: LogFields): void => {
    if (SEVERITY[severity] < threshold) return;
    const redacted = redact(fields ?? {});
    const extra = redacted !== null && typeof redacted === "object" ? redacted : {};
    stream.write(`${JSON.stringify({ ts: new Date().toISOString(), level: severity, msg: message, ...extra })}\n`);
  };

  return {
    error: (message, fields) => { write("error", message, fields); },
    warn: (message, fields) => { write("warn", message, fields); },
    info: (message, fields) => { write("info", message, fields); },
    debug: (message, fields) => { write("debug", message, fields); },
    once(key, severity, message, fields) {
      if (emitted.has(key)) return;
      emitted.add(key);
      write(severity, message, fields);
    },
  };
}
