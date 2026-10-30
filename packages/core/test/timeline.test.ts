import { describe, expect, it } from 'vitest';
import { buildTimeline, describeTimeline, formatMinutes, parseTime, stationWindowAt } from '../src';
import type { Location } from '../src';
import { baseSettings, ctxFor, drop, duty, order, trip } from './fixtures';

const hhmm = (m: number) => formatMinutes(m);

describe('規格書 6.4 範例 A：台中廠，苗栗站一天兩趟，06:00 出車', () => {
  const o1 = order('st-miaoli', '92', 15);
  const o2 = order('st-miaoli', '95', 15);
  const ctx = ctxFor([o1, o2]);
  const plan = duty('d1', '2026-11-02', '06:00', [trip(drop(o1)), trip(drop(o2))]);
  const tl = buildTimeline(plan, ctx);

  it('合計 495 分，14:15 收車', () => {
    expect(tl.complete).toBe(true);
    expect(tl.start).toBe(parseTime('06:00'));
    expect(tl.end! - tl.start).toBe(495);
    expect(hhmm(tl.end!)).toBe('14:15');
  });

  it('每一段的時間與規格書一致', () => {
    const durations = tl.segments.map((s) => [s.kind, s.end - s.start]);
    expect(durations).toEqual([
      ['drive', 45],
      ['load', 30],
      ['drive', 90],
      ['unload', 30],
      ['drive', 90],
      ['load', 30],
      ['drive', 90],
      ['unload', 30],
      ['drive', 60],
    ]);
  });

  it('兩趟都到彰濱灌油，第一趟後回彰濱，最後一趟直接回台中廠', () => {
    expect(tl.tripLoadingIds).toEqual(['changbin', 'changbin']);
    const drives = tl.segments.filter((s) => s.kind === 'drive').map((s) => `${s.fromId}>${s.toId}`);
    expect(drives).toEqual([
      'taichung-depot>changbin',
      'changbin>st-miaoli',
      'st-miaoli>changbin',
      'changbin>st-miaoli',
      'st-miaoli>taichung-depot',
    ]);
  });
});

describe('規格書 6.4 範例 B：大夜班，六甲站一趟加嘉泰站一趟，00:00 出車', () => {
  const o1 = order('st-liujia', 'diesel', 30);
  const o2 = order('st-jiatai', '92', 30);
  const ctx = ctxFor([o1, o2]);
  // 大夜班的出車時間固定用設定值，班表上填的時間不影響。
  const plan = duty('d4', '2026-11-02', '13:00', [trip(drop(o1, [0, 1])), trip(drop(o2, [0, 1]))]);
  const tl = buildTimeline(plan, ctx);

  it('時間表與規格書一致，08:20 收車', () => {
    const rows = describeTimeline(tl, ctx).map((r) => `${hhmm(r.start)}-${hhmm(r.end)} ${r.text}`);
    expect(rows).toEqual([
      '00:00-00:20 麥寮廠→R89廠',
      '00:20-00:50 R89廠灌油',
      '00:50-02:30 R89廠→六甲站',
      '02:30-03:00 六甲站卸油',
      '03:00-04:40 六甲站→R89廠',
      '04:40-05:10 R89廠灌油',
      '05:10-06:40 R89廠→嘉泰站',
      '06:40-07:10 嘉泰站卸油',
      '07:10-08:20 嘉泰站→麥寮廠',
    ]);
    expect(hhmm(tl.end!)).toBe('08:20');
  });

  it('嘉泰站 06:40 抵達時已開門，不需等待', () => {
    expect(tl.segments.some((s) => s.kind === 'wait')).toBe(false);
    expect(tl.stops[1]).toMatchObject({ stationId: 'st-jiatai', waitMinutes: 0 });
  });

  it('大夜班一律到 R89 灌油', () => {
    expect(tl.tripLoadingIds).toEqual(['r89', 'r89']);
    expect(tl.shift).toBe('night');
  });
});

describe('規格書 6.4 範例 C：台中交通站營業時間 08–17，05:00 出車', () => {
  const o1 = order('st-taichung-jiaotong', '92', 10);
  const ctx = ctxFor([o1]);
  const plan = duty('d1', '2026-11-02', '05:00', [trip(drop(o1))]);
  const tl = buildTimeline(plan, ctx);

  it('07:00 抵達，插入 60 分等待，08:00 開始卸油，08:50 收車', () => {
    const rows = describeTimeline(tl, ctx).map((r) => `${hhmm(r.start)}-${hhmm(r.end)} ${r.text}`);
    expect(rows).toEqual([
      '05:00-05:45 台中廠→彰濱廠',
      '05:45-06:15 彰濱廠灌油',
      '06:15-07:00 彰濱廠→台中交通站',
      '07:00-08:00 台中交通站等待開門',
      '08:00-08:30 台中交通站卸油',
      '08:30-08:50 台中交通站→台中廠',
    ]);
    expect(tl.stops[0]).toMatchObject({ waitMinutes: 60, arrival: parseTime('07:00'), unloadStart: parseTime('08:00') });
    expect(hhmm(tl.end!)).toBe('08:50');
  });
});

describe('時間軸組成細節', () => {
  it('同一站兩艙（92、95 各一張單）只算一次卸油', () => {
    const a = order('st-changhua', '92', 15);
    const b = order('st-changhua', '95', 15);
    const ctx = ctxFor([a, b]);
    const tl = buildTimeline(duty('d1', '2026-11-02', '06:00', [trip(drop(a, [0]), drop(b, [1]))]), ctx);
    expect(tl.segments.filter((s) => s.kind === 'unload')).toHaveLength(1);
    expect(tl.stops[0].orderIds).toEqual([a.id, b.id]);
    // 45 + 30 + 45 + 30 + 40
    expect(tl.end! - tl.start).toBe(190);
  });

  it('一趟送兩站：灌油點→第一站→第二站→回廠', () => {
    const a = order('st-qingshui', '92', 15);
    const b = order('st-taichung-jiaotong', '95', 15);
    const ctx = ctxFor([a, b]);
    const tl = buildTimeline(duty('d1', '2026-11-02', '08:00', [trip(drop(a, [0]), drop(b, [1]))]), ctx);
    const drives = tl.segments.filter((s) => s.kind === 'drive').map((s) => `${s.fromId}>${s.toId}`);
    expect(drives).toEqual(['taichung-depot>changbin', 'changbin>st-qingshui', 'st-qingshui>st-taichung-jiaotong', 'st-taichung-jiaotong>taichung-depot']);
    // 45 + 30 + 45 + 30 + 20 + 30 + 20
    expect(tl.end! - tl.start).toBe(220);
  });

  it('出車前檢查時間可設定，會排在出車後第一段', () => {
    const a = order('st-qingshui', '92', 15);
    const settings = baseSettings();
    settings.operations.preTripMinutes = 15;
    const ctx = ctxFor([a], settings);
    const tl = buildTimeline(duty('d1', '2026-11-02', '06:00', [trip(drop(a))]), ctx);
    expect(tl.segments[0]).toMatchObject({ kind: 'pretrip', start: 360, end: 375 });
    expect(tl.segments[1]).toMatchObject({ kind: 'drive', start: 375 });
  });

  it('作業時間改了會立即反映在時間軸', () => {
    const o1 = order('st-miaoli', '92', 15);
    const settings = baseSettings();
    settings.operations.loadMinutes = 40;
    settings.operations.unloadMinutesPerStop = 20;
    const tl = buildTimeline(duty('d1', '2026-11-02', '06:00', [trip(drop(o1))]), ctxFor([o1], settings));
    expect(tl.end! - tl.start).toBe(45 + 40 + 90 + 20 + 60);
  });

  it('手動指定灌油點時以手動為準', () => {
    const a = order('st-changhua', '92', 15);
    const ctx = ctxFor([a]);
    const plan = duty('d1', '2026-11-02', '06:00', [{ loadingId: 'r89', drops: [drop(a)] }]);
    const tl = buildTimeline(plan, ctx);
    expect(tl.tripLoadingIds).toEqual(['r89']);
  });

  it('沒有車趟的班表沒有任何時間軸', () => {
    const tl = buildTimeline(duty('d1', '2026-11-02', '06:00', []), ctxFor());
    expect(tl.segments).toEqual([]);
    expect(tl.complete).toBe(true);
  });
});

describe('缺少路段時間', () => {
  it('不推估時間，列出所有缺少的路段，收車時間為無法計算', () => {
    // 台中廠日班送南部的嘉泰站：嘉泰站→台中廠沒有路段資料。
    const a = order('st-jiatai', '92', 15);
    const ctx = ctxFor([a]);
    const tl = buildTimeline(duty('d1', '2026-11-02', '06:00', [trip(drop(a))]), ctx);
    expect(tl.tripLoadingIds).toEqual(['r89']);
    expect(tl.missingLegs).toEqual([
      { fromId: 'taichung-depot', toId: 'r89', tripIndex: 0 },
      { fromId: 'st-jiatai', toId: 'taichung-depot', tripIndex: 0 },
    ]);
    expect(tl.complete).toBe(false);
    expect(tl.end).toBeNull();
    // 缺口之後的時間都無法計算，所以沒有任何區段。
    expect(tl.segments).toEqual([]);
  });

  it('缺口之前的區段仍會算出來', () => {
    const a = order('st-qingshui', '92', 15);
    const b = order('st-jiatai', '92', 15);
    const ctx = ctxFor([a, b]);
    const tl = buildTimeline(duty('d1', '2026-11-02', '06:00', [trip(drop(a, [0]), drop(b, [1]))]), ctx);
    expect(tl.missingLegs[0]).toEqual({ fromId: 'st-qingshui', toId: 'st-jiatai', tripIndex: 0 });
    expect(tl.segments.map((s) => s.kind)).toEqual(['drive', 'load', 'drive', 'unload']);
  });
});

describe('營業時間判斷', () => {
  const station = (openTime: string, closeTime: string): Location => ({
    id: 's',
    name: '測試站',
    type: 'station',
    region: 'south',
    hours24: false,
    openTime,
    closeTime,
    defaultLoadingId: 'r89',
  });

  it('關門後才抵達仍算當天，不會等到隔天', () => {
    expect(stationWindowAt(station('08:00', '17:00'), parseTime('18:00'))).toEqual({ openAt: 480, closeAt: 1020 });
  });

  it('跨日的時間用隔天的營業時段', () => {
    expect(stationWindowAt(station('06:00', '22:00'), 1440 + 120)).toEqual({ openAt: 1440 + 360, closeAt: 1440 + 1320 });
  });

  it('支援跨午夜營業（22:00–06:00）', () => {
    expect(stationWindowAt(station('22:00', '06:00'), parseTime('02:00'))).toEqual({ openAt: -120, closeAt: 360 });
    expect(stationWindowAt(station('22:00', '06:00'), parseTime('07:00'))).toEqual({ openAt: 1320, closeAt: 1800 });
  });

  it('24 小時站沒有營業時段限制', () => {
    expect(stationWindowAt({ ...station('00:00', '00:00'), hours24: true }, 100)).toBeNull();
  });
});
