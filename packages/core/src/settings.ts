import { RULE_LABELS, RULE_ORDER } from './rules';
import { isTimeString } from './time';
import type { Settings } from './types';

/** 設定在資料庫裡以 key/value 存放，這些是所有的 key。 */
export const SETTING_KEYS = [
  'operations',
  'carToTruckFactor',
  'vehicleDefaults',
  'nightShift',
  'dayShift',
  'trip',
  'orderCaps',
  'rules',
] as const satisfies readonly (keyof Settings)[];

function isNonNegativeNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

function isPositiveNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/** 檢查設定內容，回傳所有錯誤訊息（空陣列表示正確）。 */
export function validateSettings(value: unknown): string[] {
  const errors: string[] = [];
  const s = value as Partial<Settings> | null;
  if (!s || typeof s !== 'object') return ['設定內容必須是物件'];

  const ops = s.operations;
  if (!ops) errors.push('缺少作業時間設定');
  else {
    if (!isNonNegativeNumber(ops.loadMinutes)) errors.push('灌油時間必須是 0 以上的數字');
    if (!isNonNegativeNumber(ops.unloadMinutesPerStop)) errors.push('卸油時間必須是 0 以上的數字');
    if (!isNonNegativeNumber(ops.preTripMinutes)) errors.push('出車前檢查時間必須是 0 以上的數字');
  }
  if (!isPositiveNumber(s.carToTruckFactor)) errors.push('油罐車倍數必須大於 0');
  const comps = s.vehicleDefaults?.compartmentsKL;
  if (!Array.isArray(comps) || comps.length === 0 || !comps.every(isPositiveNumber)) {
    errors.push('預設艙位容量必須是大於 0 的數字清單');
  }
  if (!s.nightShift || !isTimeString(s.nightShift.startTime) || !s.nightShift.loadingId) {
    errors.push('大夜班需要出車時間（HH:MM）與灌油點');
  }
  if (!s.dayShift || !isTimeString(s.dayShift.defaultStartTime)) errors.push('日班預設出車時間格式應為 HH:MM');
  if (!s.trip || !Number.isInteger(s.trip.maxStopsPerTrip) || s.trip.maxStopsPerTrip < 1) {
    errors.push('每趟最多站數必須是 1 以上的整數');
  }
  if (!Array.isArray(s.orderCaps)) errors.push('單數上限必須是清單');
  else {
    for (const cap of s.orderCaps) {
      if (!cap.depotId) errors.push('單數上限缺少出發廠');
      if (cap.scope !== 'perDriver' && cap.scope !== 'depotTotal') errors.push('單數上限的計算方式必須是「每位司機」或「全廠合計」');
      if (!Number.isInteger(cap.maxOrders) || cap.maxOrders < 0) errors.push('單數上限必須是 0 以上的整數');
    }
  }
  if (!s.rules) errors.push('缺少排班規則設定');
  else {
    for (const key of RULE_ORDER) {
      const rule = s.rules[key] as unknown as Record<string, unknown> | undefined;
      const label = RULE_LABELS[key];
      if (!rule) {
        errors.push(`缺少規則「${label}」`);
        continue;
      }
      if (typeof rule.enabled !== 'boolean') errors.push(`規則「${label}」的開關必須是是或否`);
      if (rule.level !== 'block' && rule.level !== 'warn') errors.push(`規則「${label}」的等級必須是阻擋或警告`);
      for (const field of ['value', 'maxHours', 'breakMinutes', 'normalDailyHours']) {
        if (field in rule && !isPositiveNumber(rule[field])) errors.push(`規則「${label}」的數值必須大於 0`);
      }
    }
    const needs: [keyof Settings['rules'], string][] = [
      ['maxConsecutiveWorkDays', 'value'],
      ['minRestBetweenDutiesHours', 'value'],
      ['dailyDrivingHours', 'value'],
      ['continuousDriving', 'maxHours'],
      ['continuousDriving', 'breakMinutes'],
      ['dailyWorkHours', 'value'],
      ['monthlyOvertimeHours', 'value'],
      ['monthlyOvertimeHours', 'normalDailyHours'],
    ];
    for (const [key, field] of needs) {
      const rule = s.rules[key] as unknown as Record<string, unknown> | undefined;
      if (rule && !(field in rule)) errors.push(`規則「${RULE_LABELS[key]}」缺少數值`);
    }
  }
  return errors;
}
