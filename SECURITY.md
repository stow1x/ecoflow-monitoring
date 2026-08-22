# Security policy

## Reporting a vulnerability

Report privately through
[GitHub Security Advisories](https://github.com/stow1x/ecoflow-monitoring/security/advisories/new).
Do not open a public issue.

Expect an acknowledgement within a week. This is a hobby project maintained in spare time, so a
fix may take longer; you will be told either way rather than left waiting.

## Supported versions

Only the latest release receives fixes. Older tags are kept for reproducibility, not maintenance.

## What this project holds

The exporter handles credentials that grant access to your EcoFlow account:

- `ECOFLOW_ACCESS_KEY` / `ECOFLOW_SECRET_KEY` — read access to the devices EcoFlow exposes to the
  developer API.
- `ECOFLOW_EMAIL` / `ECOFLOW_PASSWORD` — **your full account password**, used by `private` mode
  because EcoFlow provides no scoped token for the app API. It is sent base64-encoded over HTTPS to
  `api.ecoflow.com`, exactly as the mobile app does, and is never written to disk or logs.

Because that password is unscoped, prefer a dedicated EcoFlow account with the stations shared to
it over your primary account.

The exporter never sends a command to a station. It subscribes, reads and publishes one snapshot
request; there is no code path that changes device state.

## Handling of secrets

- `.env` and `.probe/` are gitignored, and `.env*` is excluded from the container image.
- The logger redacts any field named like a secret (`password`, `token`, `authorization`, `sign`,
  `accessKey`, `secretKey`, `certificatePassword`) at any nesting depth, and truncates deeper.
- Raw frame dumps redact the same fields and mask serials to their four-character model prefix.
- Metrics carry serial and model labels. Anyone who can reach `/metrics` learns which stations you
  own and their state, so do not expose port 9101 to the internet. The compose file publishes only
  Grafana; Prometheus and the exporter stay on the internal network.

## If you leaked a credential

Rotate first, investigate second. Change the EcoFlow account password in the mobile app, and
regenerate the AccessKey/SecretKey pair in the developer portal. Both take effect immediately.
