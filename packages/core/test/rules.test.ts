import { describe, expect, it } from 'vitest';
import { addDays, checkPublish, evaluateBoard, evaluateDuties, statusColor } from '../src';
import type { DutyPlan, Issue, Order, RuleKey, Settings } from '../src';
import { baseData, baseSettings, ctxFor, drop, duty, order, trip } from './fixtures';

const DATE = '2026-11-02';

function evaluate(duties: DutyPlan[], orders: Order[], settings: Settings = baseSettings(), target = DATE) {
  return evaluateDuties(duties, ctxFor(orders, settings), [target]);
}

function issuesOf(duties: DutyPlan[], orders: Order[], settings?: Settings, dutyId?: string, target = DATE): Issue[] {
  const result = evaluate(duties, orders, settings, target);
  const id = dutyId ?? duties.find((d) => d.date === target)!.id;
  return result.get(id)!.issues;
}

const ofRule = (issues: Issue[], rule: RuleKey) => issues.filter((i) => i.rule === rule && i.level !== 'info');

/** 台中廠清水梧棲站一趟：45 + 30 + 45 + 30 + 15 = 165 分。 */
function qingshuiDuty(date: string, startTime: string, driverId = 'd1') {
  const o = order('st-qingshui', '92', 10, { date });
  return { o, plan: duty(driverId, date, startTime, [trip(drop(o))]) };
}

/** 範例 A：06:00 出車、14:15 收車。 */
function exampleA(date = DATE) {
  const o1 = order('st-miaoli', '92', 15, { date });
  const o2 = order('st-miaoli', '95', 15, { date });
  return { orders: [o1, o2], plan: duty('d1', date, '06:00', [trip(drop(o1)), trip(drop(o2))]) };
}

describe('做六休一', () => {
  function run(days: number) {
    const orders: Order[] = [];
    const plans: DutyPlan[] = [];
    for (let i = 0; i < days; i++) {
      const { o, plan } = qingshuiDuty(addDays(DATE, i - (days - 1)), '06:00');
      orders.push(o);
      plans.push(plan);
    }
    return { orders, plans };
  }

  it('連續 6 天通過', () => {
    const { orders, plans } = run(6);
    expect(ofRule(issuesOf(plans, orders), 'maxConsecutiveWorkDays')).toEqual([]);
  });

  it('連續 7 天違規（阻擋）', () => {
    const { orders, plans } = run(7);
    const issues = ofRule(issuesOf(plans, orders), 'maxConsecutiveWorkDays');
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe('block');
    expect(issues[0].message).toBe('連續上班 7 天（10/27（二）～11/2（一）），超過上限 6 天');
  });

  it('中間休一天就重新計算', () => {
    const { orders, plans } = run(8);
    const withRest = plans.filter((p) => p.date !== addDays(DATE, -3));
    expect(ofRule(issuesOf(withRest, orders), 'maxConsecutiveWorkDays')).toEqual([]);
  });

  it('沒有車趟的空班表不算有班', () => {
    const { orders, plans } = run(7);
    plans[3] = { ...plans[3], trips: [] };
    expect(ofRule(issuesOf(plans, orders), 'maxConsecutiveWorkDays')).toEqual([]);
  });

  it('上限天數可設定，規則可關閉', () => {
    const { orders, plans } = run(5);
    const settings = baseSettings();
    settings.rules.maxConsecutiveWorkDays.value = 4;
    expect(ofRule(issuesOf(plans, orders, settings), 'maxConsecutiveWorkDays')).toHaveLength(1);
    settings.rules.maxConsecutiveWorkDays.enabled = false;
    expect(ofRule(issuesOf(plans, orders, settings), 'maxConsecutiveWorkDays')).toEqual([]);
  });
});

describe('兩天之間休息 11 小時', () => {
  it('前一天 14:15 收車、今天 06:00 出車：間隔 15 小時 45 分，通過', () => {
    const a = exampleA(addDays(DATE, -1));
    const b = qingshuiDuty(DATE, '06:00');
    expect(ofRule(issuesOf([a.plan, b.plan], [...a.orders, b.o]), 'minRestBetweenDutiesHours')).toEqual([]);
  });

  it('剛好 11 小時通過', () => {
    const a = exampleA(addDays(DATE, -1)); // 14:15 收車
    const b = qingshuiDuty(DATE, '01:15');
    expect(ofRule(issuesOf([a.plan, b.plan], [...a.orders, b.o]), 'minRestBetweenDutiesHours')).toEqual([]);
  });

  it('前一天 14:15 收車、今天 01:00 出車：只間隔 10 小時 45 分，違規並建議出車時間', () => {
    const a = exampleA(addDays(DATE, -1));
    const b = qingshuiDuty(DATE, '01:00');
    const issues = ofRule(issuesOf([a.plan, b.plan], [...a.orders, b.o]), 'minRestBetweenDutiesHours');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      level: 'block',
      message: '與 11/1（日） 收車（14:15）只間隔 10 小時 45 分，至少需 11 小時',
      suggestion: '出車時間不要早於 01:15',
    });
  });

  it('前一天的班表也會看到與隔天的間隔不足', () => {
    const a = exampleA(addDays(DATE, -1));
    const b = qingshuiDuty(DATE, '01:00');
    const issues = ofRule(issuesOf([a.plan, b.plan], [...a.orders, b.o], undefined, a.plan.id, addDays(DATE, -1)), 'minRestBetweenDutiesHours');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toBe('收車到 11/2（一） 出車（01:00）只間隔 10 小時 45 分，至少需 11 小時');
  });

  it('大夜班連續兩天：08:20 收車到隔天 00:00 出車，間隔 15 小時 40 分，通過', () => {
    const night = (date: string) => {
      const o1 = order('st-liujia', 'diesel', 30, { date });
      const o2 = order('st-jiatai', '92', 30, { date });
      return { orders: [o1, o2], plan: duty('d4', date, '00:00', [trip(drop(o1, [0, 1])), trip(drop(o2, [0, 1]))]) };
    };
    const a = night(addDays(DATE, -1));
    const b = night(DATE);
    expect(ofRule(issuesOf([a.plan, b.plan], [...a.orders, ...b.orders]), 'minRestBetweenDutiesHours')).toEqual([]);
  });

  it('大夜班的出車時間固定用設定值（00:00），班表上填的時間不影響', () => {
    const day = addDays(DATE, -1);
    const o1 = order('st-liujia', 'diesel', 30, { date: day });
    const prev = duty('d4', day, '06:00', [trip(drop(o1, [0, 1]))]);
    expect(evaluate([prev], [o1], baseSettings(), day).get(prev.id)!.timeline.start).toBe(0);
  });

  it('00:00 出車也要跨日檢查：前一天 12:50 收車通過、14:05 收車違規', () => {
    const day = addDays(DATE, -1);
    const c2 = order('st-liujia', 'diesel', 30);
    const early = duty('d3', DATE, '00:00', [trip(drop(c2, [0, 1]))]);

    // 07:00 + 20 + 30 + 150 + 30 + 120 = 12:50 收車 → 隔天 00:00 間隔 11 小時 10 分，通過。
    const c1 = order('st-yanchao', 'diesel', 30, { date: day });
    const ok = duty('d3', day, '07:00', [trip(drop(c1, [0, 1]))]);
    expect(ofRule(issuesOf([ok, early], [c1, c2], undefined, early.id), 'minRestBetweenDutiesHours')).toEqual([]);

    // 07:00 + 20 + 30 + 180 + 30 + 165 = 14:05 收車 → 隔天 00:00 只間隔 9 小時 55 分。
    const c3 = order('st-chaozhou', 'diesel', 30, { date: day });
    const late = duty('d3', day, '07:00', [trip(drop(c3, [0, 1]))]);
    const issues = ofRule(issuesOf([late, early], [c3, c2], undefined, early.id), 'minRestBetweenDutiesHours');
    expect(issues.map((i) => i.message)).toEqual(['與 11/1（日） 收車（14:05）只間隔 9 小時 55 分，至少需 11 小時']);
  });

  it('真正的大夜班司機：前一天下午收車，隔天 00:00 出車違規，建議調整前一天', () => {
    const day = addDays(DATE, -1);
    // 司機D 是大夜班，出車時間固定 00:00；這裡送兩趟潮州站（06:00 開門，第一趟要等待），16:15 收車。
    const o1 = order('st-chaozhou', 'diesel', 30, { date: day });
    const o2 = order('st-chaozhou', 'diesel', 30, { date: day });
    const prev = duty('d4', day, '00:00', [trip(drop(o1, [0, 1])), trip(drop(o2, [0, 1]))]);
    const b = order('st-liujia', 'diesel', 30);
    const today = duty('d4', DATE, '00:00', [trip(drop(b, [0, 1]))]);
    const issues = ofRule(issuesOf([prev, today], [o1, o2, b]), 'minRestBetweenDutiesHours');
    expect(issues).toHaveLength(1);
    expect(issues[0].suggestion).toBe('大夜班出車時間固定，請讓 11/1（日） 的班表提早收車');
  });

  it('時數可設定，規則可關閉', () => {
    const a = exampleA(addDays(DATE, -1));
    const b = qingshuiDuty(DATE, '06:00'); // 間隔 15 小時 45 分
    const settings = baseSettings();
    settings.rules.minRestBetweenDutiesHours.value = 16;
    expect(ofRule(issuesOf([a.plan, b.plan], [...a.orders, b.o], settings), 'minRestBetweenDutiesHours')).toHaveLength(1);
    settings.rules.minRestBetweenDutiesHours.enabled = false;
    expect(ofRule(issuesOf([a.plan, b.plan], [...a.orders, b.o], settings), 'minRestBetweenDutiesHours')).toEqual([]);
  });
});

describe('油站營業時間', () => {
  it('範例 C：開門前抵達自動等待，不算違規', () => {
    const o = order('st-taichung-jiaotong', '92', 10);
    const issues = issuesOf([duty('d1', DATE, '05:00', [trip(drop(o))])], [o]);
    expect(ofRule(issues, 'stationOpeningHours')).toEqual([]);
    expect(issues.find((i) => i.rule === 'stationOpeningHours')).toMatchObject({
      level: 'info',
      message: '第 1 趟：07:00 抵達台中交通站，等待 1 小時到 08:00 開門',
    });
  });

  it('卸油超過關門時間違規（阻擋），並建議提早出車', () => {
    // 15:00 出車 → 15:45 灌油 → 16:15 出發 → 17:00 抵達 → 17:30 卸完，超過 17:00。
    const o = order('st-taichung-jiaotong', '92', 10);
    const issues = ofRule(issuesOf([duty('d1', DATE, '15:00', [trip(drop(o))])], [o]), 'stationOpeningHours');
    expect(issues).toEqual([
      {
        rule: 'stationOpeningHours',
        level: 'block',
        message: '第 1 趟：台中交通站卸油到 17:30，超過關門時間 17:00（晚 30 分）',
        suggestion: '出車時間至少提早 30 分，或調整送油順序、改派其他司機',
        tripIndex: 0,
      },
    ]);
  });

  it('剛好在關門時間卸完通過', () => {
    const o = order('st-taichung-jiaotong', '92', 10);
    expect(ofRule(issuesOf([duty('d1', DATE, '14:30', [trip(drop(o))])], [o]), 'stationOpeningHours')).toEqual([]);
  });

  it('營業時間改了會立即重算', () => {
    const o = order('st-taichung-jiaotong', '92', 10);
    const data = baseData([o]);
    data.locations = data.locations.map((l) => (l.id === 'st-taichung-jiaotong' ? { ...l, closeTime: '18:00' } : l));
    const board = evaluateBoard(DATE, data, [duty('d1', DATE, '15:00', [trip(drop(o))])]);
    const ev = board.rows.find((r) => r.driver.id === 'd1')!.evaluation!;
    expect(ofRule(ev.issues, 'stationOpeningHours')).toEqual([]);
  });

  it('等級改成警告、或關閉規則', () => {
    const o = order('st-taichung-jiaotong', '92', 10);
    const settings = baseSettings();
    settings.rules.stationOpeningHours.level = 'warn';
    expect(ofRule(issuesOf([duty('d1', DATE, '15:00', [trip(drop(o))])], [o], settings), 'stationOpeningHours')[0].level).toBe('warn');
    settings.rules.stationOpeningHours.enabled = false;
    expect(ofRule(issuesOf([duty('d1', DATE, '15:00', [trip(drop(o))])], [o], settings), 'stationOpeningHours')).toEqual([]);
  });

  it('大夜班送非 24 小時站：太早到會等待；超過關門就違規', () => {
    const o = order('st-mailiao', '92', 10); // 05–22
    const ev = evaluate([duty('d4', DATE, '00:00', [trip(drop(o))])], [o]).get(`d4-${DATE}`)!;
    // 00:00 → 00:20 R89 灌油 → 00:50 出發 → 01:10 抵達，等到 05:00。
    expect(ev.timeline.stops[0]).toMatchObject({ waitMinutes: 230 });
    expect(ofRule(ev.issues, 'stationOpeningHours')).toEqual([]);
  });
});

describe('缺少路段時間', () => {
  it('有缺口時阻擋，訊息為「缺少路段時間：A→B」', () => {
    const o = order('st-jiatai', '92', 10);
    const issues = ofRule(issuesOf([duty('d1', DATE, '06:00', [trip(drop(o))])], [o]), 'missingLeg');
    expect(issues.map((i) => [i.level, i.message, i.leg])).toEqual([
      ['block', '缺少路段時間：台中廠→R89廠', { fromId: 'taichung-depot', toId: 'r89' }],
      ['block', '缺少路段時間：嘉泰站→台中廠', { fromId: 'st-jiatai', toId: 'taichung-depot' }],
    ]);
  });

  it('路段齊全時沒有問題', () => {
    const { orders, plan } = exampleA();
    expect(ofRule(issuesOf([plan], orders), 'missingLeg')).toEqual([]);
  });

  it('規則關閉時仍以提示列出', () => {
    const o = order('st-jiatai', '92', 10);
    const settings = baseSettings();
    settings.rules.missingLeg.enabled = false;
    const issues = issuesOf([duty('d1', DATE, '06:00', [trip(drop(o))])], [o], settings).filter((i) => i.rule === 'missingLeg');
    expect(issues.every((i) => i.level === 'info')).toBe(true);
    expect(issues).toHaveLength(2);
  });

  it('補上路段後立即可以計算', () => {
    const o = order('st-jiatai', '92', 10);
    const data = baseData([o]);
    data.legs.push(
      { fromId: 'taichung-depot', toId: 'r89', minutes: 90, source: 'manual' },
      { fromId: 'st-jiatai', toId: 'taichung-depot', minutes: 120, source: 'manual' },
    );
    const board = evaluateBoard(DATE, data, [duty('d1', DATE, '06:00', [trip(drop(o))])]);
    const ev = board.rows.find((r) => r.driver.id === 'd1')!.evaluation!;
    expect(ev.timeline.end).toBe(360 + 90 + 30 + 90 + 30 + 120);
    expect(ev.status).toBe('green');
  });
});

describe('每日單數上限（以車趟計算）', () => {
  /** 一個站一趟，n 趟。 */
  function trips(n: number, date = DATE) {
    const ids = ['st-qingshui', 'st-changhua', 'st-miaoli', 'st-qingshui', 'st-changhua'];
    const orders = ids.slice(0, n).map((s) => order(s, '92', 5, { date }));
    return { orders, trips: orders.map((o) => trip(drop(o))) };
  }

  it('台中廠每位司機 3 趟通過、4 趟警告', () => {
    const three = trips(3);
    expect(ofRule(issuesOf([duty('d1', DATE, '04:00', three.trips)], three.orders), 'orderCaps')).toEqual([]);
    const four = trips(4);
    const issues = ofRule(issuesOf([duty('d1', DATE, '04:00', four.trips)], four.orders), 'orderCaps');
    expect(issues).toEqual([expect.objectContaining({ level: 'warn', message: '今日 4 單，超過台中廠每位司機每日上限 3 單' })]);
  });

  it('一趟送兩站只算 1 單：第三趟送清水梧棲 92 15KL 與彰化 95 10KL，共 3 單通過', () => {
    const a = order('st-miaoli', '92', 30);
    const b = order('st-miaoli', '95', 30);
    const c = order('st-qingshui', '92', 15);
    const d = order('st-changhua', '95', 10);
    const plan = duty('d1', DATE, '04:00', [trip(drop(a, [0, 1])), trip(drop(b, [0, 1])), trip(drop(c, [0]), drop(d, [1]))]);
    const ev = evaluate([plan], [a, b, c, d]).get(plan.id)!;
    expect(ev.tripCount).toBe(3);
    expect(ofRule(ev.issues, 'orderCaps')).toEqual([]);
  });

  it('超過 30KL 拆成兩趟的訂單算 2 單', () => {
    const big = order('st-qingshui', '92', 60);
    const more = trips(2);
    const plan = duty('d1', DATE, '04:00', [trip(drop(big, [0, 1], 30)), trip(drop(big, [0, 1], 30)), ...more.trips]);
    const ev = evaluate([plan], [big, ...more.orders]).get(plan.id)!;
    expect(ev.tripCount).toBe(4);
    expect(ofRule(ev.issues, 'orderCaps')).toEqual([expect.objectContaining({ message: '今日 4 單，超過台中廠每位司機每日上限 3 單' })]);
  });

  it('麥寮廠 3 位司機合計 6 趟通過、7 趟警告', () => {
    const south = ['st-mailiao', 'st-jiatai', 'st-jiayi', 'st-liujia', 'st-yanchao', 'st-chaozhou', 'st-mailiao'];
    const orders = south.map((s) => order(s, 'diesel', 5));
    const t = orders.map((o) => trip(drop(o)));
    const d2 = duty('d2', DATE, '06:00', [t[0], t[1]]);
    const d3 = duty('d3', DATE, '06:00', [t[2], t[3]]);
    const d4six = duty('d4', DATE, '00:00', [t[4], t[5]]);
    expect(ofRule(issuesOf([d2, d3, d4six], orders, undefined, 'd2-' + DATE), 'orderCaps')).toEqual([]);

    const d4seven = duty('d4', DATE, '00:00', [t[4], t[5], t[6]]);
    const result = evaluate([d2, d3, d4seven], orders);
    for (const id of ['d2', 'd3', 'd4']) {
      expect(ofRule(result.get(`${id}-${DATE}`)!.issues, 'orderCaps')).toEqual([
        expect.objectContaining({ level: 'warn', message: '麥寮廠今日合計 7 單，超過上限 6 單' }),
      ]);
    }
  });

  it('上限可設定，規則可關閉', () => {
    const two = trips(2);
    const plan = duty('d1', DATE, '04:00', two.trips);
    const settings = baseSettings();
    settings.orderCaps = settings.orderCaps.map((c) => (c.depotId === 'taichung-depot' ? { ...c, maxOrders: 1 } : c));
    expect(ofRule(issuesOf([plan], two.orders, settings), 'orderCaps')).toHaveLength(1);
    settings.rules.orderCaps.enabled = false;
    expect(ofRule(issuesOf([plan], two.orders, settings), 'orderCaps')).toEqual([]);
  });
});

describe('預設關閉的工時類規則', () => {
  it('預設都關閉，不產生任何問題', () => {
    const { orders, plan } = exampleA();
    const issues = issuesOf([plan], orders);
    for (const rule of ['dailyDrivingHours', 'continuousDriving', 'dailyWorkHours', 'monthlyOvertimeHours'] as const) {
      expect(ofRule(issues, rule)).toEqual([]);
    }
  });

  it('每日駕車時數：範例 A 駕車 6 小時 15 分', () => {
    const { orders, plan } = exampleA();
    const settings = baseSettings();
    settings.rules.dailyDrivingHours.enabled = true;
    expect(ofRule(issuesOf([plan], orders, settings), 'dailyDrivingHours')).toEqual([]);
    settings.rules.dailyDrivingHours.value = 6;
    expect(ofRule(issuesOf([plan], orders, settings), 'dailyDrivingHours')).toEqual([
      expect.objectContaining({ level: 'warn', message: '今日駕車 6 小時 15 分，超過 6 小時' }),
    ]);
  });

  it('連續駕車：灌油卸油不算休息，範例 A 違規', () => {
    const { orders, plan } = exampleA();
    const settings = baseSettings();
    settings.rules.continuousDriving.enabled = true;
    const issues = ofRule(issuesOf([plan], orders, settings), 'continuousDriving');
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe('warn');
    expect(issues[0].message).toBe('12:45 前已連續駕車 5 小時 15 分，超過 4 小時未休息 30 分');
  });

  it('連續駕車：等待夠久就算休息', () => {
    const o = order('st-taichung-jiaotong', '92', 10);
    const plan = duty('d1', DATE, '05:00', [trip(drop(o))]);
    const settings = baseSettings();
    settings.rules.continuousDriving = { enabled: true, level: 'warn', maxHours: 1.5, breakMinutes: 30 };
    // 45 + 45 = 90 分（未超過），等待 60 分算休息，再開 20 分。
    expect(ofRule(issuesOf([plan], [o], settings), 'continuousDriving')).toEqual([]);
    settings.rules.continuousDriving.breakMinutes = 90;
    expect(ofRule(issuesOf([plan], [o], settings), 'continuousDriving')).toHaveLength(1);
  });

  it('每日工時：範例 A 工時 8 小時 15 分', () => {
    const { orders, plan } = exampleA();
    const settings = baseSettings();
    settings.rules.dailyWorkHours.enabled = true;
    expect(ofRule(issuesOf([plan], orders, settings), 'dailyWorkHours')).toEqual([]);
    settings.rules.dailyWorkHours.value = 8;
    expect(ofRule(issuesOf([plan], orders, settings), 'dailyWorkHours')).toEqual([
      expect.objectContaining({ level: 'block', message: '今日工時 8 小時 15 分，超過 8 小時' }),
    ]);
  });

  it('每月加班：同月份每天超過 8 小時的部分累計', () => {
    const settings = baseSettings();
    settings.rules.monthlyOvertimeHours.enabled = true;
    settings.rules.monthlyOvertimeHours.value = 0.5; // 30 分
    const two = [exampleA('2026-11-02'), exampleA('2026-11-03')];
    // 每天加班 15 分，兩天 30 分，未超過。
    expect(ofRule(issuesOf(two.map((x) => x.plan), two.flatMap((x) => x.orders), settings), 'monthlyOvertimeHours')).toEqual([]);
    const three = [...two, exampleA('2026-11-04')];
    expect(ofRule(issuesOf(three.map((x) => x.plan), three.flatMap((x) => x.orders), settings), 'monthlyOvertimeHours')).toEqual([
      expect.objectContaining({ level: 'block', message: '2026 年 11 月加班合計 45 分，超過 0.5 小時' }),
    ]);
    // 不同月份不累計。
    const crossMonth = [exampleA('2026-10-31'), ...two];
    expect(ofRule(issuesOf(crossMonth.map((x) => x.plan), crossMonth.flatMap((x) => x.orders), settings), 'monthlyOvertimeHours')).toEqual([]);
  });
});

describe('狀態顏色與發布', () => {
  it('範例 A 全部通過：綠燈，可直接發布', () => {
    const { orders, plan } = exampleA();
    const ev = evaluate([plan], orders).get(plan.id)!;
    expect(ev.status).toBe('green');
    expect(checkPublish(ev)).toMatchObject({ canPublish: true, needsReason: false });
  });

  it('只有警告：黃燈，要填原因才能發布', () => {
    const four = ['st-qingshui', 'st-changhua', 'st-miaoli', 'st-qingshui'].map((s) => order(s, '92', 5));
    const plan = duty('d1', DATE, '03:00', four.map((o) => trip(drop(o))));
    const ev = evaluate([plan], four).get(plan.id)!;
    expect(ev.status).toBe('yellow');
    expect(checkPublish(ev)).toMatchObject({ canPublish: true, needsReason: true });
  });

  it('有阻擋：紅燈，不能發布', () => {
    const o = order('st-jiatai', '92', 10);
    const ev = evaluate([duty('d1', DATE, '06:00', [trip(drop(o))])], [o]).get(`d1-${DATE}`)!;
    expect(ev.status).toBe('red');
    expect(checkPublish(ev).canPublish).toBe(false);
  });

  it('提示不影響狀態', () => {
    expect(statusColor([{ rule: 'data', level: 'info', message: 'x' }])).toBe('green');
  });

  it('排入量超過訂單量時阻擋', () => {
    const o = order('st-qingshui', '92', 10);
    const ev = evaluate([duty('d1', DATE, '06:00', [trip(drop(o, [0], 10)), trip(drop(o, [0], 5))])], [o]).get(`d1-${DATE}`)!;
    expect(ev.issues.some((i) => i.level === 'block' && i.message.includes('超過訂單量'))).toBe(true);
  });
});

describe('看板彙整', () => {
  it('每位司機一列，沒有班表的司機也列出', () => {
    const { orders, plan } = exampleA();
    const board = evaluateBoard(DATE, baseData(orders), [plan]);
    expect(board.rows.map((r) => [r.driver.id, r.evaluation?.status ?? null])).toEqual([
      ['d1', 'green'],
      ['d2', null],
      ['d3', null],
      ['d4', null],
    ]);
    expect(board.assignedOrderIds).toEqual(new Set(orders.map((o) => o.id)));
    expect(board.depotTotals).toEqual([
      { depotId: 'taichung-depot', tripCount: 2, maxOrders: 3, scope: 'perDriver' },
      { depotId: 'mailiao-depot', tripCount: 0, maxOrders: 6, scope: 'depotTotal' },
    ]);
  });
});
