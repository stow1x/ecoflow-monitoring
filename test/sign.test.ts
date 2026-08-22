import test from "node:test";
import assert from "node:assert/strict";
import { buildQueryString, buildSignString, flattenParams, signRequest } from "../src/api/signing.ts";

const VECTOR = {
  accessKey: "Fp4SvIprYSDPXtYJidEtUAd1o",
  secretKey: "WIbFEKre0s6sLnh4ei7SPUeYnptHG6V",
  nonce: "345164",
  timestamp: "1671171709428",
};

const VECTOR_PARAMS = { sn: "123456789", params: { cmdSet: 11, id: 24, eps: 0 } };
const VECTOR_SIGN_STRING =
  "params.cmdSet=11&params.eps=0&params.id=24&sn=123456789&accessKey=Fp4SvIprYSDPXtYJidEtUAd1o&nonce=345164&timestamp=1671171709428";
const VECTOR_SIGN = "07c13b65e037faf3b153d51613638fa80003c4c38d2407379a7f52851af1473e";

test("reproduces the signature published by EcoFlow", () => {
  assert.equal(buildSignString(VECTOR_PARAMS, VECTOR), VECTOR_SIGN_STRING);
  assert.equal(signRequest(VECTOR_PARAMS, VECTOR).sign, VECTOR_SIGN);
});

test("flattens nested objects and arrays the way the specification describes", () => {
  const flat = flattenParams({
    deviceInfo: { id: 1 },
    deviceList: [{ id: 1 }, { id: 2 }],
    ids: [1, 2, 3],
    name: "demo1",
  });
  const rendered = Object.keys(flat)
    .sort()
    .map((key) => `${key}=${flat[key]}`)
    .join("&");
  assert.equal(rendered, "deviceInfo.id=1&deviceList[0].id=1&deviceList[1].id=2&ids[0]=1&ids[1]=2&ids[2]=3&name=demo1");
});

test("omits the leading separator when there are no parameters", () => {
  assert.equal(buildSignString(undefined, { accessKey: "a", nonce: "1", timestamp: "2" }), "accessKey=a&nonce=1&timestamp=2");
});

test("sorts by code unit rather than by locale", () => {
  const signString = buildSignString({ a: 1, A: 2, b: 3, B: 4 }, { accessKey: "k", nonce: "1", timestamp: "2" });
  assert.match(signString, /^A=2&B=4&a=1&b=3&/);
});

test("the signature changes when the secret changes", () => {
  const other = signRequest(VECTOR_PARAMS, { ...VECTOR, secretKey: "different" });
  assert.notEqual(other.sign, VECTOR_SIGN);
  assert.equal(other.accessKey, VECTOR.accessKey);
});

test("query string carries the same parameters that were signed", () => {
  assert.equal(buildQueryString({ sn: "D361ZEXXXXXXXXXX" }), "sn=D361ZEXXXXXXXXXX");
  assert.equal(buildQueryString(undefined), "");
});
