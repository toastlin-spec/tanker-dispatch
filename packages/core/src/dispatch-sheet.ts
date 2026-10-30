import { locationName, type PlanningContext } from './context';
import { SEGMENT_LABELS, SHIFT_LABELS } from './labels';
import { PRODUCT_LABELS, compartmentLoads } from './loading';
import { formatDuration, formatMinutes } from './time';
import type { DateString, DutyEvaluation, IssueLevel, SegmentKind } from './types';

export interface DispatchSheetRow {
  start: string;
  end: string;
  kind: SegmentKind;
  kindLabel: string;
  place: string;
  detail: string;
}

export interface DispatchSheetTrip {
  index: number;
  loadingName: string;
  compartments: { compartment: number; product: string; quantityKL: number; stationName: string }[];
}

/** 派車單內容：發布時存成快照，列印頁直接顯示。 */
export interface DispatchSheet {
  dutyId: string;
  date: DateString;
  driverName: string;
  shiftLabel: string;
  depotName: string;
  vehicle: { name: string; tractorPlate: string | null; trailerPlate: string | null; compartmentsKL: number[] } | null;
  start: string;
  end: string | null;
  totalKL: number;
  /** 單數（車趟數）。 */
  tripCount: number;
  rows: DispatchSheetRow[];
  trips: DispatchSheetTrip[];
  missingLegs: string[];
  issues: { level: IssueLevel; message: string }[];
}

export function buildDispatchSheet(evaluation: DutyEvaluation, ctx: PlanningContext): DispatchSheet {
  const { duty, timeline } = evaluation;
  const driver = ctx.drivers.get(duty.driverId);
  const vehicle = evaluation.vehicleId ? ctx.vehicles.get(evaluation.vehicleId) : undefined;
  const name = (id?: string) => (id ? locationName(ctx, id) : '');
  const trips = duty.trips.filter((t) => t.drops.length > 0);

  const productText = (orderId: string, quantityKL: number) => {
    const order = ctx.orders.get(orderId);
    return `${order ? PRODUCT_LABELS[order.product] : '?'} ${quantityKL}KL`;
  };

  const rows: DispatchSheetRow[] = timeline.segments.map((s) => {
    let place = name(s.locationId);
    let detail = '';
    if (s.kind === 'drive') place = `${name(s.fromId)}→${name(s.toId)}`;
    if (s.kind === 'wait') detail = `等待開門 ${formatDuration(s.end - s.start)}`;
    if (s.kind === 'load' && s.tripIndex !== null) {
      const trip = trips[s.tripIndex];
      detail = trip
        ? trip.drops.map((d) => `${productText(d.orderId, d.quantityKL)}（第 ${d.compartmentIdx.map((i) => i + 1).join('、')} 艙）`).join('、')
        : '';
    }
    if (s.kind === 'unload' && s.tripIndex !== null) {
      const trip = trips[s.tripIndex];
      const drops = trip ? trip.drops.filter((d) => d.stationId === s.locationId && (s.orderIds ?? []).includes(d.orderId)) : [];
      detail = drops.map((d) => productText(d.orderId, d.quantityKL)).join('、');
    }
    return {
      start: formatMinutes(s.start),
      end: formatMinutes(s.end),
      kind: s.kind,
      kindLabel: SEGMENT_LABELS[s.kind],
      place,
      detail,
    };
  });

  const sheetTrips: DispatchSheetTrip[] = trips.map((trip, index) => ({
    index,
    loadingName: name(timeline.tripLoadingIds[index]),
    compartments: trip.drops.flatMap((d) => {
      const order = ctx.orders.get(d.orderId);
      return compartmentLoads(d, evaluation.compartmentsKL).map((c) => ({
        compartment: c.idx + 1,
        product: order ? PRODUCT_LABELS[order.product] : '?',
        quantityKL: c.quantityKL,
        stationName: name(d.stationId),
      }));
    }),
  }));

  const totalKL = trips.reduce((sum, t) => sum + t.drops.reduce((s, d) => s + d.quantityKL, 0), 0);

  return {
    dutyId: duty.id,
    date: duty.date,
    driverName: driver?.name ?? duty.driverId,
    shiftLabel: SHIFT_LABELS[timeline.shift],
    depotName: name(timeline.depotId),
    vehicle: vehicle
      ? { name: vehicle.name, tractorPlate: vehicle.tractorPlate, trailerPlate: vehicle.trailerPlate, compartmentsKL: evaluation.compartmentsKL }
      : null,
    start: formatMinutes(timeline.start),
    end: timeline.end === null ? null : formatMinutes(timeline.end),
    totalKL: Math.round(totalKL * 1000) / 1000,
    tripCount: evaluation.tripCount,
    rows,
    trips: sheetTrips,
    missingLegs: timeline.missingLegs.map((l) => `${name(l.fromId)}→${name(l.toId)}`),
    issues: evaluation.issues.filter((i) => i.level !== 'info').map((i) => ({ level: i.level, message: i.message })),
  };
}
