import fleetJson from '../../../data/fleet.json';
import legsJson from '../../../data/legs.json';
import locationsJson from '../../../data/locations.json';
import settingsJson from '../../../data/settings.json';
import { createContext, expandLegs } from '../src';
import type { DropPlan, DutyPlan, LegInput, Location, Order, PlanningData, Product, Settings, TripPlan } from '../src';

/**
 * 測試用固定資料：直接讀 `data/` 的初始資料，確保規格書範例和實際資料一致。
 * settings.json 沒有的欄位（日班預設出車時間、每趟站數、每日正常工時）在這裡補上，
 * 與 API seed 的預設值相同。
 */
export function baseSettings(): Settings {
  const raw = structuredClone(settingsJson) as unknown as Settings;
  return {
    ...raw,
    dayShift: { defaultStartTime: '06:00' },
    trip: { maxStopsPerTrip: 2 },
    rules: {
      ...raw.rules,
      monthlyOvertimeHours: { ...raw.rules.monthlyOvertimeHours, normalDailyHours: 8 },
    },
  };
}

export function baseData(orders: Order[] = [], settings: Settings = baseSettings()): PlanningData {
  return {
    locations: locationsJson as unknown as Location[],
    legs: expandLegs(legsJson.legs as LegInput[]),
    settings,
    drivers: fleetJson.drivers.map((d) => ({ ...d, shift: d.shift as 'day' | 'night', active: true })),
    vehicles: fleetJson.vehicles.map((v) => ({ ...v, compartmentsKL: v.compartmentsKL })),
    orders,
  };
}

export function ctxFor(orders: Order[] = [], settings?: Settings) {
  return createContext(baseData(orders, settings));
}

let seq = 0;
export function order(stationId: string, product: Product, quantityKL: number, extra: Partial<Order> = {}): Order {
  seq += 1;
  return { id: `o${seq}`, stationId, date: '2026-11-02', product, quantityKL, status: 'pending', ...extra };
}

export function drop(o: Order, compartmentIdx: number[] = [0], quantityKL = o.quantityKL): DropPlan {
  return { orderId: o.id, stationId: o.stationId, quantityKL, compartmentIdx };
}

export function trip(...drops: DropPlan[]): TripPlan {
  return { loadingId: null, drops };
}

export function duty(driverId: string, date: string, startTime: string, trips: TripPlan[], id = `${driverId}-${date}`): DutyPlan {
  return { id, driverId, date, startTime, status: 'draft', trips };
}
