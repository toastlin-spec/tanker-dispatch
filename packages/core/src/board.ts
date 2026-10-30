import { createContext, type PlanningContext } from './context';
import { dutyOrderIds } from './loading';
import { evaluateDuties } from './rules';
import type { DateString, Driver, DutyEvaluation, DutyPlan, PlanningData } from './types';

export interface BoardRow {
  driver: Driver;
  evaluation: DutyEvaluation | null;
}

export interface DepotOrderTotal {
  depotId: string;
  orderCount: number;
  maxOrders: number | null;
  scope: 'perDriver' | 'depotTotal' | null;
}

export interface BoardEvaluation {
  date: DateString;
  rows: BoardRow[];
  depotTotals: DepotOrderTotal[];
  /** 已排入當天任一班表的訂單。 */
  assignedOrderIds: Set<string>;
}

/**
 * 看板一天的計算結果：每位在職司機一列。`duties` 應包含前後日期的班表，跨日規則才算得出來。
 */
export function evaluateBoard(date: DateString, data: PlanningData, duties: DutyPlan[], ctx?: PlanningContext): BoardEvaluation {
  const context = ctx ?? createContext(data);
  const evaluations = evaluateDuties(duties, context, [date]);
  const byDriver = new Map<string, DutyEvaluation>();
  for (const ev of evaluations.values()) byDriver.set(ev.duty.driverId, ev);

  const rows: BoardRow[] = data.drivers
    .filter((d) => d.active || byDriver.has(d.id))
    .map((driver) => ({ driver, evaluation: byDriver.get(driver.id) ?? null }));

  const assignedOrderIds = new Set<string>();
  for (const ev of evaluations.values()) for (const id of dutyOrderIds(ev.duty)) assignedOrderIds.add(id);

  const depotIds = [...new Set(data.drivers.map((d) => d.homeDepotId))];
  const depotTotals = depotIds.map((depotId) => {
    const ids = new Set<string>();
    for (const row of rows) {
      if (row.driver.homeDepotId !== depotId || !row.evaluation) continue;
      for (const id of dutyOrderIds(row.evaluation.duty)) ids.add(id);
    }
    const cap = data.settings.orderCaps.find((c) => c.depotId === depotId);
    return { depotId, orderCount: ids.size, maxOrders: cap?.maxOrders ?? null, scope: cap?.scope ?? null };
  });

  return { date, rows, depotTotals, assignedOrderIds };
}
