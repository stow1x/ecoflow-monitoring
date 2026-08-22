<!-- The PR title must be a Conventional Commit; it becomes the squashed commit message and
     drives the version bump. Examples:
       feat: export inverter fan speed
       fix(private): reconnect after the broker drops an idle session
       fix!: correct the RIVER 2 pack voltage scale        <- breaking, bumps major
     Allowed types: feat fix perf refactor docs test build ci chore revert -->

## What and why

<!-- The behaviour that changes, and the reason. Link the issue with "Closes #123". -->

## How it was verified

<!-- Delete the lines that do not apply. Untested claims are the one thing reviewers cannot check. -->

- [ ] `pnpm run check` passes (typecheck, lint, tests)
- [ ] Ran against real hardware — model and mode: <!-- e.g. RIVER 2, private -->
- [ ] `docker compose up -d --build` and the affected panel was inspected in Grafana
- [ ] `promtool check rules prometheus/rules/*.yml` (only if alert rules changed)

## Metric changes

<!-- Delete this section if no metric was added, renamed, rescaled or removed. -->

| Metric | Change | Evidence for the unit and scale |
| --- | --- | --- |
|  |  |  |

A new field needs a captured value proving its unit, not only a documentation page. If the two
disagree, or the value could not be observed, it belongs in `DISPUTED_FIELDS` with the reason.

- [ ] `UPDATE_GOLDEN=1 pnpm test` was run and the diff in `test/golden/metrics.txt` was reviewed
- [ ] Renaming or removing a series is marked as breaking (`!` in the title), because it silently
      empties somebody's dashboard

## Notes for the reviewer

<!-- Trade-offs you made, things you are unsure about, follow-ups you deliberately left out. -->
