import { describe, expect, it } from 'vitest';
import { buildDispatchSheet, evaluateDuties } from '../src';
import { ctxFor, drop, duty, order, trip } from './fixtures';

describe('派車單內容', () => {
  it('範例 B 的派車單列出時間、地點、油品與數量', () => {
    const o1 = order('st-liujia', 'diesel', 30);
    const o2 = order('st-jiatai', '92', 15);
    const o3 = order('st-jiatai', '95', 12);
    const ctx = ctxFor([o1, o2, o3]);
    const plan = duty('d4', '2026-11-02', '00:00', [trip(drop(o1, [0, 1])), trip(drop(o2, [0]), drop(o3, [1]))]);
    const ev = evaluateDuties([plan], ctx).get(plan.id)!;
    const sheet = buildDispatchSheet(ev, ctx);
    expect(sheet).toMatchObject({
      driverName: '司機D',
      shiftLabel: '大夜班',
      depotName: '麥寮廠',
      start: '00:00',
      end: '08:20',
      totalKL: 57,
      tripCount: 2,
      missingLegs: [],
    });
    expect(sheet.rows.map((r) => `${r.start} ${r.kindLabel} ${r.place} ${r.detail}`.trim())).toEqual([
      '00:00 行駛 麥寮廠→R89廠',
      '00:20 灌油 R89廠 柴油 30KL（第 1、2 艙）',
      '00:50 行駛 R89廠→六甲站',
      '02:30 卸油 六甲站 柴油 30KL',
      '03:00 行駛 六甲站→R89廠',
      '04:40 灌油 R89廠 92 無鉛 15KL（第 1 艙）、95 無鉛 12KL（第 2 艙）',
      '05:10 行駛 R89廠→嘉泰站',
      '06:40 卸油 嘉泰站 92 無鉛 15KL、95 無鉛 12KL',
      '07:10 行駛 嘉泰站→麥寮廠',
    ]);
    expect(sheet.trips[1].compartments).toEqual([
      { compartment: 1, product: '92 無鉛', quantityKL: 15, stationName: '嘉泰站' },
      { compartment: 2, product: '95 無鉛', quantityKL: 12, stationName: '嘉泰站' },
    ]);
  });
});
