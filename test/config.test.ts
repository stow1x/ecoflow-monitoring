import test from "node:test";
import assert from "node:assert/strict";
import { ConfigError, loadConfig } from "../src/config.ts";

const privateEnv = {
  ECOFLOW_MODE: "private",
  ECOFLOW_EMAIL: "someone@example.com",
  ECOFLOW_PASSWORD: "secret",
  ECOFLOW_SERIALS: "d361zexxxxxxxxxx, r601zcxxxxxxxxxx",
};

function problemsFrom(env: Record<string, string | undefined>): string[] {
  try {
    loadConfig(env);
  } catch (error) {
    assert.ok(error instanceof ConfigError, `expected a ConfigError, got ${String(error)}`);
    return error.problems;
  }
  throw new assert.AssertionError({ message: "expected loadConfig to reject this environment" });
}

test("private mode accepts an explicit serial list and upper-cases it", () => {
  const config = loadConfig(privateEnv);
  assert.equal(config.mode, "private");
  assert.deepEqual(config.serials, ["D361ZEXXXXXXXXXX", "R601ZCXXXXXXXXXX"]);
  assert.equal(config.apiHost, "https://api.ecoflow.com");
  assert.equal(config.discoveryHost, "https://api-e.ecoflow.com");
});

test("private mode accepts official keys instead of a serial list", () => {
  const config = loadConfig({
    ECOFLOW_MODE: "private",
    ECOFLOW_EMAIL: "someone@example.com",
    ECOFLOW_PASSWORD: "secret",
    ECOFLOW_ACCESS_KEY: "key",
    ECOFLOW_SECRET_KEY: "secret",
  });
  assert.deepEqual(config.serials, []);
});

test("private mode without serials or official keys explains both ways out", () => {
  const problems = problemsFrom({ ECOFLOW_MODE: "private", ECOFLOW_EMAIL: "a@b.c", ECOFLOW_PASSWORD: "x" });
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? "", /ECOFLOW_SERIALS/);
  assert.match(problems[0] ?? "", /ECOFLOW_ACCESS_KEY/);
});

test("official mode requires both keys", () => {
  const problems = problemsFrom({ ECOFLOW_MODE: "official", ECOFLOW_ACCESS_KEY: "key" });
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? "", /ECOFLOW_SECRET_KEY/);
});

test("official mode defaults to the European host", () => {
  const config = loadConfig({ ECOFLOW_MODE: "official", ECOFLOW_ACCESS_KEY: "k", ECOFLOW_SECRET_KEY: "s" });
  assert.equal(config.apiHost, "https://api-e.ecoflow.com");
});

test("every mode-independent problem is reported at once", () => {
  const problems = problemsFrom({ ECOFLOW_MODE: "sideways", EXPORTER_PORT: "0", LOG_LEVEL: "loud" });
  const reported = problems.join("\n");
  for (const variable of ["ECOFLOW_MODE", "LOG_LEVEL", "EXPORTER_PORT"]) {
    assert.match(reported, new RegExp(variable), `${variable} was not reported`);
  }
  assert.equal(problems.length, 3);
});

test("an unrecognised mode does not cascade into credential complaints", () => {
  const problems = problemsFrom({ ECOFLOW_MODE: "sideways" });
  assert.deepEqual(problems.length, 1);
  assert.match(problems[0] ?? "", /ECOFLOW_MODE/);
});

test("an empty environment reports every missing private-mode credential", () => {
  const problems = problemsFrom({});
  const reported = problems.join("\n");
  for (const variable of ["ECOFLOW_EMAIL", "ECOFLOW_PASSWORD", "ECOFLOW_SERIALS"]) {
    assert.match(reported, new RegExp(variable), `${variable} was not reported`);
  }
  assert.equal(problems.length, 3);
});

test("intervals are converted to milliseconds and bounded", () => {
  const config = loadConfig({ ...privateEnv, POLL_INTERVAL_SECONDS: "90", DEVICE_TTL_SECONDS: "120" });
  assert.equal(config.pollIntervalMs, 90_000);
  assert.equal(config.deviceTtlMs, 120_000);
  assert.match(problemsFrom({ ...privateEnv, POLL_INTERVAL_SECONDS: "1" })[0] ?? "", /POLL_INTERVAL_SECONDS/);
});

test("trailing slashes are stripped from hosts", () => {
  assert.equal(loadConfig({ ...privateEnv, ECOFLOW_API_HOST: "https://api.ecoflow.com//" }).apiHost, "https://api.ecoflow.com");
});

test("configuration is frozen", () => {
  const config = loadConfig(privateEnv);
  assert.throws(() => Object.assign(config, { mode: "official" }), TypeError);
});
