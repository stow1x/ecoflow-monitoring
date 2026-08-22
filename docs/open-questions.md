# Open questions

Quota keys whose unit or meaning could not be established with confidence. They are listed in
`DISPUTED_FIELDS` in `src/domain/fields.ts`, deliberately **not** exported, and counted as neither mapped
nor unmapped so `/debug/unmapped` stays a useful signal.

The rule for promoting one into `FIELD_MAP`: the unit must be stated by a primary source **and**
corroborated by a captured value that could only be that unit.

## Not-applicable sentinels

`bms_emsStatus.chgRemainTime` and `bms_emsStatus.dsgRemainTime` report a per-model ceiling rather
than a measurement when the estimate does not apply. The capture proves it: DELTA 3 1500 reported
`5939` for **both** directions while sitting at 100 % state of charge with the mains cable plugged
in, and RIVER 2 reported `5999` for both. Time-to-full at a full charge must be zero, and
time-to-full can never equal time-to-empty, so those numbers are placeholders.

Both fields therefore carry `sentinel: 5939` in `FIELD_MAP`, and `applySample` skips any raw value
at or above it. The consequence is deliberate: `ecoflow_battery_time_to_full_seconds` and
`_time_to_empty_seconds` are simply absent while a station is idle, and appear once it is actually
charging or discharging. A genuine estimate above 98 hours would also be dropped; publishing a
fabricated 99-hour flat line is the worse failure.

`pd.remainTime` carries the same sentinel with a sign attached (`-5939` in the same capture) and is
excluded outright.

## Scaling ambiguities

| Key | Conflict | What would settle it |
|---|---|---|
| `mppt.outWatts` | The official DELTA 2 page says the value is amplified ten times; ioBroker and tolwi read it as plain watts. | Charge from solar or the DC input and compare against `pd.wattsInSum`, which is unambiguously watts. Both stations reported 0 throughout the capture. |
| `mppt.carOutWatts` | Same tenfold ambiguity. `pd.carWatts` already carries the same measurement in watts, so nothing is lost by omitting it. | Draw a known load on the 12 V port and compare the two keys. |
| `mppt.dcdc12vWatts` | Same tenfold ambiguity. | As above. |
| `bms_bmsStatus.inputWatts` / `.outputWatts` | ioBroker scales by 0.1; the official documentation gives no unit. | Charge or discharge at a known rate and compare against `pd.wattsInSum` / `pd.wattsOutSum`. |
| `bms_bmsStatus.tagChgAmp` | ioBroker scales by 0.0001 to reach amperes. The captured values were exactly `designCap` on both stations (30000 and 20000), which fits neither reading and suggests the field is not a current at all. | Charge at a known current and watch whether the value tracks it. |
| `mppt.carOutVol` / `.carOutAmp` | The DELTA 2 page annotates these as amplified ten and one hundred times respectively; ioBroker treats them as plain mV and mA. **These are currently exported as plain mV and mA.** Both stations reported 0, so the annotation could not be tested. | Enable the 12 V output and check whether the result lands near 12.6 V; if it reads 1.26 V the annotation is right and the scale must change. |

## Per-model unit divergence

`bms_bmsStatus.vol` is **millivolts on DELTA 3 1500 and volts on RIVER 2**. This is not a guess:

- DELTA 3 1500 reported `vol = 55028` with `maxCellVol = 3463` mV over a 16-cell pack
  (16 × 3.46 V ≈ 55.4 V), so the raw value is millivolts.
- RIVER 2 reported `vol = 13` with `maxCellVol = 3293` mV over a 4-cell pack
  (4 × 3.29 V ≈ 13.2 V) and `mppt.outVol = 13239` mV. A raw value of 13 can only be volts.

`MODEL_PATCHES["RIVER 2"]` therefore overrides the scale, and `test/fields.test.ts` pins both
readings against the captured fixtures.

`bms_bmsStatus.amp` receives the same patch **by inference, not by measurement** — both stations
were idle at 0 A throughout the capture, so the unit could not be observed directly. It is
exported because a battery current that is wrong by a factor of a thousand is glaring on a
dashboard rather than silently plausible, but treat RIVER 2's value with suspicion until someone
observes it under load.

## Fields deliberately not exported for other reasons

- `bms_emsStatus.chgState` and `bms_emsStatus.sysChgDsgState` — incompatible enumerations, and
  only one of the two exists per model. `ecoflow_input_power_watts` and
  `ecoflow_output_power_watts` answer "is it charging?" unambiguously and identically on every
  model.
- `pd.remainTime` — signed minutes whose sign disagreed with the measured power flow on both
  stations during the capture. `ecoflow_battery_time_to_full_seconds` and `_time_to_empty_seconds`
  come from the EMS instead.
- `inv.cfgAcOutVol` and `inv.cfgAcOutFreq` — a millivolt setpoint on one model and `0` on the
  other, and the frequency reads back as an enum that contradicted the measured
  `inv.invOutFreq`. `mppt.cfgAcOutVol` carries the same setpoint in volts.
- `bms_emsStatus.chgVol` / `.chgAmp` — setpoints, not measurements, and their unit follows the
  same per-model divergence as `bms_bmsStatus.vol`.

## Devices blocked from the Developer API

`GET /iot-open/sign/device/quota/all` answers `1006 current device is not allowed to get device
info` for `D361` (DELTA 3 1500) and `R601` (RIVER 2), confirmed against a real account on
`api-e.ecoflow.com`. `/device/list` lists both devices, `/certification` issues MQTT credentials,
and subscribing to `/open/{account}/{sn}/quota` is authorised — but nothing is ever published to
that topic, and publishing to `.../get` is rejected with `Not authorized`. Regenerating keys does
not help; the category is closed server-side. `private` mode is the only working path for these
models today.

If EcoFlow opens them later, `official` mode already handles them: both stations speak the classic
dotted namespace, which the existing field map covers.
