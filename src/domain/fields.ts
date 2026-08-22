import { serialPrefix } from "./device.ts";

export interface FieldSpec {
  metric: string;
  help: string;
  scale: number;
  priority: number;
  labels: Record<string, string> | null;
  sentinel: number | null;
}

export interface MetricDefinition {
  name: string;
  help: string;
  labelNames: string[];
}

const MILLI = 0.001;
const MINUTES_TO_SECONDS = 60;
const IDENTITY = 1;

interface FieldOptions {
  scale?: number;
  priority?: number;
  labels?: Record<string, string>;
  sentinel?: number;
}

const field = (metric: string, help: string, options: FieldOptions = {}): FieldSpec => ({
  metric,
  help,
  scale: options.scale ?? IDENTITY,
  priority: options.priority ?? 0,
  labels: options.labels ?? null,
  sentinel: options.sentinel ?? null,
});

const REMAIN_TIME_SENTINEL_MINUTES = 5939;

const SOC_HELP = "Battery state of charge in percent.";
const SOH_HELP = "Battery state of health in percent.";
const CYCLES_HELP = "Battery charge cycles counted by the BMS.";
const IN_POWER_HELP = "Total input power across all ports in watts.";
const OUT_POWER_HELP = "Total output power across all ports in watts.";
const PORT_TEMP_HELP = "Port temperature in degrees Celsius.";
const USB_POWER_HELP = "USB port output power in watts.";
const AC_SWITCH_HELP = "AC output switch state, 1 when enabled.";
const ERROR_HELP =
  "Raw error or fault code reported by a device module. Zero means the module reports nothing; a non-zero value is the device's own code, and some modules report a constant non-zero value even when healthy.";
const CHARGED_HELP = "Lifetime energy charged, in watt-hours, as counted by the device.";
const DISCHARGED_HELP = "Lifetime energy discharged, in watt-hours, as counted by the device.";

export const FIELD_MAP: Record<string, FieldSpec> = {
  "bms_emsStatus.f32LcdShowSoc": field("ecoflow_battery_soc_percent", SOC_HELP, { priority: 40 }),
  "bms_emsStatus.lcdShowSoc": field("ecoflow_battery_soc_percent", SOC_HELP, { priority: 30 }),
  "bms_bmsStatus.f32ShowSoc": field("ecoflow_battery_soc_percent", SOC_HELP, { priority: 20 }),
  "pd.soc": field("ecoflow_battery_soc_percent", SOC_HELP, { priority: 10 }),
  "bms_bmsStatus.soc": field("ecoflow_battery_soc_percent", SOC_HELP, { priority: 5 }),

  "bms_bmsStatus.soh": field("ecoflow_battery_soh_percent", SOH_HELP, { priority: 10 }),
  "bms_bmsInfo.soh": field("ecoflow_battery_soh_percent", SOH_HELP, { priority: 5 }),
  "bms_bmsStatus.cycles": field("ecoflow_battery_cycles", CYCLES_HELP, { priority: 10 }),
  "bms_bmsInfo.bsmCycles": field("ecoflow_battery_cycles", CYCLES_HELP, { priority: 5 }),
  "bms_bmsStatus.temp": field("ecoflow_battery_temperature_celsius", "Battery pack temperature in degrees Celsius."),
  "bms_bmsStatus.minCellTemp": field("ecoflow_battery_cell_temperature_min_celsius", "Coldest battery cell temperature in degrees Celsius."),
  "bms_bmsStatus.maxCellTemp": field("ecoflow_battery_cell_temperature_max_celsius", "Hottest battery cell temperature in degrees Celsius."),
  "bms_bmsStatus.minMosTemp": field("ecoflow_battery_mos_temperature_min_celsius", "Coldest BMS MOSFET temperature in degrees Celsius."),
  "bms_bmsStatus.maxMosTemp": field("ecoflow_battery_mos_temperature_max_celsius", "Hottest BMS MOSFET temperature in degrees Celsius."),

  "bms_bmsStatus.vol": field("ecoflow_battery_voltage_volts", "Battery pack voltage in volts.", { scale: MILLI }),
  "bms_bmsStatus.amp": field("ecoflow_battery_current_amperes", "Battery pack current in amperes, positive while charging.", { scale: MILLI }),
  "bms_bmsStatus.minCellVol": field("ecoflow_battery_cell_voltage_min_volts", "Lowest battery cell voltage in volts.", { scale: MILLI }),
  "bms_bmsStatus.maxCellVol": field("ecoflow_battery_cell_voltage_max_volts", "Highest battery cell voltage in volts.", { scale: MILLI }),
  "bms_bmsStatus.maxVolDiff": field("ecoflow_battery_cell_voltage_spread_volts", "Difference between the highest and lowest battery cell voltage in volts.", { scale: MILLI }),

  "bms_bmsStatus.designCap": field("ecoflow_battery_design_capacity_amp_hours", "Battery design capacity in ampere-hours.", { scale: MILLI }),
  "bms_bmsStatus.fullCap": field("ecoflow_battery_full_capacity_amp_hours", "Battery full-charge capacity in ampere-hours.", { scale: MILLI }),
  "bms_bmsStatus.remainCap": field("ecoflow_battery_remaining_capacity_amp_hours", "Battery remaining capacity in ampere-hours.", { scale: MILLI }),

  "bms_emsStatus.maxChargeSoc": field("ecoflow_battery_charge_limit_percent", "Configured upper charge limit in percent."),
  "bms_emsStatus.minDsgSoc": field("ecoflow_battery_discharge_limit_percent", "Configured lower discharge limit in percent."),
  "pd.bpPowerSoc": field("ecoflow_battery_backup_reserve_percent", "Configured backup reserve level in percent."),
  "pd.watchIsConfig": field("ecoflow_battery_backup_reserve_enabled", "Backup reserve switch state, 1 when enabled."),
  "bms_emsStatus.chgLinePlug": field("ecoflow_ac_cable_connected", "1 when the charging cable is detected as plugged in."),
  "bms_emsStatus.chgRemainTime": field("ecoflow_battery_time_to_full_seconds", "Estimated time until the battery is full, in seconds.", { scale: MINUTES_TO_SECONDS, sentinel: REMAIN_TIME_SENTINEL_MINUTES }),
  "bms_emsStatus.dsgRemainTime": field("ecoflow_battery_time_to_empty_seconds", "Estimated time until the battery is empty, in seconds.", { scale: MINUTES_TO_SECONDS, sentinel: REMAIN_TIME_SENTINEL_MINUTES }),

  "pd.wattsInSum": field("ecoflow_input_power_watts", IN_POWER_HELP, { priority: 20 }),
  "pd.inputWatts": field("ecoflow_input_power_watts", IN_POWER_HELP, { priority: 10 }),
  "pd.inWatts": field("ecoflow_input_power_watts", IN_POWER_HELP, { priority: 5 }),
  "pd.wattsOutSum": field("ecoflow_output_power_watts", OUT_POWER_HELP, { priority: 20 }),
  "pd.outputWatts": field("ecoflow_output_power_watts", OUT_POWER_HELP, { priority: 10 }),
  "pd.outWatts": field("ecoflow_output_power_watts", OUT_POWER_HELP, { priority: 5 }),

  "inv.inputWatts": field("ecoflow_ac_input_power_watts", "AC input power in watts."),
  "inv.outputWatts": field("ecoflow_ac_output_power_watts", "AC output power in watts."),
  "inv.acInVol": field("ecoflow_ac_input_voltage_volts", "AC input voltage in volts.", { scale: MILLI }),
  "inv.acInAmp": field("ecoflow_ac_input_current_amperes", "AC input current in amperes.", { scale: MILLI }),
  "inv.acInFreq": field("ecoflow_ac_input_frequency_hertz", "AC input frequency in hertz."),
  "inv.invOutVol": field("ecoflow_ac_output_voltage_volts", "AC output voltage in volts.", { scale: MILLI }),
  "inv.invOutAmp": field("ecoflow_ac_output_current_amperes", "AC output current in amperes.", { scale: MILLI }),
  "inv.invOutFreq": field("ecoflow_ac_output_frequency_hertz", "AC output frequency in hertz."),
  "inv.outTemp": field("ecoflow_inverter_temperature_celsius", "Inverter temperature in degrees Celsius."),
  "inv.dcInVol": field("ecoflow_dc_input_voltage_volts", "DC input voltage in volts.", { scale: MILLI }),
  "inv.dcInAmp": field("ecoflow_dc_input_current_amperes", "DC input current in amperes.", { scale: MILLI }),
  "inv.dcInTemp": field("ecoflow_port_temperature_celsius", PORT_TEMP_HELP, { labels: { port: "dc_in" } }),

  "mppt.inWatts": field("ecoflow_solar_input_power_watts", "Solar or DC input power in watts."),
  "mppt.inVol": field("ecoflow_solar_input_voltage_volts", "Solar or DC input voltage in volts.", { scale: MILLI }),
  "mppt.inAmp": field("ecoflow_solar_input_current_amperes", "Solar or DC input current in amperes.", { scale: MILLI }),
  "mppt.mpptTemp": field("ecoflow_port_temperature_celsius", PORT_TEMP_HELP, { labels: { port: "mppt" } }),
  "mppt.outVol": field("ecoflow_mppt_output_voltage_volts", "MPPT stage output voltage in volts.", { scale: MILLI }),
  "mppt.outAmp": field("ecoflow_mppt_output_current_amperes", "MPPT stage output current in amperes.", { scale: MILLI }),

  "pd.carWatts": field("ecoflow_dc_output_power_watts", "12 V car-port output power in watts."),
  "mppt.carOutVol": field("ecoflow_dc_output_voltage_volts", "12 V car-port output voltage in volts.", { scale: MILLI }),
  "mppt.carOutAmp": field("ecoflow_dc_output_current_amperes", "12 V car-port output current in amperes.", { scale: MILLI }),
  "pd.carTemp": field("ecoflow_port_temperature_celsius", PORT_TEMP_HELP, { labels: { port: "car" } }),
  "mppt.carTemp": field("ecoflow_port_temperature_celsius", PORT_TEMP_HELP, { labels: { port: "car_mppt" } }),

  "pd.usb1Watts": field("ecoflow_usb_output_power_watts", USB_POWER_HELP, { labels: { port: "usb1" } }),
  "pd.usb2Watts": field("ecoflow_usb_output_power_watts", USB_POWER_HELP, { labels: { port: "usb2" } }),
  "pd.qcUsb1Watts": field("ecoflow_usb_output_power_watts", USB_POWER_HELP, { labels: { port: "qcusb1" } }),
  "pd.qcUsb2Watts": field("ecoflow_usb_output_power_watts", USB_POWER_HELP, { labels: { port: "qcusb2" } }),
  "pd.typec1Watts": field("ecoflow_usb_output_power_watts", USB_POWER_HELP, { labels: { port: "typec1" } }),
  "pd.typec2Watts": field("ecoflow_usb_output_power_watts", USB_POWER_HELP, { labels: { port: "typec2" } }),
  "pd.typecChaWatts": field("ecoflow_usb_input_power_watts", "USB-C input power in watts."),
  "pd.typec1Temp": field("ecoflow_port_temperature_celsius", PORT_TEMP_HELP, { labels: { port: "typec1" } }),
  "pd.typec2Temp": field("ecoflow_port_temperature_celsius", PORT_TEMP_HELP, { labels: { port: "typec2" } }),

  "pd.acEnabled": field("ecoflow_ac_output_enabled", AC_SWITCH_HELP, { priority: 20 }),
  "mppt.cfgAcEnabled": field("ecoflow_ac_output_enabled", AC_SWITCH_HELP, { priority: 10 }),
  "inv.cfgAcEnabled": field("ecoflow_ac_output_enabled", AC_SWITCH_HELP, { priority: 5 }),
  "pd.carState": field("ecoflow_dc_output_enabled", "12 V car-port switch state, 1 when enabled."),
  "pd.dcOutState": field("ecoflow_usb_output_enabled", "USB output switch state, 1 when enabled."),
  "mppt.cfgAcXboost": field("ecoflow_xboost_enabled", "X-Boost switch state, 1 when enabled."),
  "mppt.beepState": field("ecoflow_beeper_enabled", "Beeper switch state, 1 when enabled."),
  "bms_emsStatus.openUpsFlag": field("ecoflow_ups_mode_enabled", "UPS mode state, 1 when enabled."),
  "bms_emsStatus.fanLevel": field("ecoflow_fan_level", "Cooling fan level reported by the EMS."),

  "mppt.cfgChgWatts": field("ecoflow_ac_charge_power_setpoint_watts", "Configured maximum AC charging power in watts."),
  "mppt.dcChgCurrent": field("ecoflow_dc_charge_current_setpoint_amperes", "Configured maximum DC charging current in amperes.", { scale: MILLI }),
  "mppt.cfgAcOutVol": field("ecoflow_ac_output_voltage_setpoint_volts", "Configured AC output voltage in volts."),

  "pd.chgPowerAC": field("ecoflow_energy_charged_watt_hours", CHARGED_HELP, { labels: { path: "ac" } }),
  "pd.chgPowerDC": field("ecoflow_energy_charged_watt_hours", CHARGED_HELP, { labels: { path: "dc" } }),
  "pd.chgSunPower": field("ecoflow_energy_charged_watt_hours", CHARGED_HELP, { labels: { path: "solar" } }),
  "pd.dsgPowerAC": field("ecoflow_energy_discharged_watt_hours", DISCHARGED_HELP, { labels: { path: "ac" } }),
  "pd.dsgPowerDC": field("ecoflow_energy_discharged_watt_hours", DISCHARGED_HELP, { labels: { path: "dc" } }),
  "bms_bmsInfo.accuChgEnergy": field("ecoflow_battery_energy_charged_watt_hours", "Lifetime energy charged into the pack, in watt-hours, as counted by the BMS."),
  "bms_bmsInfo.accuDsgEnergy": field("ecoflow_battery_energy_discharged_watt_hours", "Lifetime energy discharged from the pack, in watt-hours, as counted by the BMS."),
  "bms_bmsInfo.ohmRes": field("ecoflow_battery_internal_resistance_milliohms", "Battery internal resistance in milliohms."),
  "bms_bmsInfo.roundTrip": field("ecoflow_battery_round_trip_efficiency_percent", "Round-trip efficiency in percent, as counted by the BMS."),
  "bms_bmsInfo.deepDsgCnt": field("ecoflow_battery_deep_discharge_events", "Number of deep-discharge events recorded by the BMS."),

  "pd.errCode": field("ecoflow_error_code", ERROR_HELP, { labels: { module: "pd" } }),
  "inv.errCode": field("ecoflow_error_code", ERROR_HELP, { labels: { module: "inverter" } }),
  "bms_bmsStatus.errCode": field("ecoflow_error_code", ERROR_HELP, { labels: { module: "bms" } }),
  "bms_bmsStatus.bmsFault": field("ecoflow_error_code", ERROR_HELP, { labels: { module: "bms_fault" } }),
  "bms_bmsStatus.allErrCode": field("ecoflow_error_code", ERROR_HELP, { labels: { module: "bms_all" } }),
  "bms_bmsStatus.allBmsFault": field("ecoflow_error_code", ERROR_HELP, { labels: { module: "bms_all_fault" } }),
  "mppt.faultCode": field("ecoflow_error_code", ERROR_HELP, { labels: { module: "mppt" } }),
  "bms_emsStatus.bmsWarState": field("ecoflow_error_code", ERROR_HELP, { labels: { module: "ems_warning" } }),
};

export const SERIAL_PREFIX_PATCHES: Record<string, Record<string, Partial<FieldSpec>>> = {
  R601: {
    "bms_bmsStatus.vol": { scale: IDENTITY },
    "bms_bmsStatus.amp": { scale: IDENTITY },
  },
};

export const DISPUTED_FIELDS: Record<string, string> = {
  "bms_bmsStatus.tagChgAmp":
    "ioBroker scales this by 0.0001 to reach amperes while the official documentation gives no unit; the captured values equalled bms_bmsStatus.designCap exactly, which fits neither reading.",
  "mppt.outWatts":
    "The official DELTA 2 documentation says the value is amplified 10 times, while ioBroker and tolwi read it as plain watts. Both devices reported 0 during capture, so neither reading could be confirmed.",
  "mppt.carOutWatts":
    "Carries the same 10x ambiguity as mppt.outWatts, and pd.carWatts already reports the same measurement unambiguously in watts.",
  "mppt.dcdc12vWatts": "Carries the same 10x ambiguity as mppt.outWatts.",
  "bms_bmsStatus.inputWatts":
    "ioBroker scales this by 0.1 while the official documentation gives no unit at all. Both devices reported 0 during capture.",
  "bms_bmsStatus.outputWatts":
    "ioBroker scales this by 0.1 while the official documentation gives no unit at all. Both devices reported 0 during capture.",
  "bms_emsStatus.chgVol":
    "Reported as millivolts on DELTA 3 1500 and as volts on RIVER 2, and it is a configured setpoint rather than a measurement.",
  "bms_emsStatus.chgAmp":
    "Its unit follows bms_emsStatus.chgVol, which differs per model, and RIVER 2 reported 0 during capture.",
  "inv.cfgAcOutFreq":
    "Read back as an enum rather than hertz, and on RIVER 2 it contradicted the measured inv.invOutFreq.",
  "inv.cfgAcOutVol":
    "Reported in millivolts on DELTA 3 1500 and as 0 on RIVER 2, while mppt.cfgAcOutVol carries the same setpoint in volts.",
  "pd.remainTime":
    "Signed minutes whose sign disagreed with the measured power flow on both devices during capture.",
  "bms_emsStatus.chgState":
    "The enum differs per model and the field is absent on DELTA 3 1500; input and output power carry the same information unambiguously.",
  "bms_emsStatus.sysChgDsgState":
    "Present only on DELTA 3 1500 and its enum is incompatible with bms_emsStatus.chgState on other models.",
};

export const IGNORED_FIELDS: Record<string, true> = {
  "pd.pdInfoFull": true,
  "pd.pdInfoIncre": true,
  "pd.pdRunIncre": true,
  "pd.bmsInfoFull": true,
  "pd.bmsInfoIncre": true,
  "pd.bmsRunIncre": true,
};

const patchedTables = new Map<string, Record<string, FieldSpec>>();

export function getFieldTable(serial: string): Record<string, FieldSpec> {
  const prefix = serialPrefix(serial);
  const patch = SERIAL_PREFIX_PATCHES[prefix];
  if (!patch) return FIELD_MAP;

  const cached = patchedTables.get(prefix);
  if (cached) return cached;

  const table: Record<string, FieldSpec> = { ...FIELD_MAP };
  for (const [key, override] of Object.entries(patch)) {
    const base = FIELD_MAP[key];
    if (base) table[key] = { ...base, ...override };
  }
  patchedTables.set(prefix, table);
  return table;
}

export function metricDefinitions(): MetricDefinition[] {
  const byName = new Map<string, MetricDefinition>();
  for (const spec of Object.values(FIELD_MAP)) {
    const labelNames = spec.labels ? Object.keys(spec.labels) : [];
    const existing = byName.get(spec.metric);
    if (!existing) {
      byName.set(spec.metric, { name: spec.metric, help: spec.help, labelNames });
      continue;
    }
    for (const label of labelNames) {
      if (!existing.labelNames.includes(label)) existing.labelNames.push(label);
    }
  }
  return [...byName.values()];
}
