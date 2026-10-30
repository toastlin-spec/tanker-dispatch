import { BadRequestException, Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put } from '@nestjs/common';
import { LEG_SOURCES, LOCATION_TYPE_LABELS } from '@tanker/core';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { parseBody, zOptionalText, zTime } from '../common/validation';
import { PrismaService } from '../prisma.service';
import { MasterService } from './master.service';

const locationFields = z.object({
  name: z.string().trim().min(1),
  type: z.enum(['depot', 'loading', 'station']),
  region: z.enum(['central', 'south']),
  address: zOptionalText,
  googleName: zOptionalText,
  lat: z.number().nullish().transform((v) => v ?? null),
  lng: z.number().nullish().transform((v) => v ?? null),
  hours24: z.boolean(),
  openTime: zTime.nullish().transform((v) => v ?? null),
  closeTime: zTime.nullish().transform((v) => v ?? null),
  defaultLoadingId: z.string().nullish().transform((v) => v || null),
  sortOrder: z.number().int().optional(),
});

const locationCreate = locationFields.extend({
  id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]*$/, { message: '代碼只能用小寫英文、數字和 -' }),
});

const legUpsert = z.object({
  fromId: z.string().min(1),
  toId: z.string().min(1),
  minutes: z.number().int().min(1),
  source: z.enum(LEG_SOURCES as [string, ...string[]]),
  note: zOptionalText,
  alsoReverse: z.boolean().optional(),
});

const vehicleFields = z.object({
  name: z.string().trim().min(1),
  tractorPlate: zOptionalText,
  trailerPlate: zOptionalText,
  compartmentsKL: z.array(z.number().positive()).min(1),
  active: z.boolean().default(true),
});

const driverFields = z.object({
  name: z.string().trim().min(1),
  homeDepotId: z.string().min(1),
  shift: z.enum(['day', 'night']),
  vehicleId: z.string().nullish().transform((v) => v || null),
  active: z.boolean().default(true),
});

@Controller()
export class MasterController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly master: MasterService,
    private readonly audit: AuditService,
  ) {}

  /** 看板與設定頁需要的全部主檔資料。 */
  @Get('master')
  getMaster() {
    return this.master.getMaster();
  }

  // ---- 設定 ----

  @Get('settings')
  getSettings() {
    return this.master.getSettings();
  }

  @Put('settings')
  saveSettings(@Body() body: unknown) {
    return this.master.saveSettings(body);
  }

  // ---- 據點 ----

  @Get('locations')
  listLocations() {
    return this.prisma.location.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
  }

  private async checkLocation(data: z.infer<typeof locationFields>) {
    if (!data.hours24 && (!data.openTime || !data.closeTime)) {
      throw new BadRequestException('非 24 小時營業的據點必須填開門與關門時間');
    }
    if (data.hours24) {
      data.openTime = null;
      data.closeTime = null;
    }
    if (data.defaultLoadingId) {
      const loading = await this.prisma.location.findUnique({ where: { id: data.defaultLoadingId } });
      if (loading?.type !== 'loading') throw new BadRequestException('預設灌油點必須是灌油點');
    }
  }

  @Post('locations')
  async createLocation(@Body() body: unknown) {
    const data = parseBody(locationCreate, body);
    await this.checkLocation(data);
    const sortOrder = data.sortOrder ?? (await this.prisma.location.count()) + 1;
    const created = await this.prisma.location.create({ data: { ...data, sortOrder } });
    await this.audit.log({ action: 'location.create', entityType: 'location', entityId: created.id, summary: `新增${LOCATION_TYPE_LABELS[data.type]}：${created.name}` });
    return created;
  }

  @Patch('locations/:id')
  async updateLocation(@Param('id') id: string, @Body() body: unknown) {
    const existing = await this.prisma.location.findUniqueOrThrow({ where: { id } });
    const { id: _ignored, createdAt: _c, updatedAt: _u, ...current } = existing;
    const data = parseBody(locationFields, { ...current, ...(body as object) });
    await this.checkLocation(data);
    const updated = await this.prisma.location.update({ where: { id }, data });
    await this.audit.log({
      action: 'location.update',
      entityType: 'location',
      entityId: id,
      summary: `修改據點：${updated.name}`,
      detail: { before: existing, after: updated },
    });
    return updated;
  }

  @Delete('locations/:id')
  async deleteLocation(@Param('id') id: string) {
    const location = await this.prisma.location.findUniqueOrThrow({ where: { id } });
    const [orders, drivers, drops, trips] = await Promise.all([
      this.prisma.order.count({ where: { stationId: id } }),
      this.prisma.driver.count({ where: { homeDepotId: id } }),
      this.prisma.drop.count({ where: { stationId: id } }),
      this.prisma.trip.count({ where: { loadingId: id } }),
    ]);
    if (orders + drivers + drops + trips > 0) throw new BadRequestException(`「${location.name}」已被訂單、司機或班表使用，無法刪除`);
    await this.prisma.location.delete({ where: { id } });
    await this.audit.log({ action: 'location.delete', entityType: 'location', entityId: id, summary: `刪除據點：${location.name}` });
    return { ok: true };
  }

  // ---- 路段 ----

  @Get('legs')
  listLegs() {
    return this.prisma.leg.findMany({ orderBy: [{ fromId: 'asc' }, { toId: 'asc' }] });
  }

  /** 新增或修改一個方向的路段；alsoReverse=true 時同時寫入反方向。 */
  @Put('legs')
  async upsertLeg(@Body() body: unknown) {
    const { alsoReverse, ...data } = parseBody(legUpsert, body);
    if (data.fromId === data.toId) throw new BadRequestException('起點與終點不能相同');
    const ends = await this.prisma.location.findMany({ where: { id: { in: [data.fromId, data.toId] } } });
    if (ends.length !== 2) throw new BadRequestException('起點或終點不存在');
    const name = (id: string) => ends.find((e) => e.id === id)?.name ?? id;
    const pairs = alsoReverse ? [data, { ...data, fromId: data.toId, toId: data.fromId }] : [data];
    return this.prisma.$transaction(async (tx) => {
      const saved = [];
      for (const leg of pairs) {
        const before = await tx.leg.findUnique({ where: { fromId_toId: { fromId: leg.fromId, toId: leg.toId } } });
        const row = await tx.leg.upsert({
          where: { fromId_toId: { fromId: leg.fromId, toId: leg.toId } },
          create: leg,
          update: { minutes: leg.minutes, source: leg.source, note: leg.note },
        });
        await this.audit.log(
          {
            action: before ? 'leg.update' : 'leg.create',
            entityType: 'leg',
            entityId: String(row.id),
            summary: before
              ? `修改路段 ${name(leg.fromId)}→${name(leg.toId)}：${before.minutes} → ${leg.minutes} 分`
              : `新增路段 ${name(leg.fromId)}→${name(leg.toId)}：${leg.minutes} 分`,
            detail: { before, after: row },
          },
          tx,
        );
        saved.push(row);
      }
      return saved;
    });
  }

  @Delete('legs/:id')
  async deleteLeg(@Param('id', ParseIntPipe) id: number) {
    const leg = await this.prisma.leg.findUniqueOrThrow({ where: { id }, include: { from: true, to: true } });
    await this.prisma.leg.delete({ where: { id } });
    await this.audit.log({
      action: 'leg.delete',
      entityType: 'leg',
      entityId: String(id),
      summary: `刪除路段 ${leg.from.name}→${leg.to.name}（${leg.minutes} 分）`,
    });
    return { ok: true };
  }

  // ---- 車輛 ----

  @Get('vehicles')
  listVehicles() {
    return this.prisma.vehicle.findMany({ orderBy: { id: 'asc' } });
  }

  @Post('vehicles')
  async createVehicle(@Body() body: unknown) {
    const data = parseBody(vehicleFields.extend({ id: z.string().trim().min(1).optional() }), body);
    const created = await this.prisma.vehicle.create({ data: { ...data, id: data.id ?? `v-${randomUUID().slice(0, 8)}` } });
    await this.audit.log({ action: 'vehicle.create', entityType: 'vehicle', entityId: created.id, summary: `新增車輛：${created.name}` });
    return created;
  }

  @Patch('vehicles/:id')
  async updateVehicle(@Param('id') id: string, @Body() body: unknown) {
    const existing = await this.prisma.vehicle.findUniqueOrThrow({ where: { id } });
    const data = parseBody(vehicleFields, { ...existing, ...(body as object) });
    const updated = await this.prisma.vehicle.update({ where: { id }, data });
    await this.audit.log({ action: 'vehicle.update', entityType: 'vehicle', entityId: id, summary: `修改車輛：${updated.name}`, detail: { before: existing, after: updated } });
    return updated;
  }

  @Delete('vehicles/:id')
  async deleteVehicle(@Param('id') id: string) {
    const vehicle = await this.prisma.vehicle.findUniqueOrThrow({ where: { id } });
    const used = (await this.prisma.duty.count({ where: { vehicleId: id } })) + (await this.prisma.driver.count({ where: { vehicleId: id } }));
    if (used > 0) throw new BadRequestException(`「${vehicle.name}」已有司機或班表使用，請改為停用`);
    await this.prisma.vehicle.delete({ where: { id } });
    await this.audit.log({ action: 'vehicle.delete', entityType: 'vehicle', entityId: id, summary: `刪除車輛：${vehicle.name}` });
    return { ok: true };
  }

  // ---- 司機 ----

  @Get('drivers')
  listDrivers() {
    return this.prisma.driver.findMany({ orderBy: { id: 'asc' } });
  }

  private async checkDriver(data: z.infer<typeof driverFields>) {
    const depot = await this.prisma.location.findUnique({ where: { id: data.homeDepotId } });
    if (depot?.type !== 'depot') throw new BadRequestException('所屬廠必須是出發廠');
    if (data.vehicleId && !(await this.prisma.vehicle.findUnique({ where: { id: data.vehicleId } }))) {
      throw new BadRequestException('車輛不存在');
    }
  }

  @Post('drivers')
  async createDriver(@Body() body: unknown) {
    const data = parseBody(driverFields.extend({ id: z.string().trim().min(1).optional() }), body);
    await this.checkDriver(data);
    const created = await this.prisma.driver.create({ data: { ...data, id: data.id ?? `d-${randomUUID().slice(0, 8)}` } });
    await this.audit.log({ action: 'driver.create', entityType: 'driver', entityId: created.id, summary: `新增司機：${created.name}` });
    return created;
  }

  @Patch('drivers/:id')
  async updateDriver(@Param('id') id: string, @Body() body: unknown) {
    const existing = await this.prisma.driver.findUniqueOrThrow({ where: { id } });
    const data = parseBody(driverFields, { ...existing, ...(body as object) });
    await this.checkDriver(data);
    const updated = await this.prisma.driver.update({ where: { id }, data });
    await this.audit.log({ action: 'driver.update', entityType: 'driver', entityId: id, summary: `修改司機：${updated.name}`, detail: { before: existing, after: updated } });
    return updated;
  }

  @Delete('drivers/:id')
  async deleteDriver(@Param('id') id: string) {
    const driver = await this.prisma.driver.findUniqueOrThrow({ where: { id } });
    if ((await this.prisma.duty.count({ where: { driverId: id } })) > 0) {
      throw new BadRequestException(`「${driver.name}」已有班表，請改為停用`);
    }
    await this.prisma.driver.delete({ where: { id } });
    await this.audit.log({ action: 'driver.delete', entityType: 'driver', entityId: id, summary: `刪除司機：${driver.name}` });
    return { ok: true };
  }
}
