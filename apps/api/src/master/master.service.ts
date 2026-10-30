import { BadRequestException, Injectable } from '@nestjs/common';
import type { Location as DbLocation, Leg as DbLeg, Vehicle as DbVehicle, Driver as DbDriver } from '@prisma/client';
import {
  SETTING_KEYS,
  validateSettings,
  type Driver,
  type Leg,
  type LegSource,
  type Location,
  type LocationType,
  type Region,
  type Settings,
  type Shift,
  type Vehicle,
} from '@tanker/core';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma.service';
import { completeSettings } from './settings-defaults';

export function toCoreLocation(l: DbLocation): Location {
  return {
    id: l.id,
    name: l.name,
    type: l.type as LocationType,
    region: l.region as Region,
    hours24: l.hours24,
    openTime: l.openTime,
    closeTime: l.closeTime,
    defaultLoadingId: l.defaultLoadingId,
  };
}

export function toCoreLeg(l: DbLeg): Leg {
  return { fromId: l.fromId, toId: l.toId, minutes: l.minutes, source: l.source as LegSource, note: l.note };
}

export function toCoreVehicle(v: DbVehicle): Vehicle {
  return { id: v.id, name: v.name, tractorPlate: v.tractorPlate, trailerPlate: v.trailerPlate, compartmentsKL: v.compartmentsKL };
}

export function toCoreDriver(d: DbDriver): Driver {
  return { id: d.id, name: d.name, homeDepotId: d.homeDepotId, shift: d.shift as Shift, vehicleId: d.vehicleId, active: d.active };
}

/** 據點、路段、設定、司機與車輛：看板計算需要的主檔資料。 */
@Injectable()
export class MasterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getSettings(): Promise<Settings> {
    const rows = await this.prisma.setting.findMany();
    const raw: Record<string, unknown> = {};
    for (const row of rows) raw[row.key] = row.value;
    return completeSettings(raw);
  }

  async saveSettings(input: unknown): Promise<Settings> {
    const errors = validateSettings(input);
    if (errors.length) throw new BadRequestException(errors.join('；'));
    const settings = input as Settings;
    const locations = await this.prisma.location.findMany();
    const byId = new Map(locations.map((l) => [l.id, l]));
    if (byId.get(settings.nightShift.loadingId)?.type !== 'loading') {
      throw new BadRequestException('大夜班灌油點必須是灌油點');
    }
    for (const cap of settings.orderCaps) {
      if (byId.get(cap.depotId)?.type !== 'depot') throw new BadRequestException(`單數上限的出發廠不存在：${cap.depotId}`);
    }
    const before = await this.getSettings();
    const changed = SETTING_KEYS.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(settings[k]));
    await this.prisma.$transaction(async (tx) => {
      for (const key of SETTING_KEYS) {
        const value = settings[key] as object;
        await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
      }
      if (changed.length) {
        await this.audit.log(
          {
            action: 'settings.update',
            entityType: 'setting',
            summary: `修改設定：${changed.join('、')}`,
            detail: { before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, settings[k]])) },
          },
          tx,
        );
      }
    });
    return this.getSettings();
  }

  async getMaster() {
    const [locations, legs, settings, drivers, vehicles] = await Promise.all([
      this.prisma.location.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
      this.prisma.leg.findMany({ orderBy: [{ fromId: 'asc' }, { toId: 'asc' }] }),
      this.getSettings(),
      this.prisma.driver.findMany({ orderBy: { id: 'asc' } }),
      this.prisma.vehicle.findMany({ orderBy: { id: 'asc' } }),
    ]);
    return { locations, legs, settings, drivers, vehicles };
  }

  /** 核心模組格式的主檔資料。 */
  async getPlanningMaster() {
    const m = await this.getMaster();
    return {
      locations: m.locations.map(toCoreLocation),
      legs: m.legs.map(toCoreLeg),
      settings: m.settings,
      drivers: m.drivers.map(toCoreDriver),
      vehicles: m.vehicles.map(toCoreVehicle),
    };
  }
}
