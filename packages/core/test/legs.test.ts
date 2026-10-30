import { describe, expect, it } from 'vitest';
import legsJson from '../../../data/legs.json';
import {
  addDays,
  buildLegIndex,
  dayNumber,
  expandLegs,
  formatDuration,
  formatMinutes,
  lookupLeg,
  missingLegMessage,
  parseTime,
  suggestLegMinutes,
  validateSettings,
} from '../src';
import type { LegInput } from '../src';
import { baseSettings } from './fixtures';

describe('路段查詢', () => {
  it('bidirectional 展開成兩個方向', () => {
    const legs = expandLegs([{ from: 'a', to: 'b', minutes: 45, bidirectional: true, source: 'confirmed' }]);
    expect(legs).toEqual([
      { fromId: 'a', toId: 'b', minutes: 45, source: 'confirmed', note: null },
      { fromId: 'b', toId: 'a', minutes: 45, source: 'confirmed', note: null },
    ]);
  });

  it('單向路段只有一個方向', () => {
    const index = buildLegIndex(expandLegs([{ from: 'a', to: 'b', minutes: 60, bidirectional: false, source: 'excel' }]));
    expect(lookupLeg(index, 'a', 'b')).toMatchObject({ ok: true, minutes: 60 });
    expect(lookupLeg(index, 'b', 'a')).toEqual({ ok: false, fromId: 'b', toId: 'a' });
  });

  it('明確寫出的單向資料優先於反向展開的資料', () => {
    const legs = expandLegs([
      { from: 'a', to: 'b', minutes: 45, bidirectional: true, source: 'confirmed' },
      { from: 'b', to: 'a', minutes: 50, bidirectional: false, source: 'manual' },
    ]);
    expect(lookupLeg(buildLegIndex(legs), 'b', 'a')).toMatchObject({ ok: true, minutes: 50 });
  });

  it('初始資料展開後沒有重複的方向', () => {
    const legs = expandLegs(legsJson.legs as LegInput[]);
    const keys = legs.map((l) => `${l.fromId}>${l.toId}`);
    expect(new Set(keys).size).toBe(keys.length);
    const index = buildLegIndex(legs);
    expect(lookupLeg(index, 'changbin', 'taichung-depot')).toMatchObject({ ok: true, minutes: 45 });
    // 站→出發廠是單向的。
    expect(lookupLeg(index, 'taichung-depot', 'st-miaoli').ok).toBe(false);
  });

  it('缺少路段的訊息格式', () => {
    expect(missingLegMessage('彰濱廠', '嘉泰站')).toBe('缺少路段時間：彰濱廠→嘉泰站');
  });

  it('新增路段建議值：Google 小客車時間 × 倍數，進位到 5 分', () => {
    expect(suggestLegMinutes(30, 1.5)).toBe(45);
    expect(suggestLegMinutes(31, 1.5)).toBe(50);
    expect(suggestLegMinutes(37, 1.5)).toBe(60);
    expect(suggestLegMinutes(20, 1.2)).toBe(25);
    expect(() => suggestLegMinutes(0, 1.5)).toThrow();
  });
});

describe('時間工具', () => {
  it('時間字串與分鐘互轉', () => {
    expect(parseTime('00:00')).toBe(0);
    expect(parseTime('08:20')).toBe(500);
    expect(() => parseTime('8:20')).toThrow('時間格式錯誤');
    expect(formatMinutes(855)).toBe('14:15');
    expect(formatMinutes(1440 + 90)).toBe('01:30（+1天）');
    expect(formatDuration(495)).toBe('8 小時 15 分');
    expect(formatDuration(60)).toBe('1 小時');
  });

  it('跨月、跨年的日期計算', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(dayNumber('2026-11-02') - dayNumber('2026-10-27')).toBe(6);
  });
});

describe('設定檢查', () => {
  it('完整的設定沒有錯誤', () => {
    expect(validateSettings(baseSettings())).toEqual([]);
  });

  it('錯誤的數值會列出中文訊息', () => {
    const s = baseSettings();
    s.operations.loadMinutes = -1;
    s.nightShift.startTime = '25:00';
    s.rules.minRestBetweenDutiesHours.value = 0;
    expect(validateSettings(s)).toEqual([
      '灌油時間必須是 0 以上的數字',
      '大夜班需要出車時間（HH:MM）與灌油點',
      '規則「兩天之間休息」的數值必須大於 0',
    ]);
  });
});
