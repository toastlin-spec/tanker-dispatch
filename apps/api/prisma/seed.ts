/**
 * 從 data/*.json 匯入初始資料。
 * 資料庫已有據點資料時略過；加上 --force 會清空所有資料後重新匯入。
 */
import { PrismaClient } from '@prisma/client';
import { expandLegs, validateSettings, type LegInput } from '@tanker/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { completeSettings } from '../src/master/settings-defaults';

const DATA_DIR = process.env.SEED_DATA_DIR ?? join(__dirname, '../../../data');

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')) as T;
}

interface LocationJson {
  id: string;
  name: string;
  type: string;
  region: string;
  address: string | null;
  googleName: string | null;
  lat: number | null;
  lng: number | null;
  hours24: boolean;
  openTime: string | null;
  closeTime: string | null;
  defaultLoadingId: string | null;
}

interface FleetJson {
  vehicles: { id: string; name: string; tractorPlate: string | null; trailerPlate: string | null; compartmentsKL: number[] }[];
  drivers: { id: string; name: string; homeDepotId: string; shift: string; vehicleId: string | null }[];
}

export async function seed(prisma: PrismaClient, options: { force?: boolean } = {}) {
  const existing = await prisma.location.count();
  if (existing > 0 && !options.force) {
    console.log('資料庫已有資料，略過匯入初始資料（要重新匯入請執行 npm run db:reset）');
    return false;
  }

  const locations = readJson<LocationJson[]>('locations.json');
  const legs = expandLegs(readJson<{ legs: LegInput[] }>('legs.json').legs);
  const fleet = readJson<FleetJson>('fleet.json');
  const settings = completeSettings(readJson<Record<string, unknown>>('settings.json'));
  const errors = validateSettings(settings);
  if (errors.length) throw new Error(`settings.json 有錯誤：${errors.join('；')}`);

  await prisma.$transaction(async (tx) => {
    if (options.force) {
      await tx.auditLog.deleteMany();
      await tx.drop.deleteMany();
      await tx.trip.deleteMany();
      await tx.duty.deleteMany();
      await tx.order.deleteMany();
      await tx.leg.deleteMany();
      await tx.driver.deleteMany();
      await tx.vehicle.deleteMany();
      await tx.location.deleteMany();
      await tx.setting.deleteMany();
    }
    await tx.location.createMany({ data: locations.map((l, i) => ({ ...l, sortOrder: i + 1 })) });
    await tx.leg.createMany({ data: legs.map((l) => ({ fromId: l.fromId, toId: l.toId, minutes: l.minutes, source: l.source, note: l.note ?? null })) });
    await tx.vehicle.createMany({ data: fleet.vehicles.map((v) => ({ ...v, active: true })) });
    await tx.driver.createMany({ data: fleet.drivers.map((d) => ({ ...d, active: true })) });
    for (const [key, value] of Object.entries(settings)) {
      await tx.setting.create({ data: { key, value: value as object } });
    }
    await tx.auditLog.create({
      data: {
        action: 'seed',
        entityType: 'system',
        summary: `匯入初始資料：${locations.length} 個據點、${legs.length} 個路段（單向）、${fleet.drivers.length} 位司機、${fleet.vehicles.length} 輛車`,
      },
    });
  });
  console.log(`已匯入初始資料：${locations.length} 個據點、${legs.length} 個路段、${fleet.drivers.length} 位司機、${fleet.vehicles.length} 輛車`);
  return true;
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seed(prisma, { force: process.argv.includes('--force') })
    .catch((err) => {
      console.error('匯入初始資料失敗：', err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
