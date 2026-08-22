# ecoflow-monitoring

Prometheus exporter and a ready-to-run Grafana stack for EcoFlow power stations.

[![ci](https://github.com/stow1x/ecoflow-monitoring/actions/workflows/ci.yml/badge.svg)](https://github.com/stow1x/ecoflow-monitoring/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/release/stow1x/ecoflow-monitoring?sort=semver)](https://github.com/stow1x/ecoflow-monitoring/releases)
[![image](https://img.shields.io/badge/ghcr.io-ecoflow--monitoring-blue)](https://github.com/stow1x/ecoflow-monitoring/pkgs/container/ecoflow-monitoring)
[![licence](https://img.shields.io/github/license/stow1x/ecoflow-monitoring)](LICENSE)

One container polls or streams telemetry from your stations, exposes it as curated Prometheus
metrics, and a provisioned Grafana dashboard plots it. `docker compose up` is the whole install.

Verified end to end against a **DELTA 3 1500** and a **RIVER 2** on the EU cloud.

```
docker compose up -d      # exporter + Prometheus + Grafana
open http://localhost:3000
```

## Why this exists

Most EcoFlow integrations either scrape the mobile-app API with your account password and
auto-generate metric names from raw JSON keys, or use the official Developer API and stop working
the moment EcoFlow closes a device category. This project does neither by accident:

- **Both data paths, one metric model.** Official Developer API keys and app-account credentials
  produce the same normalised readings, so the dashboard and the alerts are written once.
- **Curated metrics, not auto-derived names.** Every exported series has a hand-written `# HELP`,
  a unit suffix, and an explicit scale. A firmware change adds an unmapped key to
  `/debug/unmapped` instead of silently renaming your series.
- **Never a fabricated zero.** When a device goes stale its telemetry series are *removed*, so
  PromQL sees a gap. A `0 W` on your dashboard always means the device really reported 0 W.
- **Dashboards and alerts ship in the repo** and are provisioned automatically.

## Which mode do I need?

| | `private` (default) | `official` |
|---|---|---|
| Credentials | EcoFlow app e-mail + password | Developer AccessKey + SecretKey |
| Transport | MQTT stream | REST polling |
| Update rate | ~2 s deltas, full snapshot every ~5 min | ~15 min server-side, so polling faster buys nothing |
| Works for | every device your account can see | only device categories EcoFlow exposes to the Developer API |

**Start with `official` if you have Developer keys.** If `GET /device/quota/all` answers

```json
{"code":"1006","message":"current device is not allowed to get device info"}
```

then EcoFlow has not opened your device category to the Developer API and no amount of key
regeneration will help. That is the case today for **DELTA 3 1500 (`D361`)** and **RIVER 2
(`R601`)**, both confirmed against a real account: the devices appear in `/device/list`, the MQTT
`/open/{account}/{sn}/quota` topic accepts the subscription, and then nothing is ever published to
it. Use `private` mode for those.

`private` mode has no device-list endpoint of its own, so either list the serials explicitly or
also supply Developer keys purely for discovery:

```dotenv
ECOFLOW_MODE=private
ECOFLOW_EMAIL=you@example.com
ECOFLOW_PASSWORD=...
ECOFLOW_SERIALS=D361ZEXXXXXXXXXX,R601ZCXXXXXXXXXX
```

## Quick start

```bash
git clone https://github.com/stow1x/ecoflow-monitoring
cd ecoflow-monitoring
cp .env.example .env
$EDITOR .env
docker compose up -d
```

Grafana is on <http://localhost:3000> (`admin` / `GRAFANA_PASSWORD`), with the **EcoFlow Overview**
dashboard already provisioned. Prometheus is not published on the host; reach it through Grafana.

Running without Docker needs Node 24, which executes the TypeScript sources directly:

```bash
pnpm install
node --env-file=.env src/index.ts
curl localhost:9101/metrics
```

There is nothing to click afterwards. Filling in `.env` is the only manual step in the whole
install; see [How it works](#how-it-works) for what the three containers arrange between
themselves at startup.

## How it works

`docker compose up -d` starts three containers, and everything they need is in the repository, so
no dashboard gets imported by hand and no scrape target gets registered in a UI.

**1. The exporter authenticates and subscribes.** In `private` mode it posts your credentials to
`/auth/login`, exchanges the token for MQTT credentials at `/iot-auth/app/certification`, then
subscribes to `/app/device/property/{serial}` for every station. In `official` mode it signs each
request with HMAC-SHA256 and polls `GET /iot-open/sign/device/quota/all` on a timer instead. Both
paths produce the same normalised readings, which is why one field map, one dashboard and one set
of alerts cover both.

**2. Devices are discovered, not configured.** With AccessKey and SecretKey present the exporter
calls the signed `/device/list` and learns each serial, model name and online flag. Without them it
falls back to the serials you listed in `ECOFLOW_SERIALS` and derives the model from the serial
prefix. The app API has no device-list endpoint of its own, which is why `private` mode needs one
or the other.

**3. Readings become metrics.** Each payload key is looked up in the field map, scaled to a base
unit and written to a labelled gauge. Keys with no entry are counted and listed on
`/debug/unmapped` rather than exported under an auto-generated name. `/metrics` is a pure
in-memory read, so a scrape never waits on EcoFlow, and Prometheus' 10 s scrape timeout can never
be tripped by a slow cloud API.

**4. Prometheus scrapes on its own.** `exporter:9101` is a static target in `prometheus.yml`,
pulled every 30 s. The alert rules in `prometheus/rules/` are loaded from the same directory.

**5. Grafana provisions itself.** On startup it reads `grafana/provisioning/`, creates the
Prometheus datasource under the pinned uid `ecoflow-prometheus`, and loads every dashboard in
`grafana/dashboards/`. Deleting the Grafana volume changes nothing: it rebuilds both from the
files. Dashboards are read-only in the UI on purpose — they live in git, so edit the JSON and
Grafana picks the change up within 30 seconds without a restart.

**Freshness.** Nothing here polls a device directly. In `private` mode the station pushes partial
deltas every couple of seconds and a complete snapshot every ~300 s, so the exporter's picture
fills in over the first few minutes and then tracks changes closely. In `official` mode EcoFlow
refreshes its server-side copy roughly every 15 minutes unless the mobile app is open, so polling
faster than the default 60 s buys nothing.

**When a device goes quiet**, its telemetry series are removed and `ecoflow_device_up` drops to 0
after `DEVICE_TTL_SECONDS`. PromQL sees a gap rather than a plausible-looking stale number.

## Endpoints

| Path | Purpose |
|---|---|
| `/metrics` | Prometheus exposition. A pure in-memory read; never blocks on the EcoFlow API. |
| `/healthz` | Process is alive. Used by the container healthcheck. |
| `/readyz` | `200` only while at least one device has telemetry newer than `DEVICE_TTL_SECONDS`. |
| `/debug/unmapped` | Payload keys seen for each device that have no field-map entry. |

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `ECOFLOW_MODE` | `private` | `private` or `official` |
| `ECOFLOW_EMAIL` / `ECOFLOW_PASSWORD` | — | app account, required in `private` mode |
| `ECOFLOW_ACCESS_KEY` / `ECOFLOW_SECRET_KEY` | — | Developer keys, required in `official` mode, optional in `private` mode for discovery |
| `ECOFLOW_SERIALS` | — | comma-separated allow-list; required in `private` mode unless Developer keys are set |
| `ECOFLOW_API_HOST` | `https://api.ecoflow.com` (private), `https://api-e.ecoflow.com` (official) | regional host |
| `ECOFLOW_DISCOVERY_HOST` | `https://api-e.ecoflow.com` | host used for the signed device list |
| `POLL_INTERVAL_SECONDS` | `60` | `official` mode poll period |
| `SNAPSHOT_INTERVAL_SECONDS` | `300` | how often `private` mode asks for a full snapshot |
| `DEVICE_TTL_SECONDS` | `900` | after this much silence a device is marked down and its series dropped |
| `EXPORTER_PORT` | `9101` | listen port |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info`, `debug` |
| `DUMP_RAW_DIR` | — | write raw frames as NDJSON for diagnosis; secret-shaped fields are redacted and serials are masked to their 6-character model prefix |

Your Developer account's region decides the host. A key presented to the wrong one answers
`8513 accessKey is invalid`; `api-e` is Europe, `api-a` is the Americas.

## Metrics

Around 60 telemetry series per device, labelled `serial` and `model`, plus per-port and
per-module breakdowns:

```
ecoflow_battery_soc_percent{serial,model}
ecoflow_battery_voltage_volts / _current_amperes / _temperature_celsius
ecoflow_battery_cell_voltage_min_volts / _max_volts / _spread_volts
ecoflow_battery_soh_percent / _cycles / _design_capacity_amp_hours / _remaining_capacity_amp_hours
ecoflow_battery_time_to_full_seconds / _time_to_empty_seconds   (absent while idle, see below)
ecoflow_input_power_watts / ecoflow_output_power_watts
ecoflow_ac_input_power_watts / _voltage_volts / _current_amperes / _frequency_hertz
ecoflow_solar_input_power_watts / ecoflow_dc_output_power_watts
ecoflow_usb_output_power_watts{port="usb1|usb2|qcusb1|qcusb2|typec1|typec2"}
ecoflow_port_temperature_celsius{port="car|mppt|typec1|typec2|dc_in|car_mppt"}
ecoflow_energy_charged_watt_hours{path="ac|dc|solar"} / ecoflow_energy_discharged_watt_hours{path}
ecoflow_error_code{module="pd|inverter|bms|bms_all|mppt|ems_warning"}
```

Plus exporter health: `ecoflow_device_up`, `ecoflow_device_online`,
`ecoflow_device_last_seen_timestamp_seconds`, `ecoflow_source_up`,
`ecoflow_source_errors_total{source,reason}`, `ecoflow_frames_total`,
`ecoflow_unmapped_field_count`, `ecoflow_build_info`, and the standard `ecoflow_exporter_*`
process metrics.

`src/domain/fields.ts` is the single source of truth: one entry per EcoFlow quota key, carrying the
metric name, help text, scale and any static labels.

## Warm-up

In `private` mode the device streams **partial deltas** every couple of seconds and a full
snapshot only every ~300 s. A freshly started exporter therefore reports a growing subset of
metrics for up to five minutes. This is the device's cadence, not a bug, and it is the reason the
exporter never invents a value for a field it has not seen.

Some series are also **absent by design**. Both stations report a fixed ceiling for the runtime
estimate whenever it does not apply — 5939 minutes for the DELTA 3 1500 and 5999 for the RIVER 2,
for time-to-full and time-to-empty simultaneously, even at 100 % charge. The exporter recognises
that sentinel and publishes nothing rather than a fabricated four-day figure, so
`ecoflow_battery_time_to_full_seconds` appears only once a station is genuinely charging.
[docs/open-questions.md](docs/open-questions.md) lists every field held back this way and what
evidence would let it be exported.

## Adding a field

1. `DUMP_RAW_DIR=/tmp/raw docker compose up exporter` and let it run through a full snapshot.
   Under compose the container filesystem is read-only, so the dump must go to the `/tmp` tmpfs
   or to a bind mount you uncomment in `compose.yaml`. Copy it out with `docker compose cp`.
2. `curl localhost:9101/debug/unmapped` to see which keys are unaccounted for.
3. Add an entry to `FIELD_MAP` in `src/domain/fields.ts` with the metric name, help, and scale.
4. `UPDATE_GOLDEN=1 pnpm test`, then read the diff in `test/golden/metrics.txt` before committing.

If a key's unit cannot be established from the official documentation *and* corroborated against
real captured values, it belongs in `DISPUTED_FIELDS` with the reason, not in `FIELD_MAP`. See
[docs/open-questions.md](docs/open-questions.md).

## Development

```bash
pnpm install
pnpm run typecheck    # tsc --noEmit; there is no build step
pnpm test             # node --test, 76 tests
pnpm run capture      # record a scrubbed NDJSON trace from your own devices
```

Node 24 runs the `.ts` sources directly through type stripping, so the container ships the sources
and no compiled output. `erasableSyntaxOnly` keeps them strippable.

Tests are driven by real captures in `fixtures/private/`, taken from a DELTA 3 1500 and a RIVER 2
with the serials scrubbed, and `test/golden/metrics.txt` pins the full exposition.

## Layout

```
src/
  api/        every HTTP call to EcoFlow: ky client, request signing, response envelopes, errors
  domain/     device identity, telemetry normalisation, the field map, the Reading union
  sources/    the two data paths, both yielding the same Reading stream
  metrics/    the prom-client registry and the per-device store that owns series lifetime
  server/     /metrics, /healthz, /readyz, /debug/unmapped
  utils/      logging, backoff, scalar coercion, raw-frame dumps
  config.ts   environment into a frozen, validated Config
  index.ts    composition root
tools/        operator scripts, currently the telemetry capture
```

Types live with the domain that owns them: `DeviceDescriptor` in `domain/device.ts`, `QuotaValues`
in `domain/telemetry.ts`, `Reading` in `domain/readings.ts`, `MqttCertificate` in `api/appApi.ts`,
`Config` in `config.ts`. Nothing imports a shared grab-bag of types.

HTTP goes through [ky](https://github.com/sindresorhus/ky): one client factory in
`api/client.ts` sets the timeout and disables ky's own retries, because the sources own the
backoff. ky's `HTTPError` and `TimeoutError` are translated into this project's error taxonomy in
`api/errors.ts`, so every failure reaches Prometheus as a stable `reason` label.

## Versioning and releases

[Semantic Versioning](https://semver.org/), derived automatically from Conventional Commit titles
by [release-please](https://github.com/googleapis/release-please). Merging to `main` updates a
standing release PR; merging that PR tags the version, writes `CHANGELOG.md` and publishes the
image.

For this project the levels mean:

- **major** — a metric was renamed, removed or rescaled, or an environment variable changed
  meaning. Somebody's dashboard or alert silently stops working, which is why it is never a minor.
- **minor** — new metrics, new device coverage, new panels or alerts, with existing series
  untouched.
- **patch** — a wrong value becomes right, a crash stops happening, documentation improves.

Images are published to the GitHub Container Registry for `linux/amd64` and `linux/arm64`:

```bash
docker pull ghcr.io/stow1x/ecoflow-monitoring:1        # latest 1.x, the tag to track
docker pull ghcr.io/stow1x/ecoflow-monitoring:1.2.3    # exact release
docker pull ghcr.io/stow1x/ecoflow-monitoring:edge     # current main, unreleased
```

The running exporter reports its own version as `ecoflow_build_info{version,mode}`.

## Contributing

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md): it covers the
setup, the Conventional Commit title CI expects, and the evidence a new metric needs before it can
be exported.

The short version of the house rule: a field is only exported once its unit is confirmed both by a
primary source and by a real captured value. Everything else is recorded in
[docs/open-questions.md](docs/open-questions.md) with the measurement that would settle it. A
missing metric is a smaller problem than a confidently wrong one.

If you own a station this project does not cover yet, the
[device support issue template](.github/ISSUE_TEMPLATE/device_support.yml) walks you through
producing a scrubbed capture, which is the single most useful thing you can contribute.

See also [SECURITY.md](SECURITY.md) for how credentials are handled and how to report a
vulnerability, and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Licence

MIT.
