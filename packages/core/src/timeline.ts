import { locationName, resolveDuty, resolveTripLoadingId, type PlanningContext } from './context';
import { lookupLeg } from './legs';
import { MINUTES_PER_DAY, parseTime } from './time';
import type { DutyPlan, DutyTimeline, Location, MissingLeg, Segment, StopTiming } from './types';

/**
 * 油站在指定時間點適用的營業時段（同一基準的分鐘數）。24 小時站回傳 null。
 * 取抵達當天的營業時段；關門後才抵達仍算當天（會被判定超過關門時間），不會等到隔天。
 * 支援跨午夜的營業時間（關門時間早於開門時間）。
 */
export function stationWindowAt(station: Location, at: number): { openAt: number; closeAt: number } | null {
  if (station.hours24 || !station.openTime || !station.closeTime) return null;
  const open = parseTime(station.openTime);
  let close = parseTime(station.closeTime);
  if (close <= open) close += MINUTES_PER_DAY;
  const day = Math.floor(at / MINUTES_PER_DAY);
  const prevOpen = (day - 1) * MINUTES_PER_DAY + open;
  const prevClose = (day - 1) * MINUTES_PER_DAY + close;
  if (at >= prevOpen && at < prevClose) return { openAt: prevOpen, closeAt: prevClose };
  return { openAt: day * MINUTES_PER_DAY + open, closeAt: day * MINUTES_PER_DAY + close };
}

/**
 * 組成一位司機一天的時間軸（規格書 6.3）：
 * 出車 → 灌油點灌油 → 依序送 1～2 站 →（還有下一趟就到下一趟的灌油點，最後一趟直接回出發廠）。
 * 抵達還沒開門的油站會自動插入等待。缺少路段時間時不做推估：從缺口之後的時間都視為無法計算。
 */
export function buildTimeline(plan: DutyPlan, ctx: PlanningContext): DutyTimeline & { errors: string[] } {
  const resolved = resolveDuty(plan, ctx);
  const ops = ctx.settings.operations;
  const trips = plan.trips.filter((t) => t.drops.length > 0);

  const segments: Segment[] = [];
  const stops: StopTiming[] = [];
  const missingLegs: MissingLeg[] = [];
  const tripLoadingIds: string[] = [];
  const errors: string[] = [];

  let t = resolved.start;
  let known = true;
  let cur = resolved.depotId;
  let drivingMinutes = 0;

  const drive = (to: string, tripIndex: number | null) => {
    const found = lookupLeg(ctx.legIndex, cur, to);
    if (!found.ok) {
      missingLegs.push({ fromId: cur, toId: to, tripIndex });
      known = false;
    } else if (known && found.minutes > 0) {
      segments.push({ kind: 'drive', start: t, end: t + found.minutes, tripIndex, fromId: cur, toId: to, legSource: found.leg.source });
      t += found.minutes;
      drivingMinutes += found.minutes;
    }
    cur = to;
  };

  if (trips.length > 0 && ops.preTripMinutes > 0) {
    segments.push({ kind: 'pretrip', start: t, end: t + ops.preTripMinutes, tripIndex: 0, locationId: resolved.depotId });
    t += ops.preTripMinutes;
  }

  trips.forEach((trip, tripIndex) => {
    const loadingId = resolveTripLoadingId(trip, resolved.shift, resolved.depotId, ctx);
    if (!loadingId) {
      errors.push(`第 ${tripIndex + 1} 趟無法決定灌油點，請手動指定`);
      tripLoadingIds.push('');
      known = false;
      return;
    }
    tripLoadingIds.push(loadingId);
    drive(loadingId, tripIndex);
    if (known) {
      segments.push({ kind: 'load', start: t, end: t + ops.loadMinutes, tripIndex, locationId: loadingId });
      t += ops.loadMinutes;
    }

    // 同一站連續的 drop（例如 92 與 95 各一艙）只算一次卸油。
    const groups: { stationId: string; orderIds: string[] }[] = [];
    for (const drop of trip.drops) {
      const last = groups[groups.length - 1];
      if (last && last.stationId === drop.stationId) {
        if (!last.orderIds.includes(drop.orderId)) last.orderIds.push(drop.orderId);
      } else {
        groups.push({ stationId: drop.stationId, orderIds: [drop.orderId] });
      }
    }

    for (const group of groups) {
      drive(group.stationId, tripIndex);
      if (!known) continue;
      const station = ctx.locations.get(group.stationId);
      if (!station) {
        errors.push(`找不到油站：${group.stationId}`);
        known = false;
        continue;
      }
      const arrival = t;
      const window = stationWindowAt(station, arrival);
      let waitMinutes = 0;
      if (window && arrival < window.openAt) {
        waitMinutes = window.openAt - arrival;
        segments.push({ kind: 'wait', start: t, end: window.openAt, tripIndex, locationId: station.id });
        t = window.openAt;
      }
      const unloadStart = t;
      segments.push({
        kind: 'unload',
        start: t,
        end: t + ops.unloadMinutesPerStop,
        tripIndex,
        locationId: station.id,
        orderIds: group.orderIds,
      });
      t += ops.unloadMinutesPerStop;
      stops.push({
        tripIndex,
        stationId: station.id,
        orderIds: group.orderIds,
        arrival,
        waitMinutes,
        unloadStart,
        unloadEnd: t,
        openAt: window?.openAt ?? null,
        closeAt: window?.closeAt ?? null,
      });
    }
  });

  if (trips.length > 0) drive(resolved.depotId, trips.length - 1);

  return {
    dutyId: plan.id,
    driverId: plan.driverId,
    date: plan.date,
    depotId: resolved.depotId,
    shift: resolved.shift,
    start: resolved.start,
    end: known ? t : null,
    complete: known,
    segments,
    stops,
    missingLegs,
    tripLoadingIds,
    drivingMinutes,
    errors,
  };
}

/** 列出時間軸的每一個動作，給派車單與測試使用。 */
export function describeTimeline(timeline: DutyTimeline, ctx: PlanningContext): { start: number; end: number; text: string }[] {
  return timeline.segments.map((s) => {
    const name = (id?: string) => (id ? locationName(ctx, id) : '');
    let text: string;
    switch (s.kind) {
      case 'pretrip':
        text = `${name(s.locationId)}出車前檢查`;
        break;
      case 'drive':
        text = `${name(s.fromId)}→${name(s.toId)}`;
        break;
      case 'load':
        text = `${name(s.locationId)}灌油`;
        break;
      case 'unload':
        text = `${name(s.locationId)}卸油`;
        break;
      case 'wait':
        text = `${name(s.locationId)}等待開門`;
        break;
    }
    return { start: s.start, end: s.end, text };
  });
}
