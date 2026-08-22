import test from "node:test";
import assert from "node:assert/strict";
import { canonicalKey, normalizeParams } from "../src/domain/telemetry.ts";
import { coerceScalar } from "../src/utils/values.ts";
import { loadQuotaFixture } from "./helpers.ts";

test("legacy namespaces are rewritten to the canonical ones", () => {
  assert.equal(canonicalKey("bmsMaster.soc"), "bms_bmsStatus.soc");
  assert.equal(canonicalKey("ems.chgState"), "bms_emsStatus.chgState");
  assert.equal(canonicalKey("pd.soc"), "pd.soc");
  assert.equal(canonicalKey("cmsBattSoc"), "cmsBattSoc");
});

test("quoted numbers become numbers and booleans become 0 or 1", () => {
  const { values } = normalizeParams({ "bmsMaster.soc": "100", "pd.acEnabled": true, "pd.carState": false });
  assert.deepEqual(values, { "bms_bmsStatus.soc": 100, "pd.acEnabled": 1, "pd.carState": 0 });
});

test("arrays, objects, empty strings and non-numeric strings are rejected as non-scalar", () => {
  const { values, nonScalar } = normalizeParams({
    "bms_bmsStatus.cellVol": [3425, 3445],
    "bms_kitInfo.watts": [{ w: 1 }],
    "pd.blank": "",
    "pd.text": "not a number",
    "pd.soc": 88,
  });
  assert.deepEqual(values, { "pd.soc": 88 });
  assert.deepEqual(nonScalar.sort(), ["bms_bmsStatus.cellVol", "bms_kitInfo.watts", "pd.blank", "pd.text"]);
});

test("infinities, NaN and nullish values are rejected", () => {
  assert.equal(coerceScalar(Number.POSITIVE_INFINITY), null);
  assert.equal(coerceScalar(Number.NaN), null);
  assert.equal(coerceScalar(null), null);
  assert.equal(coerceScalar(undefined), null);
});

test("a missing or non-object payload yields nothing rather than throwing", () => {
  assert.deepEqual(normalizeParams(undefined), { values: {}, nonScalar: [] });
  assert.deepEqual(normalizeParams("nope"), { values: {}, nonScalar: [] });
  assert.deepEqual(normalizeParams(null), { values: {}, nonScalar: [] });
});

test("captured payloads normalise without losing scalar fields", () => {
  for (const name of ["d361", "r601"]) {
    const fixture = loadQuotaFixture(name);
    const { values, nonScalar } = normalizeParams(fixture.params);
    assert.equal(Object.keys(values).length + nonScalar.length, Object.keys(fixture.params).length);
    assert.ok(Object.keys(values).length > 100, `${name} should normalise more than 100 scalar fields`);
  }
});
