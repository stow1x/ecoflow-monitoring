import test from "node:test";
import assert from "node:assert/strict";
import { createAppApiClient } from "../src/api/appApi.ts";
import { createFakeFetch } from "./helpers.ts";

const LOGIN = { code: "0", data: { token: "tok", user: { userId: "42", name: "tester" } } };
const CERT = {
  code: "0",
  data: {
    certificateAccount: "app-account",
    certificatePassword: "app-password",
    url: "mqtt-e.ecoflow.com",
    port: "8883",
    protocol: "mqtts",
  },
};

const HOST = "https://api.ecoflow.com";

test("login base64-encodes the password and never sends it in clear text", async () => {
  const fetchImpl = createFakeFetch(() => ({ body: LOGIN }));
  const session = await createAppApiClient({ host: HOST, fetchImpl }).login("someone@example.com", "pw-placeholder");

  assert.deepEqual(session, { token: "tok", userId: "42" });
  const call = fetchImpl.calls[0];
  assert.equal(call?.method, "POST");
  assert.match(call?.url ?? "", /\/auth\/login$/);
  assert.equal(call?.headers.lang, "en_US");
  assert.match(call?.headers["content-type"] ?? "", /application\/json/);

  const body = JSON.parse(call?.body ?? "{}");
  assert.equal(body.password, Buffer.from("pw-placeholder").toString("base64"));
  assert.equal(body.scene, "IOT_APP");
  assert.equal(body.userType, "ECOFLOW");
  assert.doesNotMatch(call?.body ?? "", /pw-placeholder/);
});

test("login rejects with a stable reason on a non-zero code", async () => {
  const fetchImpl = createFakeFetch(() => ({ body: { code: "7005", message: "wrong password" } }));
  await assert.rejects(
    () => createAppApiClient({ host: HOST, fetchImpl }).login("a@b.c", "x"),
    (error: unknown) => error instanceof Error && "reason" in error && error.reason === "login_7005",
  );
});

test("login rejects when the envelope claims success but carries no session", async () => {
  const fetchImpl = createFakeFetch(() => ({ body: { code: "0", data: { token: "tok" } } }));
  await assert.rejects(() => createAppApiClient({ host: HOST, fetchImpl }).login("a@b.c", "x"));
});

test("an HTTP failure is surfaced with a transport reason", async () => {
  const fetchImpl = createFakeFetch(() => ({ status: 502, body: {} }));
  await assert.rejects(
    () => createAppApiClient({ host: HOST, fetchImpl }).login("a@b.c", "x"),
    (error: unknown) => error instanceof Error && "reason" in error && error.reason === "http_502",
  );
});

test("certification sends the bearer token and returns broker details", async () => {
  const fetchImpl = createFakeFetch(() => ({ body: CERT }));
  const certificate = await createAppApiClient({ host: HOST, fetchImpl }).certificate({ token: "tok", userId: "42" });

  const call = fetchImpl.calls[0];
  assert.match(call?.url ?? "", /\/iot-auth\/app\/certification\?userId=42$/);
  assert.equal(call?.headers.authorization, "Bearer tok");
  assert.equal(certificate.url, "mqtt-e.ecoflow.com");
  assert.equal(certificate.port, "8883");
});

test("certification rejects when required broker fields are missing", async () => {
  const fetchImpl = createFakeFetch(() => ({ body: { code: "0", data: { url: "mqtt-e.ecoflow.com" } } }));
  await assert.rejects(
    () => createAppApiClient({ host: HOST, fetchImpl }).certificate({ token: "tok", userId: "42" }),
    (error: unknown) => error instanceof Error && "reason" in error && error.reason === "certification_0",
  );
});
