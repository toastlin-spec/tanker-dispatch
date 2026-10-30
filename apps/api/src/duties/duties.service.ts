import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  buildDispatchSheet,
  checkPublish,
  createContext,
  evaluateDuties,
  formatDateShort,
  type DateString,
  type TripPlan,
} from '@tanker/core';
import { AuditService } from '../audit/audit.service';
import { currentUser } from '../auth/request-context';
import { fromDbDate, toDbDate } from '../common/dates';
import { MasterService } from '../master/master.service';
import { syncOrderStatuses } from '../orders/order-status';
import { PrismaService } from '../prisma.service';
import { PlanningService, dutyInclude, toCoreDuty } from './planning.service';

@Injectable()
export class DutiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planning: PlanningService,
    private readonly master: MasterService,
    private readonly audit: AuditService,
  ) {}

  /** 看板資料：這一天前後的班表與相關訂單。主檔另外由 /master 取得。 */
  async board(date: DateString) {
    const { from, to, data, duties } = await this.planning.load(date);
    return { date, from, to, duties, orders: data.orders };
  }

  async get(id: string) {
    return toCoreDuty(await this.prisma.duty.findUniqueOrThrow({ where: { id }, include: dutyInclude }));
  }

  async list(from: DateString, to: DateString) {
    const duties = await this.prisma.duty.findMany({
      where: { date: { gte: toDbDate(from), lte: toDbDate(to) } },
      include: dutyInclude,
      orderBy: [{ date: 'asc' }, { driverId: 'asc' }],
    });
    return duties.map(toCoreDuty);
  }

  async create(input: { driverId: string; date: DateString; startTime?: string }) {
    const driver = await this.prisma.driver.findUnique({ where: { id: input.driverId } });
    if (!driver) throw new BadRequestException('找不到司機');
    const existing = await this.prisma.duty.findUnique({ where: { driverId_date: { driverId: driver.id, date: toDbDate(input.date) } }, include: dutyInclude });
    if (existing) return toCoreDuty(existing);
    const settings = await this.master.getSettings();
    const startTime = driver.shift === 'night' ? settings.nightShift.startTime : input.startTime ?? settings.dayShift.defaultStartTime;
    const created = await this.prisma.duty.create({
      data: { driverId: driver.id, date: toDbDate(input.date), startTime, status: 'draft' },
      include: dutyInclude,
    });
    await this.audit.log({ action: 'duty.create', entityType: 'duty', entityId: created.id, summary: `建立班表：${driver.name} ${formatDateShort(input.date)}` });
    return toCoreDuty(created);
  }

  /** 已發布的班表被修改時改回草稿，要重新發布。 */
  private async revertIfPublished(tx: Prisma.TransactionClient, duty: { id: string; status: string; snapshot: unknown }, why: string) {
    if (duty.status !== 'published') return;
    await tx.duty.update({ where: { id: duty.id }, data: { status: 'draft', snapshot: undefined, publishedAt: null } });
    await this.audit.log({ action: 'duty.revert', entityType: 'duty', entityId: duty.id, summary: `${why}，已發布的班表改回草稿`, detail: { previousSnapshot: duty.snapshot } }, tx);
  }

  async update(id: string, input: { startTime?: string; vehicleId?: string | null }) {
    const duty = await this.prisma.duty.findUniqueOrThrow({ where: { id }, include: { driver: true } });
    const data: Prisma.DutyUpdateInput = {};
    const changes: string[] = [];
    if (input.startTime !== undefined && input.startTime !== duty.startTime) {
      if (duty.driver.shift === 'night') throw new BadRequestException('大夜班的出車時間固定，請到設定頁修改');
      data.startTime = input.startTime;
      changes.push(`出車時間 ${duty.startTime} → ${input.startTime}`);
    }
    if (input.vehicleId !== undefined && input.vehicleId !== duty.vehicleId) {
      if (input.vehicleId && !(await this.prisma.vehicle.findUnique({ where: { id: input.vehicleId } }))) {
        throw new BadRequestException('車輛不存在');
      }
      data.vehicle = input.vehicleId ? { connect: { id: input.vehicleId } } : { disconnect: true };
      changes.push(input.vehicleId ? `換掛車輛：${input.vehicleId}` : '改回固定車輛');
    }
    if (changes.length === 0) return this.get(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.duty.update({ where: { id }, data });
      await this.audit.log({ action: 'duty.update', entityType: 'duty', entityId: id, summary: `修改班表：${changes.join('、')}` }, tx);
      await this.revertIfPublished(tx, duty, '修改出車時間或車輛');
    });
    return this.get(id);
  }

  /** 整批取代班表的車趟（看板拖單、調整順序、改灌油點後送出）。 */
  async replaceTrips(id: string, trips: TripPlan[]) {
    const duty = await this.prisma.duty.findUniqueOrThrow({ where: { id }, include: { ...dutyInclude, driver: true } });
    const cleaned = trips.filter((t) => t.drops.length > 0);
    const orderIds = [...new Set(cleaned.flatMap((t) => t.drops.map((d) => d.orderId)))];
    const orders = await this.prisma.order.findMany({ where: { id: { in: orderIds } } });
    const byId = new Map(orders.map((o) => [o.id, o]));
    const loadingIds = [...new Set(cleaned.map((t) => t.loadingId).filter((v): v is string => !!v))];
    if (loadingIds.length) {
      const loadings = await this.prisma.location.findMany({ where: { id: { in: loadingIds }, type: 'loading' } });
      if (loadings.length !== loadingIds.length) throw new BadRequestException('指定的灌油點不存在');
    }
    for (const trip of cleaned) {
      for (const drop of trip.drops) {
        const order = byId.get(drop.orderId);
        if (!order) throw new BadRequestException('找不到訂單，可能已被刪除');
        if (order.status === 'cancelled' || order.status === 'completed') {
          throw new BadRequestException('已取消或已完成的訂單不能排入班表');
        }
        if (order.stationId !== drop.stationId) throw new BadRequestException('卸油地點與訂單油站不一致');
        if (!(drop.quantityKL > 0)) throw new BadRequestException('排入數量必須大於 0');
      }
    }
    // 一張訂單只能排在一個班表。
    const elsewhere = await this.prisma.drop.findMany({
      where: { orderId: { in: orderIds }, trip: { dutyId: { not: id } } },
      include: { trip: { include: { duty: { include: { driver: true } } } } },
    });
    if (elsewhere.length) {
      const d = elsewhere[0].trip.duty;
      throw new BadRequestException(`訂單已排在${d.driver.name} ${formatDateShort(fromDbDate(d.date))} 的班表，請先從那裡移除`);
    }

    const previousOrderIds = duty.trips.flatMap((t) => t.drops.map((d) => d.orderId));
    await this.prisma.$transaction(async (tx) => {
      await tx.trip.deleteMany({ where: { dutyId: id } });
      for (const [seq, trip] of cleaned.entries()) {
        await tx.trip.create({
          data: {
            dutyId: id,
            seq,
            loadingId: trip.loadingId ?? null,
            drops: {
              create: trip.drops.map((d, i) => ({
                seq: i,
                orderId: d.orderId,
                stationId: d.stationId,
                quantityKL: d.quantityKL,
                compartmentIdx: d.compartmentIdx,
              })),
            },
          },
        });
      }
      await syncOrderStatuses(tx, [...previousOrderIds, ...orderIds]);
      await this.audit.log(
        {
          action: 'duty.trips',
          entityType: 'duty',
          entityId: id,
          summary: `調整車趟：${duty.driver.name} ${formatDateShort(fromDbDate(duty.date))}，共 ${cleaned.length} 趟 ${orderIds.length} 單`,
          detail: { trips: cleaned },
        },
        tx,
      );
      await this.revertIfPublished(tx, duty, '調整車趟');
    });
    return this.get(id);
  }

  async remove(id: string) {
    const duty = await this.prisma.duty.findUniqueOrThrow({ where: { id }, include: { ...dutyInclude, driver: true } });
    if (duty.status === 'published') throw new BadRequestException('已發布的班表請先取消發布再刪除');
    const orderIds = duty.trips.flatMap((t) => t.drops.map((d) => d.orderId));
    await this.prisma.$transaction(async (tx) => {
      await tx.duty.delete({ where: { id } });
      await syncOrderStatuses(tx, orderIds);
      await this.audit.log({ action: 'duty.delete', entityType: 'duty', entityId: id, summary: `刪除班表：${duty.driver.name} ${formatDateShort(fromDbDate(duty.date))}` }, tx);
    });
    return { ok: true };
  }

  /** 檢查規則（與看板相同的核心模組計算）。 */
  async evaluate(id: string) {
    const duty = await this.prisma.duty.findUniqueOrThrow({ where: { id } });
    const date = fromDbDate(duty.date);
    const { data, duties } = await this.planning.load(date);
    const ctx = createContext(data);
    const evaluation = evaluateDuties(duties, ctx, [date]).get(id);
    if (!evaluation) throw new BadRequestException('找不到班表的司機資料');
    return { ctx, evaluation };
  }

  /**
   * 發布：有阻擋就拒絕；有警告必須填原因，原因存入操作紀錄。發布時另存派車單快照。
   */
  async publish(id: string, reason?: string | null) {
    const duty = await this.prisma.duty.findUniqueOrThrow({ where: { id }, include: { ...dutyInclude, driver: true } });
    if (!duty.trips.some((t) => t.drops.length > 0)) throw new BadRequestException('班表沒有任何車趟，無法發布');
    const { ctx, evaluation } = await this.evaluate(id);
    const check = checkPublish(evaluation);
    if (!check.canPublish) {
      throw new BadRequestException({ message: '有阻擋的規則沒有通過，無法發布', issues: check.blocking });
    }
    const trimmed = reason?.trim() || null;
    if (check.needsReason && !trimmed) {
      throw new BadRequestException({ message: '班表有警告，請填寫原因後再發布', issues: check.warnings });
    }
    const sheet = buildDispatchSheet(evaluation, ctx);
    const snapshot = {
      sheet,
      timeline: evaluation.timeline,
      warnings: check.warnings,
      reason: check.needsReason ? trimmed : null,
      publishedAt: new Date().toISOString(),
      publishedBy: currentUser(),
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.duty.update({ where: { id }, data: { status: 'published', snapshot: snapshot as object, publishedAt: new Date() } });
      await this.audit.log(
        {
          action: 'duty.publish',
          entityType: 'duty',
          entityId: id,
          summary: `發布班表：${duty.driver.name} ${formatDateShort(fromDbDate(duty.date))}${check.warnings.length ? `（${check.warnings.length} 個警告）` : ''}`,
          detail: { warnings: check.warnings.map((w) => w.message) },
          reason: check.needsReason ? trimmed : null,
        },
        tx,
      );
    });
    return this.get(id);
  }

  async unpublish(id: string) {
    const duty = await this.prisma.duty.findUniqueOrThrow({ where: { id }, include: { driver: true } });
    if (duty.status !== 'published') throw new BadRequestException('班表尚未發布');
    await this.prisma.$transaction(async (tx) => {
      await tx.duty.update({ where: { id }, data: { status: 'draft', publishedAt: null } });
      await this.audit.log({ action: 'duty.unpublish', entityType: 'duty', entityId: id, summary: `取消發布：${duty.driver.name} ${formatDateShort(fromDbDate(duty.date))}` }, tx);
    });
    return this.get(id);
  }

  /** 派車單：某一天已發布班表的快照；未發布的只列出司機。 */
  async dispatchSheets(date: DateString) {
    const duties = await this.prisma.duty.findMany({
      where: { date: toDbDate(date) },
      include: { driver: true, trips: { include: { _count: { select: { drops: true } } } } },
      orderBy: { driverId: 'asc' },
    });
    return {
      date,
      sheets: duties
        .filter((d) => d.status === 'published' && d.snapshot)
        .map((d) => ({ dutyId: d.id, publishedAt: d.publishedAt, ...(d.snapshot as object) })),
      unpublished: duties
        .filter((d) => d.status !== 'published' && d.trips.some((t) => t._count.drops > 0))
        .map((d) => ({ dutyId: d.id, driverName: d.driver.name })),
    };
  }
}
