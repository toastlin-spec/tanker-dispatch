import { describe, expect, it } from 'vitest';
import {
  assignOrderToDuty,
  compartmentLoads,
  pickCompartments,
  removeOrderFromDuty,
  reorderDrops,
  splitIntoChunks,
  validateTripLoading,
} from '../src';
import type { DutyPlan, Order } from '../src';
import { ctxFor, drop, duty, order, trip } from './fixtures';

function assign(plan: DutyPlan, o: Order, orders: Order[]) {
  const result = assignOrderToDuty(plan, o, ctxFor(orders));
  if (!result.ok) throw new Error(result.error);
  return result.plan;
}

describe('艙位分配', () => {
  it('15KL 以下用一艙，15～30KL 用兩艙', () => {
    expect(pickCompartments([15, 15], [0, 1], 8)).toEqual([0]);
    expect(pickCompartments([15, 15], [0, 1], 15)).toEqual([0]);
    expect(pickCompartments([15, 15], [0, 1], 15.5)).toEqual([0, 1]);
    expect(pickCompartments([15, 15], [0, 1], 30)).toEqual([0, 1]);
    expect(pickCompartments([15, 15], [1], 12)).toEqual([1]);
    expect(pickCompartments([15, 15], [1], 20)).toBeNull();
  });

  it('超過 30KL 拆成多份', () => {
    expect(splitIntoChunks(40, 30)).toEqual([30, 10]);
    expect(splitIntoChunks(60, 30)).toEqual([30, 30]);
    expect(splitIntoChunks(30, 30)).toEqual([30]);
    expect(splitIntoChunks(12.5, 30)).toEqual([12.5]);
  });

  it('每艙實際裝的量依艙位順序裝滿', () => {
    expect(compartmentLoads({ orderId: 'x', stationId: 's', quantityKL: 25, compartmentIdx: [0, 1] }, [15, 15])).toEqual([
      { idx: 0, quantityKL: 15 },
      { idx: 1, quantityKL: 10 },
    ]);
  });
});

describe('拖單排入班表', () => {
  it('第一張單建立新車趟，灌油點自動選擇', () => {
    const a = order('st-changhua', '92', 12);
    const plan = assign(duty('d1', '2026-11-02', '06:00', []), a, [a]);
    expect(plan.trips).toEqual([{ loadingId: null, drops: [{ orderId: a.id, stationId: 'st-changhua', quantityKL: 12, compartmentIdx: [0] }] }]);
  });

  it('同站 92 與 95 併入同一趟、各用一艙', () => {
    const a = order('st-changhua', '92', 15);
    const b = order('st-changhua', '95', 10);
    let plan = assign(duty('d1', '2026-11-02', '06:00', []), a, [a, b]);
    plan = assign(plan, b, [a, b]);
    expect(plan.trips).toHaveLength(1);
    expect(plan.trips[0].drops.map((d) => d.compartmentIdx)).toEqual([[0], [1]]);
  });

  it('一趟最多送兩站，第三站另開一趟', () => {
    const a = order('st-changhua', '92', 10);
    const b = order('st-qingshui', '92', 10);
    const c = order('st-miaoli', '92', 10);
    const all = [a, b, c];
    let plan = duty('d1', '2026-11-02', '06:00', []);
    for (const o of all) plan = assign(plan, o, all);
    expect(plan.trips.map((t) => t.drops.map((d) => d.stationId))).toEqual([['st-changhua', 'st-qingshui'], ['st-miaoli']]);
  });

  it('98 無鉛屬於汽油：同站 92 15KL 與 98 10KL 併入同一趟、各用一艙', () => {
    const a = order('st-qingshui', '92', 15);
    const b = order('st-qingshui', '98', 10);
    let plan = assign(duty('d1', '2026-11-02', '06:00', []), a, [a, b]);
    plan = assign(plan, b, [a, b]);
    expect(plan.trips).toHaveLength(1);
    expect(plan.trips[0].drops.map((d) => d.compartmentIdx)).toEqual([[0], [1]]);
  });

  it('92 送清水梧棲、98 送彰化，併成一趟送兩站', () => {
    const a = order('st-qingshui', '92', 15);
    const b = order('st-changhua', '98', 10);
    let plan = assign(duty('d1', '2026-11-02', '06:00', []), a, [a, b]);
    plan = assign(plan, b, [a, b]);
    expect(plan.trips.map((t) => t.drops.map((d) => d.stationId))).toEqual([['st-qingshui', 'st-changhua']]);
  });

  it('98 和柴油不同趟', () => {
    const a = order('st-changhua', '98', 10);
    const b = order('st-changhua', 'diesel', 10);
    let plan = assign(duty('d1', '2026-11-02', '06:00', []), a, [a, b]);
    plan = assign(plan, b, [a, b]);
    expect(plan.trips).toHaveLength(2);
  });

  it('汽油和柴油不同趟', () => {
    const a = order('st-changhua', '92', 10);
    const b = order('st-changhua', 'diesel', 10);
    let plan = assign(duty('d1', '2026-11-02', '06:00', []), a, [a, b]);
    plan = assign(plan, b, [a, b]);
    expect(plan.trips).toHaveLength(2);
    expect(plan.trips[1].drops[0].orderId).toBe(b.id);
  });

  it('15～30KL 的單用兩艙，裝滿的車趟不再併單', () => {
    const a = order('st-changhua', '92', 20);
    const b = order('st-changhua', '95', 5);
    let plan = assign(duty('d1', '2026-11-02', '06:00', []), a, [a, b]);
    expect(plan.trips[0].drops[0].compartmentIdx).toEqual([0, 1]);
    plan = assign(plan, b, [a, b]);
    expect(plan.trips).toHaveLength(2);
  });

  it('超過 30KL 的單拆成多趟', () => {
    const a = order('st-liujia', 'diesel', 45);
    const plan = assign(duty('d2', '2026-11-02', '06:00', []), a, [a]);
    expect(plan.trips.map((t) => t.drops.map((d) => [d.quantityKL, d.compartmentIdx]))).toEqual([[[30, [0, 1]]], [[15, [0]]]]);
  });

  it('日班不把中部和南部的站併在同一趟（灌油點不同）', () => {
    const a = order('st-changhua', '92', 10);
    const b = order('st-mailiao', '92', 10);
    let plan = assign(duty('d2', '2026-11-02', '06:00', []), a, [a, b]);
    plan = assign(plan, b, [a, b]);
    expect(plan.trips).toHaveLength(2);
  });

  it('大夜班一律到 R89，可以把中部 24 小時站和南部站併在同一趟', () => {
    const a = order('st-changhua', '92', 10);
    const b = order('st-mailiao', '92', 10);
    let plan = assign(duty('d4', '2026-11-02', '00:00', []), a, [a, b]);
    plan = assign(plan, b, [a, b]);
    expect(plan.trips).toHaveLength(1);
  });

  it('已取消的訂單不能排入', () => {
    const a = order('st-changhua', '92', 10, { status: 'cancelled' });
    const result = assignOrderToDuty(duty('d1', '2026-11-02', '06:00', []), a, ctxFor([a]));
    expect(result).toEqual({ ok: false, error: '已取消的訂單不能排入班表' });
  });

  it('同一張單重複拖入會被拒絕', () => {
    const a = order('st-changhua', '92', 10);
    const plan = assign(duty('d1', '2026-11-02', '06:00', []), a, [a]);
    const again = assignOrderToDuty(plan, a, ctxFor([a]));
    expect(again.ok).toBe(false);
  });

  it('移除訂單後空的車趟一併移除', () => {
    const a = order('st-changhua', '92', 10);
    const b = order('st-miaoli', 'diesel', 10);
    let plan = assign(duty('d1', '2026-11-02', '06:00', []), a, [a, b]);
    plan = assign(plan, b, [a, b]);
    plan = removeOrderFromDuty(plan, a.id);
    expect(plan.trips).toHaveLength(1);
    expect(plan.trips[0].drops[0].orderId).toBe(b.id);
  });

  it('可以調整同一趟的送油順序', () => {
    const a = order('st-changhua', '92', 10);
    const b = order('st-qingshui', '92', 10);
    const plan = reorderDrops(duty('d1', '2026-11-02', '06:00', [trip(drop(a, [0]), drop(b, [1]))]), 0, 1, 0);
    expect(plan.trips[0].drops.map((d) => d.stationId)).toEqual(['st-qingshui', 'st-changhua']);
  });
});

describe('裝載限制檢查', () => {
  it('正常的車趟沒有問題', () => {
    const a = order('st-changhua', '92', 15);
    const b = order('st-changhua', '95', 15);
    expect(validateTripLoading(trip(drop(a, [0]), drop(b, [1])), 0, [15, 15], ctxFor([a, b]))).toEqual([]);
  });

  it('同一趟裝汽油和柴油', () => {
    const a = order('st-changhua', '92', 10);
    const b = order('st-changhua', 'diesel', 10);
    const issues = validateTripLoading(trip(drop(a, [0]), drop(b, [1])), 0, [15, 15], ctxFor([a, b]));
    expect(issues.map((i) => i.message)).toEqual(['第 1 趟：同一趟不能同時裝汽油和柴油']);
    expect(issues[0].level).toBe('block');
  });

  it('一艙分給兩張單', () => {
    const a = order('st-changhua', '92', 5);
    const b = order('st-changhua', '95', 5);
    const issues = validateTripLoading(trip(drop(a, [0]), drop(b, [0])), 0, [15, 15], ctxFor([a, b]));
    expect(issues.map((i) => i.message)).toEqual(['第 1 趟：第 1 艙同時分配給兩張訂單']);
  });

  it('超過艙位容量', () => {
    const a = order('st-changhua', '92', 20);
    const issues = validateTripLoading(trip(drop(a, [0])), 0, [15, 15], ctxFor([a]));
    expect(issues[0].message).toContain('超過分配艙位容量 15KL');
  });

  it('超過每趟站數上限', () => {
    const a = order('st-changhua', '92', 5);
    const b = order('st-qingshui', '92', 5);
    const c = order('st-miaoli', '92', 5);
    const issues = validateTripLoading(trip(drop(a, [0]), drop(b, [1]), drop(c, [2])), 0, [10, 10, 10], ctxFor([a, b, c]));
    expect(issues.map((i) => i.message)).toEqual(['第 1 趟：送 3 站，超過每趟上限 2 站']);
  });
});
