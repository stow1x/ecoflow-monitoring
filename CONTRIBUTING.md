# Contributing

Thanks for looking. This project monitors hardware that most contributors will not own, so the
rules below are mostly about one thing: **never publish a number you cannot prove.**

## Getting set up

```bash
pnpm install
cp .env.example .env      # fill in your credentials
pnpm run check            # typecheck + lint + tests, no credentials needed
```

There is no build step. Node 24 runs the TypeScript sources directly through type stripping, so
`node src/index.ts` is the program. `tsc --noEmit` is the type gate, not a compiler.

To run against your own stations:

```bash
node --env-file=.env src/index.ts
curl localhost:9101/metrics
```

Or the whole stack, including Prometheus and Grafana:

```bash
pnpm run docker:up      # build all three images from this tree, mount config live
pnpm run docker:down    # stop them, keeping the metric history
pnpm run docker:pull    # run the published images instead of building
```

Two things worth knowing:

- Plain `docker compose up -d` **pulls** and never builds — `compose.yaml` has no `build:`. Use
  `docker:up` (which layers `compose.build.yaml`) when you want your working tree in the image.
- `docker:up` passes `-f`, and naming files explicitly **disables Compose's automatic loading of
  `compose.override.yaml`**. If you keep a deployment-local override, invoke plain
  `docker compose up -d` instead, or pass your override as a third `-f`.

## Pull requests

**The PR title must be a [Conventional Commit](https://www.conventionalcommits.org/).** It becomes
the squashed commit message, CI validates it, a bot labels the PR from it, and release-please
derives the next version from it. Your individual commits can be as messy as you like.

```
feat: export inverter fan speed
fix(private): reconnect after the broker drops an idle session
fix!: correct the RIVER 2 pack voltage scale
docs: explain the five-minute warm-up
```

Types: `feat` `fix` `perf` `refactor` `docs` `test` `build` `ci` `chore` `revert`.

Add `!` when the change breaks somebody's existing setup. For this project that means: a metric
renamed, removed or rescaled, a label added or dropped, or an environment variable that changes
meaning. All three silently empty a dashboard or a alert, which is worse than an error.

CI runs typecheck, lint, tests, a container build, a startup smoke test, `promtool` over the alert
rules, and a parse of the dashboard JSON. Run `pnpm run check` before pushing and you will have
covered most of it.

## Adding a metric

This is the most common contribution and the one with the strictest bar.

1. Run the exporter with `DUMP_RAW_DIR=/tmp/raw`, or `pnpm run capture`, through at least one full
   snapshot cycle (~5 minutes on the private stream).
2. `curl localhost:9101/debug/unmapped` lists every payload key with no field-map entry.
3. Add an entry to `FIELD_MAP` in `src/domain/fields.ts` with the metric name, help text and scale.
4. `UPDATE_GOLDEN=1 pnpm test`, then **read the diff** in `test/golden/metrics.txt`.

A unit needs two independent confirmations: a primary source that states it, and a captured value
that could only be that unit. A cross-check against another field is the strongest evidence. For
example, `bms_bmsStatus.vol` reads `55028` on a DELTA 3 1500 whose `maxCellVol` is `3463` mV across
16 cells; 16 x 3.463 V is 55.4 V, so the raw value is millivolts. The same key reads `13` on a
RIVER 2 whose four cells total 13.2 V, so on that model it is volts. That is why the scale is
patched per serial prefix and pinned by a test against both fixtures.

If you cannot produce that evidence, the key goes into `DISPUTED_FIELDS` with the reason and a note
in `docs/open-questions.md` describing the measurement that would settle it. A field that is absent
is a smaller problem than a field that is confidently wrong.

Naming: `ecoflow_<subject>_<unit>`, always with a unit suffix (`_watts`, `_volts`, `_celsius`,
`_percent`, `_seconds`, `_amp_hours`, ...). Labels are `serial` and `model`, plus a static label
such as `port` or `module` where one metric covers several sources. Never put a firmware version,
a timestamp or an error message in a label.

## House rules

The linter enforces most of this; the rest is enforced in review.

- **No code comments.** Rename the thing or extract a well-named helper instead. Put the "why" in
  the PR description, where it is searchable and does not rot. Tool directives and license headers
  are not comments.
- **`Promise.withResolvers()`**, never `new Promise(executor)`.
- **`Record` for static string-keyed tables**, `Map` and `Set` only for runtime-mutable ones.
- **No inline casts to read a property.** `(value as { a: T }).a` invents a shape and then trusts
  it. Narrow with `in` and `typeof`, or parse once at the boundary into a named typed value.
- **No one-line wrapper functions** unless the name is a real domain concept, or three or more call
  sites need to move in lockstep.
- **No wall-clock timers in tests.** Await the actual signal: the next reading from a source, an
  event, the promise the code already exposes. A `setTimeout` in a test is either slow or flaky,
  usually both.
- **Never fabricate a metric value.** When a device goes stale its series are removed so PromQL
  sees a gap. A `0` on a dashboard must mean the device really reported `0`.

## Testing

`node --test`, no framework. Tests are driven by real captures in `fixtures/private/` with serials
scrubbed to their model prefix, and `test/golden/metrics.txt` pins the complete exposition, so any
change to a name, unit or scale shows up as a reviewable diff.

Write tests that would fail on a plausible bug: the priority order between two keys that map to the
same metric, series removal on staleness, a sentinel being dropped, an error code becoming a stable
`reason` label. Do not write tests that assert the shape of the code.

The official mode cannot be exercised against the maintainer's own hardware, because EcoFlow
answers `1006` for both of those models. It is covered by fixtures built from the documented
example payloads instead. If you own a device that the official API does serve, a capture from it
is a genuinely valuable contribution.

## Security and privacy

Never attach a full serial number, an e-mail, an access key or a password. The capture tooling
redacts secrets and masks serials to their four-character model prefix, but read the file before
you attach it. For vulnerabilities see [SECURITY.md](SECURITY.md); do not open a public issue.

## Scope

Read-only monitoring. Sending commands to a station is deliberately out of scope: the write path
needs a safety model this project does not have, and a monitoring tool that can also switch off
your fridge is a different product.
