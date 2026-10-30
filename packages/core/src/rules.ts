import { locationName, resolveDuty, type PlanningContext } from './context';
import { dutyOrderIds, dutyTripCount, validateTripLoading } from './loading';
import { missingLegMessage } from './legs';
import { absoluteMinutes, addDays, dayNumber, formatDateShort, formatDuration, formatMinutes, monthOf, parseTime } from './time';
import { buildTimeline } from './timeline';
import type {
  DateString,
  DutyEvaluation,
  DutyPlan,
  DutyStatusColor,
  DutyTimeline,
  Issue,
  IssueLevel,
  RuleKey,
  RuleLevel,
  RulesSettings,
} from './types';

export const RULE_LABELS: Record<RuleKey, string> = {
  maxConsecutiveWorkDays: '做六休一',
  minRestBetweenDutiesHours: '兩天之間休息',
  stationOpeningHours: '油站營業時間',
  missingLeg: '缺少路段時間',
  orderCaps: '每日單數上限',
  dailyDrivingHours: '每日駕車時數',
  continuousDriving: '連續駕車',
  dailyWorkHours: '每日工時',
  monthlyOvertimeHours: '每月加班',
};

export const RULE_DESCRIPTIONS: Record<RuleKey, string> = {
  maxConsecutiveWorkDays: '同一司機連續有班的日曆天數上限',
  minRestBetweenDutiesHours: '前一天最後一趟回到出發廠，到隔天第一趟出車的最少間隔（跨日檢查，大夜班也適用）',
  stationOpeningHours: '卸油不能超過關門時間（開門前會自動等待）',
  missingLeg: '無法計算時間的班表不可發布',
  orderCaps: '每日單數上限，以車趟計算：一趟送兩站算 1 單，拆成兩趟算 2 單（上限見「單數上限」）',
  dailyDrivingHours: '每日駕車時數上限（汽車運輸業管理規則第 19-2 條）',
  continuousDriving: '連續駕車時數上限與休息時間（第 19-2 條）；只有「等待」算休息，灌油卸油不算',
  dailyWorkHours: '每日工時上限，從出車算到收車（勞基法第 32 條）',
  monthlyOvertimeHours: '每月加班時數上限，超過每日正常工時的部分算加班（勞基法第 32 條）',
};

export const RULE_ORDER: RuleKey[] = [
  'maxConsecutiveWorkDays',
  'minRestBetweenDutiesHours',
  'stationOpeningHours',
  'missingLeg',
  'orderCaps',
  'dailyDrivingHours',
  'continuousDriving',
  'dailyWorkHours',
  'monthlyOvertimeHours',
];

export const ISSUE_LEVEL_LABELS: Record<IssueLevel, string> = { block: '阻擋', warn: '警告', info: '提示' };

function enabledLevel<K extends RuleKey>(rules: RulesSettings, key: K): RuleLevel | null {
  const rule = rules[key];
  return rule.enabled ? rule.level : null;
}

interface ComputedDuty {
  plan: DutyPlan;
  timeline: DutyTimeline & { errors: string[] };
  hasWork: boolean;
}

/** 前後文：其他日期與其他司機的班表，用來做跨日與跨司機的檢查。 */
class DutyBook {
  readonly computed = new Map<string, ComputedDuty>();
  private readonly byDriver = new Map<string, ComputedDuty[]>();

  constructor(duties: DutyPlan[], ctx: PlanningContext) {
    for (const plan of duties) {
      if (!ctx.drivers.has(plan.driverId)) continue;
      const timeline = buildTimeline(plan, ctx);
      const entry: ComputedDuty = { plan, timeline, hasWork: plan.trips.some((t) => t.drops.length > 0) };
      this.computed.set(plan.id, entry);
      const list = this.byDriver.get(plan.driverId) ?? [];
      list.push(entry);
      this.byDriver.set(plan.driverId, list);
    }
    for (const list of this.byDriver.values()) list.sort((a, b) => dayNumber(a.plan.date) - dayNumber(b.plan.date));
  }

  workingDuties(driverId: string): ComputedDuty[] {
    return (this.byDriver.get(driverId) ?? []).filter((d) => d.hasWork);
  }

  onDate(date: DateString): ComputedDuty[] {
    return [...this.computed.values()].filter((d) => d.plan.date === date);
  }
}

function sortIssues(issues: Issue[]): Issue[] {
  const rank: Record<IssueLevel, number> = { block: 0, warn: 1, info: 2 };
  return issues.map((issue, i) => ({ issue, i })).sort((a, b) => rank[a.issue.level] - rank[b.issue.level] || a.i - b.i).map((x) => x.issue);
}

export function statusColor(issues: Issue[]): DutyStatusColor {
  if (issues.some((i) => i.level === 'block')) return 'red';
  if (issues.some((i) => i.level === 'warn')) return 'yellow';
  return 'green';
}

function checkDuty(entry: ComputedDuty, book: DutyBook, ctx: PlanningContext): Issue[] {
  const { plan, timeline } = entry;
  const rules = ctx.settings.rules;
  const resolved = resolveDuty(plan, ctx);
  const issues: Issue[] = [];
  const name = (id: string) => locationName(ctx, id);
  const fmt = (m: number) => formatMinutes(m);

  for (const error of timeline.errors) issues.push({ rule: 'data', level: 'block', message: error });

  // 裝載限制（規格書第 4 節）。
  plan.trips
    .filter((t) => t.drops.length > 0)
    .forEach((trip, i) => issues.push(...validateTripLoading(trip, i, resolved.compartmentsKL, ctx)));

  // 缺少路段時間。規則關閉時仍以提示列出，因為時間軸無法計算。
  const missingLevel = enabledLevel(rules, 'missingLeg') ?? 'info';
  for (const leg of timeline.missingLegs) {
    issues.push({
      rule: 'missingLeg',
      level: missingLevel,
      message: missingLegMessage(name(leg.fromId), name(leg.toId)),
      suggestion: '到設定頁「路段時間」補上這個路段，班表會立即重算',
      tripIndex: leg.tripIndex ?? undefined,
      leg: { fromId: leg.fromId, toId: leg.toId },
    });
  }

  // 油站營業時間。
  const openingLevel = enabledLevel(rules, 'stationOpeningHours');
  for (const stop of timeline.stops) {
    if (stop.waitMinutes > 0) {
      issues.push({
        rule: 'stationOpeningHours',
        level: 'info',
        message: `第 ${stop.tripIndex + 1} 趟：${fmt(stop.arrival)} 抵達${name(stop.stationId)}，等待 ${formatDuration(stop.waitMinutes)}到 ${fmt(stop.unloadStart)} 開門`,
        tripIndex: stop.tripIndex,
      });
    }
    if (openingLevel && stop.closeAt !== null && stop.unloadEnd > stop.closeAt) {
      const late = stop.unloadEnd - stop.closeAt;
      issues.push({
        rule: 'stationOpeningHours',
        level: openingLevel,
        message: `第 ${stop.tripIndex + 1} 趟：${name(stop.stationId)}卸油到 ${fmt(stop.unloadEnd)}，超過關門時間 ${fmt(stop.closeAt)}（晚 ${formatDuration(late)}）`,
        suggestion:
          resolved.shift === 'night'
            ? '大夜班出車時間固定，請調整送油順序或改派日班司機'
            : `出車時間至少提早 ${formatDuration(late)}，或調整送油順序、改派其他司機`,
        tripIndex: stop.tripIndex,
      });
    }
  }

  // 希望到達時段（選填，只做提示）。
  for (const stop of timeline.stops) {
    for (const orderId of stop.orderIds) {
      const order = ctx.orders.get(orderId);
      if (!order) continue;
      const from = order.windowStart ? parseTime(order.windowStart) : null;
      const to = order.windowEnd ? parseTime(order.windowEnd) : null;
      const at = stop.unloadStart;
      if ((from !== null && at < from) || (to !== null && at > to)) {
        issues.push({
          rule: 'orderWindow',
          level: 'info',
          message: `${name(stop.stationId)}希望 ${order.windowStart ?? ''}～${order.windowEnd ?? ''} 到達，排定 ${fmt(at)} 開始卸油`,
          tripIndex: stop.tripIndex,
        });
      }
    }
  }

  // 訂單日期與班表日期不同（只做提示）。
  for (const orderId of dutyOrderIds(plan)) {
    const order = ctx.orders.get(orderId);
    if (order && order.date !== plan.date) {
      issues.push({ rule: 'data', level: 'info', message: `${name(order.stationId)}的訂單日期是 ${formatDateShort(order.date)}，與班表日期不同` });
    }
  }

  // 每日單數上限：單數以車趟計算。
  const capsLevel = enabledLevel(rules, 'orderCaps');
  if (capsLevel && entry.hasWork) {
    const count = dutyTripCount(plan);
    for (const cap of ctx.settings.orderCaps) {
      if (cap.depotId !== resolved.depotId) continue;
      if (cap.scope === 'perDriver' && count > cap.maxOrders) {
        issues.push({
          rule: 'orderCaps',
          level: capsLevel,
          message: `今日 ${count} 單，超過${name(cap.depotId)}每位司機每日上限 ${cap.maxOrders} 單`,
          suggestion: '把部分車趟改派其他司機或其他日期，或把同一區的兩站併成一趟',
        });
      }
      if (cap.scope === 'depotTotal') {
        let total = 0;
        for (const other of book.onDate(plan.date)) {
          if (ctx.drivers.get(other.plan.driverId)?.homeDepotId !== cap.depotId) continue;
          total += dutyTripCount(other.plan);
        }
        if (total > cap.maxOrders) {
          issues.push({
            rule: 'orderCaps',
            level: capsLevel,
            message: `${name(cap.depotId)}今日合計 ${total} 單，超過上限 ${cap.maxOrders} 單`,
            suggestion: '把部分車趟改派其他廠或其他日期，或把同一區的兩站併成一趟',
          });
        }
      }
    }
  }

  if (!entry.hasWork) return issues;
  const working = book.workingDuties(plan.driverId);

  // 做六休一：連續有班的日曆天數。
  const consecutive = rules.maxConsecutiveWorkDays;
  if (consecutive.enabled) {
    const days = new Set(working.map((d) => dayNumber(d.plan.date)));
    const today = dayNumber(plan.date);
    let first = today;
    let last = today;
    while (days.has(first - 1)) first--;
    while (days.has(last + 1)) last++;
    const run = last - first + 1;
    if (run > consecutive.value) {
      const startDate = addDays(plan.date, first - today);
      const endDate = addDays(plan.date, last - today);
      issues.push({
        rule: 'maxConsecutiveWorkDays',
        level: consecutive.level,
        message: `連續上班 ${run} 天（${formatDateShort(startDate)}～${formatDateShort(endDate)}），超過上限 ${consecutive.value} 天`,
        suggestion: `這段期間至少要排 ${run - consecutive.value} 天休息`,
      });
    }
  }

  // 兩天之間休息：前一個班表收車到這個班表出車、這個班表收車到下一個班表出車。
  const rest = rules.minRestBetweenDutiesHours;
  if (rest.enabled) {
    const minRest = rest.value * 60;
    const idx = working.findIndex((d) => d.plan.id === plan.id);
    const prev = idx > 0 ? working[idx - 1] : undefined;
    const next = idx >= 0 && idx < working.length - 1 ? working[idx + 1] : undefined;
    const startAbs = absoluteMinutes(plan.date, timeline.start);
    const endAbs = timeline.end === null ? null : absoluteMinutes(plan.date, timeline.end);
    if (prev) {
      const prevEnd = prev.timeline.end === null ? null : absoluteMinutes(prev.plan.date, prev.timeline.end);
      if (prevEnd === null) {
        issues.push({
          rule: 'minRestBetweenDutiesHours',
          level: rest.level,
          message: `無法檢查與 ${formatDateShort(prev.plan.date)} 班表的休息間隔：那天的班表缺少路段時間`,
          suggestion: '先補上那天班表缺少的路段時間',
        });
      } else if (startAbs - prevEnd < minRest) {
        const earliest = prevEnd + minRest - dayNumber(plan.date) * 1440;
        issues.push({
          rule: 'minRestBetweenDutiesHours',
          level: rest.level,
          message: `與 ${formatDateShort(prev.plan.date)} 收車（${formatMinutes(prevEnd - dayNumber(prev.plan.date) * 1440)}）只間隔 ${formatDuration(startAbs - prevEnd)}，至少需 ${rest.value} 小時`,
          suggestion:
            resolved.shift === 'night'
              ? `大夜班出車時間固定，請讓 ${formatDateShort(prev.plan.date)} 的班表提早收車`
              : `出車時間不要早於 ${formatMinutes(earliest)}`,
        });
      }
    }
    if (next && endAbs !== null) {
      const nextStart = absoluteMinutes(next.plan.date, next.timeline.start);
      if (nextStart - endAbs < minRest) {
        issues.push({
          rule: 'minRestBetweenDutiesHours',
          level: rest.level,
          message: `收車到 ${formatDateShort(next.plan.date)} 出車（${formatMinutes(next.timeline.start)}）只間隔 ${formatDuration(nextStart - endAbs)}，至少需 ${rest.value} 小時`,
          suggestion: `今天至少要提早 ${formatDuration(minRest - (nextStart - endAbs))}收車，或延後 ${formatDateShort(next.plan.date)} 的出車時間`,
        });
      }
    } else if (next && endAbs === null) {
      issues.push({
        rule: 'minRestBetweenDutiesHours',
        level: rest.level,
        message: `無法檢查與 ${formatDateShort(next.plan.date)} 班表的休息間隔：今天的班表缺少路段時間`,
        suggestion: '先補上缺少的路段時間',
      });
    }
  }

  // 每日駕車時數（預設關閉）。
  const driving = rules.dailyDrivingHours;
  if (driving.enabled && timeline.drivingMinutes > driving.value * 60) {
    issues.push({
      rule: 'dailyDrivingHours',
      level: driving.level,
      message: `今日駕車 ${formatDuration(timeline.drivingMinutes)}，超過 ${driving.value} 小時`,
      suggestion: '減少車趟或改派其他司機',
    });
  }

  // 連續駕車（預設關閉）：只有長度足夠的「等待」算休息。
  const continuous = rules.continuousDriving;
  if (continuous.enabled) {
    let acc = 0;
    for (const seg of timeline.segments) {
      if (seg.kind === 'drive') {
        acc += seg.end - seg.start;
        if (acc > continuous.maxHours * 60) {
          issues.push({
            rule: 'continuousDriving',
            level: continuous.level,
            message: `${formatMinutes(seg.end)} 前已連續駕車 ${formatDuration(acc)}，超過 ${continuous.maxHours} 小時未休息 ${continuous.breakMinutes} 分`,
            suggestion: `在 ${formatMinutes(seg.end - (acc - continuous.maxHours * 60))} 之前安排至少 ${continuous.breakMinutes} 分休息`,
            tripIndex: seg.tripIndex ?? undefined,
          });
          break;
        }
      } else if (seg.kind === 'wait' && seg.end - seg.start >= continuous.breakMinutes) {
        acc = 0;
      }
    }
  }

  // 每日工時（預設關閉）：出車到收車。
  const work = rules.dailyWorkHours;
  if (work.enabled && timeline.end !== null && timeline.end - timeline.start > work.value * 60) {
    issues.push({
      rule: 'dailyWorkHours',
      level: work.level,
      message: `今日工時 ${formatDuration(timeline.end - timeline.start)}，超過 ${work.value} 小時`,
      suggestion: '減少車趟或改派其他司機',
    });
  }

  // 每月加班（預設關閉）：同月份每個班表超過每日正常工時的部分。
  const overtime = rules.monthlyOvertimeHours;
  if (overtime.enabled) {
    const month = monthOf(plan.date);
    let total = 0;
    for (const d of working) {
      if (monthOf(d.plan.date) !== month || d.timeline.end === null) continue;
      total += Math.max(0, d.timeline.end - d.timeline.start - overtime.normalDailyHours * 60);
    }
    if (total > overtime.value * 60) {
      issues.push({
        rule: 'monthlyOvertimeHours',
        level: overtime.level,
        message: `${month.replace('-', ' 年 ')} 月加班合計 ${formatDuration(total)}，超過 ${overtime.value} 小時`,
        suggestion: '減少本月的車趟或改派其他司機',
      });
    }
  }

  return issues;
}

/**
 * 檢查一組班表。`duties` 要包含前後日期與同日其他司機的班表，跨日與跨司機的規則才算得出來；
 * `targetDates` 指定要回傳哪些日期的結果（預設全部）。
 */
export function evaluateDuties(
  duties: DutyPlan[],
  ctx: PlanningContext,
  targetDates?: DateString[],
): Map<string, DutyEvaluation> {
  const book = new DutyBook(duties, ctx);
  const targets = targetDates ? new Set(targetDates) : null;

  // 訂單排入量是否與訂單量一致（可能分散在多個班表）。
  const assigned = new Map<string, number>();
  for (const { plan } of book.computed.values()) {
    for (const t of plan.trips) for (const d of t.drops) assigned.set(d.orderId, (assigned.get(d.orderId) ?? 0) + d.quantityKL);
  }

  const result = new Map<string, DutyEvaluation>();
  for (const entry of book.computed.values()) {
    if (targets && !targets.has(entry.plan.date)) continue;
    const resolved = resolveDuty(entry.plan, ctx);
    const issues = checkDuty(entry, book, ctx);
    for (const orderId of dutyOrderIds(entry.plan)) {
      const order = ctx.orders.get(orderId);
      if (!order) continue;
      const sum = Math.round((assigned.get(orderId) ?? 0) * 1000) / 1000;
      const station = locationName(ctx, order.stationId);
      if (sum > order.quantityKL + 1e-6) {
        issues.push({ rule: 'loading', level: 'block', message: `${station}的訂單排入 ${sum}KL，超過訂單量 ${order.quantityKL}KL`, suggestion: '請移除後重新排入' });
      } else if (sum < order.quantityKL - 1e-6) {
        issues.push({ rule: 'loading', level: 'info', message: `${station}的訂單還有 ${Math.round((order.quantityKL - sum) * 1000) / 1000}KL 沒有排入` });
      }
    }
    const sorted = sortIssues(issues);
    result.set(entry.plan.id, {
      duty: entry.plan,
      timeline: entry.timeline,
      issues: sorted,
      status: statusColor(sorted),
      tripCount: dutyTripCount(entry.plan),
      compartmentsKL: resolved.compartmentsKL,
      vehicleId: resolved.vehicleId,
    });
  }
  return result;
}

export interface PublishCheck {
  canPublish: boolean;
  needsReason: boolean;
  blocking: Issue[];
  warnings: Issue[];
}

/** 發布前檢查：有阻擋就不能發布；有警告要填原因。 */
export function checkPublish(evaluation: DutyEvaluation): PublishCheck {
  const blocking = evaluation.issues.filter((i) => i.level === 'block');
  const warnings = evaluation.issues.filter((i) => i.level === 'warn');
  return { canPublish: blocking.length === 0, needsReason: warnings.length > 0, blocking, warnings };
}
