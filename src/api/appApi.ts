import { createHttpClient, type FetchLike, type KyInstance } from "./client.ts";
import { readEnvelope } from "./envelope.ts";
import { readStringField } from "../utils/values.ts";
import { PrivateAuthError, toTransportError } from "./errors.ts";

const LOGIN_PATH = "/auth/login";
const CERTIFICATION_PATH = "/iot-auth/app/certification";

export interface AppSession {
  token: string;
  userId: string;
}

export interface MqttCertificate {
  certificateAccount: string;
  certificatePassword: string;
  url: string;
  port: string;
  protocol: string;
}

export interface AppApiOptions {
  host: string;
  fetchImpl?: FetchLike | undefined;
  http?: KyInstance;
}

export interface AppApiClient {
  login(email: string, password: string): Promise<AppSession>;
  certificate(session: AppSession): Promise<MqttCertificate>;
}

function readSession(data: unknown): AppSession | null {
  const token = readStringField(data, "token");
  if (!token || data === null || typeof data !== "object" || !("user" in data)) return null;
  const userId = readStringField(data.user, "userId");
  return userId ? { token, userId } : null;
}

function readCertificate(data: unknown): MqttCertificate | null {
  const certificateAccount = readStringField(data, "certificateAccount");
  const certificatePassword = readStringField(data, "certificatePassword");
  const url = readStringField(data, "url");
  const port = readStringField(data, "port");
  const protocol = readStringField(data, "protocol");
  if (!certificateAccount || !certificatePassword || !url || !port) return null;
  return { certificateAccount, certificatePassword, url, port, protocol: protocol ?? "mqtts" };
}

export function createAppApiClient({ host, fetchImpl, http }: AppApiOptions): AppApiClient {
  const base = host.replace(/\/+$/, "");
  const client = http ?? createHttpClient({ fetchImpl });
  const succeeded = (code: unknown, message: unknown): boolean =>
    String(code) === "0" || (typeof message === "string" && /^success$/i.test(message));

  return {
    async login(email, password) {
      let payload: unknown;
      try {
        payload = await client
          .post(`${base}${LOGIN_PATH}`, {
            headers: { lang: "en_US" },
            json: {
              email,
              password: Buffer.from(password, "utf8").toString("base64"),
              scene: "IOT_APP",
              userType: "ECOFLOW",
            },
          })
          .json();
      } catch (error) {
        throw toTransportError(error);
      }

      const envelope = readEnvelope(payload);
      const session = succeeded(envelope.code, envelope.message) ? readSession(envelope.data) : null;
      if (!session) throw new PrivateAuthError("login", envelope.code, envelope.message);
      return session;
    },

    async certificate({ token, userId }) {
      let payload: unknown;
      try {
        payload = await client
          .get(`${base}${CERTIFICATION_PATH}?userId=${encodeURIComponent(userId)}`, {
            headers: { lang: "en_US", authorization: `Bearer ${token}` },
          })
          .json();
      } catch (error) {
        throw toTransportError(error);
      }

      const envelope = readEnvelope(payload);
      const certificate = succeeded(envelope.code, envelope.message) ? readCertificate(envelope.data) : null;
      if (!certificate) throw new PrivateAuthError("certification", envelope.code, envelope.message);
      return certificate;
    },
  };
}
