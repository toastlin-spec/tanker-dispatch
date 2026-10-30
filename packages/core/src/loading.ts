import { autoLoadingIdForStation, locationName, resolveDuty, resolveTripLoadingId, type PlanningContext } from './context';
import type { DropPlan, DutyPlan, Issue, Order, Product, ProductFamily, TripPlan } from './types';

const KL_EPSILON = 1e-6;

export function productFamily(product: Product): ProductFamily {
  return product === 'diesel' ? 'diesel' : 'gasoline';
}

export const PRODUCT_LABELS: Record<Product, string> = { '92': '92 無鉛', '95': '95 無鉛', diesel: '柴油' };
export const PRODUCT_FAMILY_LABELS: Record<ProductFamily, string> = { gasoline: '汽油', diesel: '柴油' };

function roundKL(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** 超過一趟容量的訂單拆成多份，例如 40KL、容量 30KL → [30, 10]。 */
export function splitIntoChunks(quantityKL: number, tripCapacityKL: number): number[] {
  if (!(tripCapacityKL > 0)) throw new Error('車輛容量必須大於 0');
  const chunks: number[] = [];
  let remaining = roundKL(quantityKL);
  while (remaining > tripCapacityKL + KL_EPSILON) {
    chunks.push(tripCapacityKL);
    remaining = roundKL(remaining - tripCapacityKL);
  }
  if (remaining > KL_EPSILON) chunks.push(remaining);
  return chunks;
}

/**
 * 從可用艙位中挑出能裝下指定量的組合：艙數最少優先，其次總容量最小，再來是索引較小。
 * 一艙只供應一張訂單，所以 15KL 以下用一艙、15～30KL 用兩艙。
 */
export function pickCompartments(capacities: number[], freeIdx: number[], quantityKL: number): number[] | null {
  const n = freeIdx.length;
  let best: { idx: number[]; total: number } | null = null;
  for (let mask = 1; mask < 1 << n; mask++) {
    const idx: number[] = [];
    let total = 0;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        idx.push(freeIdx[i]);
        total += capacities[freeIdx[i]];
      }
    }
    if (total + KL_EPSILON < quantityKL) continue;
    idx.sort((a, b) => a - b);
    if (
      !best ||
      idx.length < best.idx.length ||
      (idx.length === best.idx.length && total < best.total) ||
      (idx.length === best.idx.length && total === best.total && idx.join(',') < best.idx.join(','))
    ) {
      best = { idx, total };
    }
  }
  return best ? best.idx : null;
}

/** 每個艙實際裝的量（依艙位順序裝滿）。 */
export function compartmentLoads(drop: DropPlan, capacities: number[]): { idx: number; quantityKL: number }[] {
  let remaining = drop.quantityKL;
  return drop.compartmentIdx.map((idx) => {
    const q = Math.min(capacities[idx] ?? 0, Math.max(remaining, 0));
    remaining = roundKL(remaining - q);
    return { idx, quantityKL: roundKL(q) };
  });
}

export function usedCompartments(trip: TripPlan): Set<number> {
  const used = new Set<number>();
  for (const d of trip.drops) for (const i of d.compartmentIdx) used.add(i);
  return used;
}

export function tripFamily(trip: TripPlan, ctx: PlanningContext): ProductFamily | null {
  for (const d of trip.drops) {
    const order = ctx.orders.get(d.orderId);
    if (order) return productFamily(order.product);
  }
  return null;
}

export function distinctStations(trip: TripPlan): string[] {
  const seen: string[] = [];
  for (const d of trip.drops) if (!seen.includes(d.stationId)) seen.push(d.stationId);
  return seen;
}

export function assignedQuantity(plan: DutyPlan, orderId: string): number {
  let sum = 0;
  for (const t of plan.trips) for (const d of t.drops) if (d.orderId === orderId) sum += d.quantityKL;
  return roundKL(sum);
}

export function dutyOrderIds(plan: DutyPlan): string[] {
  const ids: string[] = [];
  for (const t of plan.trips) for (const d of t.drops) if (!ids.includes(d.orderId)) ids.push(d.orderId);
  return ids;
}

function cloneDuty(plan: DutyPlan): DutyPlan {
  return {
    ...plan,
    trips: plan.trips.map((t) => ({ ...t, drops: t.drops.map((d) => ({ ...d, compartmentIdx: [...d.compartmentIdx] })) })),
  };
}

export type AssignResult = { ok: true; plan: DutyPlan; tripIndexes: number[] } | { ok: false; error: string };

/**
 * 把訂單排進司機的班表（看板拖曳時使用）：
 * 先試著併入既有車趟（同油品類別、同灌油點、站數不超過上限、空艙裝得下），
 * 優先併入已有同一站的車趟；裝不下就在最後新增一趟。超過一趟容量的訂單會拆成多趟。
 */
export function assignOrderToDuty(plan: DutyPlan, order: Order, ctx: PlanningContext): AssignResult {
  if (order.status === 'cancelled') return { ok: false, error: '已取消的訂單不能排入班表' };
  if (order.status === 'completed') return { ok: false, error: '已完成的訂單不能排入班表' };
  if (!(order.quantityKL > 0)) return { ok: false, error: '訂單數量必須大於 0' };
  const station = ctx.locations.get(order.stationId);
  if (!station || station.type !== 'station') return { ok: false, error: `找不到油站：${order.stationId}` };

  const resolved = resolveDuty(plan, ctx);
  const capacities = resolved.compartmentsKL;
  const tripCapacity = roundKL(capacities.reduce((a, b) => a + b, 0));
  const maxStops = ctx.settings.trip.maxStopsPerTrip;
  const remaining = roundKL(order.quantityKL - assignedQuantity(plan, order.id));
  if (remaining <= KL_EPSILON) return { ok: false, error: '此訂單已全部排入這個班表' };

  const family = productFamily(order.product);
  const wantLoading = autoLoadingIdForStation(order.stationId, resolved.shift, resolved.depotId, ctx);
  const next = cloneDuty(plan);
  const touched: number[] = [];

  for (const chunk of splitIntoChunks(remaining, tripCapacity)) {
    const candidates = next.trips
      .map((trip, index) => ({ trip, index }))
      .sort((a, b) => {
        const aSame = a.trip.drops.some((d) => d.stationId === order.stationId) ? 0 : 1;
        const bSame = b.trip.drops.some((d) => d.stationId === order.stationId) ? 0 : 1;
        return aSame - bSame || a.index - b.index;
      });

    let placed = false;
    for (const { trip, index } of candidates) {
      if (trip.drops.length === 0) continue;
      if (trip.drops.some((d) => d.orderId === order.id)) continue;
      const fam = tripFamily(trip, ctx);
      if (fam && fam !== family) continue;
      if (resolveTripLoadingId(trip, resolved.shift, resolved.depotId, ctx) !== wantLoading) continue;
      const stations = distinctStations(trip);
      if (!stations.includes(order.stationId) && stations.length + 1 > maxStops) continue;
      const used = usedCompartments(trip);
      const free = capacities.map((_, i) => i).filter((i) => !used.has(i));
      const idx = pickCompartments(capacities, free, chunk);
      if (!idx) continue;
      const drop: DropPlan = { orderId: order.id, stationId: order.stationId, quantityKL: chunk, compartmentIdx: idx };
      const lastSame = trip.drops.map((d) => d.stationId).lastIndexOf(order.stationId);
      if (lastSame >= 0) trip.drops.splice(lastSame + 1, 0, drop);
      else trip.drops.push(drop);
      touched.push(index);
      placed = true;
      break;
    }
    if (placed) continue;

    const idx = pickCompartments(capacities, capacities.map((_, i) => i), chunk);
    if (!idx) return { ok: false, error: `車輛艙位裝不下 ${chunk}KL` };
    next.trips.push({
      loadingId: null,
      drops: [{ orderId: order.id, stationId: order.stationId, quantityKL: chunk, compartmentIdx: idx }],
    });
    touched.push(next.trips.length - 1);
  }
  return { ok: true, plan: next, tripIndexes: touched };
}

/** 從班表移除訂單；車趟變空時一併移除。 */
export function removeOrderFromDuty(plan: DutyPlan, orderId: string): DutyPlan {
  const next = cloneDuty(plan);
  next.trips = next.trips
    .map((t) => ({ ...t, drops: t.drops.filter((d) => d.orderId !== orderId) }))
    .filter((t) => t.drops.length > 0);
  return next;
}

function moveItem<T>(list: T[], from: number, to: number): T[] {
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

/** 調整同一趟內的送油順序。 */
export function reorderDrops(plan: DutyPlan, tripIndex: number, from: number, to: number): DutyPlan {
  const next = cloneDuty(plan);
  const trip = next.trips[tripIndex];
  if (!trip) return next;
  trip.drops = moveItem(trip.drops, from, to);
  return next;
}

export function reorderTrips(plan: DutyPlan, from: number, to: number): DutyPlan {
  const next = cloneDuty(plan);
  next.trips = moveItem(next.trips, from, to);
  return next;
}

/** 手動指定灌油點；傳 null 回到自動選擇。 */
export function setTripLoading(plan: DutyPlan, tripIndex: number, loadingId: string | null): DutyPlan {
  const next = cloneDuty(plan);
  if (next.trips[tripIndex]) next.trips[tripIndex].loadingId = loadingId;
  return next;
}

/**
 * 檢查一趟的裝載限制（規格書第 4 節）：汽油柴油不同趟、一艙一張單、艙位容量、每趟站數。
 * 這些是車輛的物理限制，一律為阻擋。
 */
export function validateTripLoading(trip: TripPlan, tripIndex: number, capacities: number[], ctx: PlanningContext): Issue[] {
  const issues: Issue[] = [];
  const label = `第 ${tripIndex + 1} 趟`;
  const block = (message: string, suggestion?: string) =>
    issues.push({ rule: 'loading', level: 'block', message, suggestion, tripIndex });

  const families = new Set<ProductFamily>();
  const usedBy = new Map<number, string>();
  for (const drop of trip.drops) {
    const order = ctx.orders.get(drop.orderId);
    const stationName = locationName(ctx, drop.stationId);
    if (!order) {
      block(`${label}：找不到訂單 ${drop.orderId}`);
      continue;
    }
    if (order.status === 'cancelled') block(`${label}：${stationName}的訂單已取消`, '請從班表移除這張訂單');
    if (order.stationId !== drop.stationId) block(`${label}：訂單油站與卸油地點不一致`);
    families.add(productFamily(order.product));

    if (drop.compartmentIdx.length === 0) block(`${label}：${stationName}沒有分配艙位`);
    let capacity = 0;
    for (const idx of drop.compartmentIdx) {
      if (idx < 0 || idx >= capacities.length) {
        block(`${label}：艙位 ${idx + 1} 不存在（車輛只有 ${capacities.length} 艙）`, '請移除後重新排入');
        continue;
      }
      if (usedBy.has(idx)) {
        block(`${label}：第 ${idx + 1} 艙同時分配給兩張訂單`, '一艙只能供應一張訂單');
      }
      usedBy.set(idx, drop.orderId);
      capacity += capacities[idx];
    }
    if (drop.quantityKL > capacity + KL_EPSILON) {
      block(`${label}：${stationName} ${drop.quantityKL}KL 超過分配艙位容量 ${capacity}KL`, '請移除後重新排入，系統會重新分配艙位或拆趟');
    }
  }
  if (families.size > 1) {
    block(`${label}：同一趟不能同時裝汽油和柴油`, '請把汽油與柴油的訂單拆到不同車趟');
  }
  const maxStops = ctx.settings.trip.maxStopsPerTrip;
  const stops = distinctStations(trip).length;
  if (stops > maxStops) {
    block(`${label}：送 ${stops} 站，超過每趟上限 ${maxStops} 站`, '請把部分訂單移到其他車趟');
  }
  return issues;
}
