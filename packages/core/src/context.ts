import { buildLegIndex, type LegIndex } from './legs';
import { parseTime } from './time';
import type { Driver, DutyPlan, Location, Order, PlanningData, Settings, Shift, Vehicle } from './types';

/** 建好索引的參考資料，避免每次查找都掃整個陣列。 */
export interface PlanningContext {
  data: PlanningData;
  settings: Settings;
  locations: Map<string, Location>;
  legIndex: LegIndex;
  drivers: Map<string, Driver>;
  vehicles: Map<string, Vehicle>;
  orders: Map<string, Order>;
}

export function createContext(data: PlanningData): PlanningContext {
  return {
    data,
    settings: data.settings,
    locations: new Map(data.locations.map((l) => [l.id, l])),
    legIndex: buildLegIndex(data.legs),
    drivers: new Map(data.drivers.map((d) => [d.id, d])),
    vehicles: new Map(data.vehicles.map((v) => [v.id, v])),
    orders: new Map(data.orders.map((o) => [o.id, o])),
  };
}

export function locationName(ctx: PlanningContext, id: string): string {
  return ctx.locations.get(id)?.name ?? id;
}

export interface ResolvedDuty {
  plan: DutyPlan;
  driver: Driver;
  depotId: string;
  shift: Shift;
  /** 出車時間（分鐘）。 */
  start: number;
  vehicleId: string | null;
  compartmentsKL: number[];
}

/** 由司機資料補齊班表的出發廠、班別、出車時間與艙位。 */
export function resolveDuty(plan: DutyPlan, ctx: PlanningContext): ResolvedDuty {
  const driver = ctx.drivers.get(plan.driverId);
  if (!driver) throw new Error(`找不到司機：${plan.driverId}`);
  const shift = driver.shift;
  const startTime = shift === 'night' ? ctx.settings.nightShift.startTime : plan.startTime;
  const vehicleId = plan.vehicleId ?? driver.vehicleId ?? null;
  const vehicle = vehicleId ? ctx.vehicles.get(vehicleId) : undefined;
  const compartmentsKL =
    vehicle && vehicle.compartmentsKL.length > 0 ? vehicle.compartmentsKL : ctx.settings.vehicleDefaults.compartmentsKL;
  return {
    plan,
    driver,
    depotId: driver.homeDepotId,
    shift,
    start: parseTime(startTime),
    vehicleId,
    compartmentsKL,
  };
}

/**
 * 依規格書 6.3.2 決定一趟的灌油點：
 * 手動指定 > 大夜班一律用設定的灌油點 > 第一站的預設灌油點 > 出發廠的預設灌油點。
 */
export function resolveTripLoadingId(
  trip: { loadingId: string | null; drops: { stationId: string }[] },
  shift: Shift,
  depotId: string,
  ctx: PlanningContext,
): string | null {
  if (trip.loadingId) return trip.loadingId;
  return autoLoadingIdForStation(trip.drops[0]?.stationId ?? null, shift, depotId, ctx);
}

export function autoLoadingIdForStation(
  stationId: string | null,
  shift: Shift,
  depotId: string,
  ctx: PlanningContext,
): string | null {
  if (shift === 'night') return ctx.settings.nightShift.loadingId;
  const station = stationId ? ctx.locations.get(stationId) : undefined;
  if (station?.defaultLoadingId) return station.defaultLoadingId;
  return ctx.locations.get(depotId)?.defaultLoadingId ?? null;
}
