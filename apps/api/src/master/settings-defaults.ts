import type { Settings } from '@tanker/core';

/**
 * `data/settings.json` 沒有、但系統需要的設定。seed 時一併寫入資料庫，之後可在設定頁修改。
 * - dayShift.defaultStartTime：日班新班表的預設出車時間（規格書範例 A 為 06:00）。
 * - trip.maxStopsPerTrip：每趟最多送幾站（規格書第 4 節）。
 * - rules.monthlyOvertimeHours.normalDailyHours：計算加班的每日正常工時（勞基法第 30 條）。
 */
export const SETTINGS_SUPPLEMENT = {
  dayShift: { defaultStartTime: '06:00' },
  trip: { maxStopsPerTrip: 2 },
  normalDailyHours: 8,
} as const;

/** 補齊缺少的設定 key，回傳完整的 Settings。 */
export function completeSettings(raw: Record<string, unknown>): Settings {
  const settings = structuredClone(raw) as unknown as Settings;
  settings.dayShift ??= { ...SETTINGS_SUPPLEMENT.dayShift };
  settings.trip ??= { ...SETTINGS_SUPPLEMENT.trip };
  if (settings.rules?.monthlyOvertimeHours && settings.rules.monthlyOvertimeHours.normalDailyHours === undefined) {
    settings.rules.monthlyOvertimeHours.normalDailyHours = SETTINGS_SUPPLEMENT.normalDailyHours;
  }
  return settings;
}
