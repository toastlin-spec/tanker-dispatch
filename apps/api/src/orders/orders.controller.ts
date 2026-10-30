import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ORDER_STATUS_LABELS, PRODUCT_LABELS, formatDateShort, isDateString, type OrderStatus, type Product } from '@tanker/core';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { fromDbDate, toDbDate } from '../common/dates';
import { parseBody, zDate, zOptionalText, zProduct, zTime } from '../common/validation';
import { PrismaService } from '../prisma.service';
import { syncOrderStatuses } from './order-status';

const orderFields = z.object({
  stationId: z.string().min(1),
  date: zDate,
  product: zProduct,
  quantityKL: z.number().positive().max(1000),
  windowStart: zTime.nullish().transform((v) => v || null),
  windowEnd: zTime.nullish().transform((v) => v || null),
  note: zOptionalText,
});

const STATUSES: OrderStatus[] = ['pending', 'scheduled', 'completed', 'cancelled'];

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async present(where: { id?: string } | object) {
    const orders = await this.prisma.order.findMany({
      where,
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      include: { drops: { include: { trip: { include: { duty: { include: { driver: true } } } } } } },
    });
    return orders.map(({ drops, ...o }) => {
      const duties = new Map<string, { dutyId: string; driverId: string; driverName: string; date: string; status: string }>();
      for (const d of drops) {
        const duty = d.trip.duty;
        duties.set(duty.id, { dutyId: duty.id, driverId: duty.driverId, driverName: duty.driver.name, date: fromDbDate(duty.date), status: duty.status });
      }
      return { ...o, date: fromDbDate(o.date), assignments: [...duties.values()] };
    });
  }

  @Get()
  list(@Query('date') date?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('status') status?: string) {
    for (const [label, v] of [['日期', date], ['起始日期', from], ['結束日期', to]] as const) {
      if (v && !isDateString(v)) throw new BadRequestException(`${label}格式錯誤，應為 YYYY-MM-DD`);
    }
    const statuses = status ? status.split(',').filter((s): s is OrderStatus => STATUSES.includes(s as OrderStatus)) : undefined;
    return this.present({
      date: date ? toDbDate(date) : from || to ? { gte: from ? toDbDate(from) : undefined, lte: to ? toDbDate(to) : undefined } : undefined,
      status: statuses ? { in: statuses } : undefined,
    });
  }

  private async checkStation(stationId: string) {
    const station = await this.prisma.location.findUnique({ where: { id: stationId } });
    if (station?.type !== 'station') throw new BadRequestException('請選擇油站');
    return station;
  }

  private checkWindow(data: { windowStart: string | null; windowEnd: string | null }) {
    if (data.windowStart && data.windowEnd && data.windowStart >= data.windowEnd) {
      throw new BadRequestException('希望到達時段的開始時間必須早於結束時間');
    }
  }

  @Post()
  async create(@Body() body: unknown) {
    const data = parseBody(orderFields, body);
    const station = await this.checkStation(data.stationId);
    this.checkWindow(data);
    const created = await this.prisma.order.create({ data: { ...data, date: toDbDate(data.date), status: 'pending' } });
    await this.audit.log({
      action: 'order.create',
      entityType: 'order',
      entityId: created.id,
      summary: `新增訂單：${formatDateShort(data.date)} ${station.name} ${PRODUCT_LABELS[data.product as Product]} ${data.quantityKL}KL`,
    });
    return (await this.present({ id: created.id }))[0];
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const existing = await this.prisma.order.findUniqueOrThrow({ where: { id }, include: { drops: true } });
    const current = {
      stationId: existing.stationId,
      date: fromDbDate(existing.date),
      product: existing.product,
      quantityKL: existing.quantityKL,
      windowStart: existing.windowStart,
      windowEnd: existing.windowEnd,
      note: existing.note,
    };
    const data = parseBody(orderFields, { ...current, ...(body as object) });
    this.checkWindow(data);
    const coreChanged = (['stationId', 'date', 'product', 'quantityKL'] as const).some((k) => data[k] !== current[k]);
    if (coreChanged && existing.drops.length > 0) {
      throw new BadRequestException('訂單已排入班表，請先從班表移除，才能修改油站、日期、油品或數量');
    }
    if (coreChanged && (existing.status === 'cancelled' || existing.status === 'completed')) {
      throw new BadRequestException(`訂單${ORDER_STATUS_LABELS[existing.status as OrderStatus]}，不能修改油站、日期、油品或數量`);
    }
    await this.checkStation(data.stationId);
    const updated = await this.prisma.order.update({ where: { id }, data: { ...data, date: toDbDate(data.date) } });
    await this.audit.log({ action: 'order.update', entityType: 'order', entityId: id, summary: '修改訂單', detail: { before: current, after: data } });
    return (await this.present({ id: updated.id }))[0];
  }

  /** 取消訂單：已發布的班表不能直接取消；草稿班表會一併移除這張單。 */
  @Post(':id/cancel')
  async cancel(@Param('id') id: string) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id },
      include: { drops: { include: { trip: { include: { duty: { include: { driver: true } } } } } } },
    });
    if (order.status === 'cancelled') throw new BadRequestException('訂單已經取消');
    if (order.status === 'completed') throw new BadRequestException('已完成的訂單不能取消');
    const published = order.drops.find((d) => d.trip.duty.status === 'published');
    if (published) {
      throw new BadRequestException(
        `訂單在已發布的班表中（${published.trip.duty.driver.name} ${formatDateShort(fromDbDate(published.trip.duty.date))}），請先取消發布再取消訂單`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const tripIds = [...new Set(order.drops.map((d) => d.tripId))];
      await tx.drop.deleteMany({ where: { orderId: id } });
      // 車趟變空就刪除，並重新編號。
      for (const tripId of tripIds) {
        if ((await tx.drop.count({ where: { tripId } })) === 0) await tx.trip.delete({ where: { id: tripId } });
      }
      for (const dutyId of new Set(order.drops.map((d) => d.trip.dutyId))) {
        const trips = await tx.trip.findMany({ where: { dutyId }, orderBy: { seq: 'asc' } });
        for (const [i, t] of trips.entries()) await tx.trip.update({ where: { id: t.id }, data: { seq: i } });
      }
      await tx.order.update({ where: { id }, data: { status: 'cancelled' } });
      await this.audit.log(
        {
          action: 'order.cancel',
          entityType: 'order',
          entityId: id,
          summary: order.drops.length ? '取消訂單，並從草稿班表移除' : '取消訂單',
        },
        tx,
      );
    });
    return (await this.present({ id }))[0];
  }

  @Post(':id/restore')
  async restore(@Param('id') id: string) {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id } });
    if (order.status !== 'cancelled') throw new BadRequestException('只有已取消的訂單可以恢復');
    await this.prisma.order.update({ where: { id }, data: { status: 'pending' } });
    await this.audit.log({ action: 'order.restore', entityType: 'order', entityId: id, summary: '恢復已取消的訂單' });
    return (await this.present({ id }))[0];
  }

  /** 標記完成：只有排在已發布班表的訂單可以標記。 */
  @Post(':id/complete')
  async complete(@Param('id') id: string) {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id }, include: { drops: { include: { trip: { include: { duty: true } } } } } });
    if (order.status !== 'scheduled' || !order.drops.some((d) => d.trip.duty.status === 'published')) {
      throw new BadRequestException('只有排在已發布班表的訂單可以標記完成');
    }
    await this.prisma.order.update({ where: { id }, data: { status: 'completed' } });
    await this.audit.log({ action: 'order.complete', entityType: 'order', entityId: id, summary: '訂單標記完成' });
    return (await this.present({ id }))[0];
  }

  @Post(':id/reopen')
  async reopen(@Param('id') id: string) {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id } });
    if (order.status !== 'completed') throw new BadRequestException('只有已完成的訂單可以改回');
    await this.prisma.order.update({ where: { id }, data: { status: 'pending' } });
    await syncOrderStatuses(this.prisma, [id]);
    await this.audit.log({ action: 'order.reopen', entityType: 'order', entityId: id, summary: '已完成的訂單改回未完成' });
    return (await this.present({ id }))[0];
  }
}
