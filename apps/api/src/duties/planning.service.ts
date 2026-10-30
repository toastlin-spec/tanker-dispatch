import { Injectable } from '@nestjs/common';
import { Prisma, type Order as DbOrder } from '@prisma/client';
import { addDays, type DateString, type DutyPlan, type DutyStatus, type Order, type OrderStatus, type PlanningData, type Product } from '@tanker/core';
import { fromDbDate, toDbDate } from '../common/dates';
import { MasterService } from '../master/master.service';
import { PrismaService } from '../prisma.service';

export const dutyInclude = {
  trips: { orderBy: { seq: 'asc' }, include: { drops: { orderBy: { seq: 'asc' } } } },
} satisfies Prisma.DutyInclude;

export type DbDutyWithTrips = Prisma.DutyGetPayload<{ include: typeof dutyInclude }>;

export function toCoreDuty(d: DbDutyWithTrips): DutyPlan & { publishedAt: string | null } {
  return {
    id: d.id,
    driverId: d.driverId,
    date: fromDbDate(d.date),
    startTime: d.startTime,
    vehicleId: d.vehicleId,
    status: d.status as DutyStatus,
    publishedAt: d.publishedAt ? d.publishedAt.toISOString() : null,
    trips: d.trips.map((t) => ({
      id: t.id,
      loadingId: t.loadingId,
      drops: t.drops.map((p) => ({
        orderId: p.orderId,
        stationId: p.stationId,
        quantityKL: p.quantityKL,
        compartmentIdx: p.compartmentIdx,
      })),
    })),
  };
}

export function toCoreOrder(o: DbOrder): Order {
  return {
    id: o.id,
    stationId: o.stationId,
    date: fromDbDate(o.date),
    product: o.product as Product,
    quantityKL: o.quantityKL,
    windowStart: o.windowStart,
    windowEnd: o.windowEnd,
    status: o.status as OrderStatus,
    note: o.note,
  };
}

/** 載入計算某一天需要的全部資料：主檔、前後日期的班表（跨日規則）、同月份的班表（加班）與相關訂單。 */
@Injectable()
export class PlanningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly master: MasterService,
  ) {}

  window(date: DateString, consecutiveDays: number): { from: DateString; to: DateString } {
    const span = Math.max(consecutiveDays, 7) + 1;
    const monthStart = `${date.slice(0, 7)}-01`;
    const monthEnd = addDays(addDays(monthStart, 32).slice(0, 7) + '-01', -1);
    const before = addDays(date, -span);
    const after = addDays(date, span);
    return { from: before < monthStart ? before : monthStart, to: after > monthEnd ? after : monthEnd };
  }

  async load(date: DateString) {
    const master = await this.master.getPlanningMaster();
    const { from, to } = this.window(date, master.settings.rules.maxConsecutiveWorkDays.value);
    const duties = await this.prisma.duty.findMany({
      where: { date: { gte: toDbDate(from), lte: toDbDate(to) } },
      include: dutyInclude,
      orderBy: [{ date: 'asc' }, { driverId: 'asc' }],
    });
    const referenced = new Set<string>();
    for (const d of duties) for (const t of d.trips) for (const p of t.drops) referenced.add(p.orderId);
    const orders = await this.prisma.order.findMany({
      where: { OR: [{ date: toDbDate(date) }, { id: { in: [...referenced] } }] },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    });
    const data: PlanningData = { ...master, orders: orders.map(toCoreOrder) };
    return { from, to, data, duties: duties.map(toCoreDuty) };
  }
}
