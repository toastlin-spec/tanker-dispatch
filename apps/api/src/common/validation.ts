import { BadRequestException } from '@nestjs/common';
import { PRODUCTS, isDateString, isTimeString, type Product } from '@tanker/core';
import { z, type ZodTypeAny } from 'zod';

/** 欄位的中文名稱，用在驗證錯誤訊息。 */
const FIELD_LABELS: Record<string, string> = {
  id: '代碼',
  name: '名稱',
  type: '類型',
  region: '區域',
  address: '地址',
  googleName: 'Google 名稱',
  lat: '緯度',
  lng: '經度',
  hours24: '24 小時營業',
  openTime: '開門時間',
  closeTime: '關門時間',
  defaultLoadingId: '預設灌油點',
  fromId: '起點',
  toId: '終點',
  minutes: '分鐘',
  source: '來源',
  note: '備註',
  tractorPlate: '車頭車牌',
  trailerPlate: '油槽車牌',
  compartmentsKL: '艙位容量',
  homeDepotId: '所屬廠',
  shift: '班別',
  vehicleId: '車輛',
  active: '在職',
  stationId: '油站',
  date: '日期',
  product: '油品',
  quantityKL: '數量',
  windowStart: '希望到達時段（起）',
  windowEnd: '希望到達時段（迄）',
  driverId: '司機',
  startTime: '出車時間',
  trips: '車趟',
  drops: '訂單',
  loadingId: '灌油點',
  orderId: '訂單',
  compartmentIdx: '艙位',
  reason: '原因',
};

function describeIssue(issue: z.ZodIssue): string {
  const path = issue.path.filter((p) => typeof p === 'string') as string[];
  const field = path.length ? FIELD_LABELS[path[path.length - 1]] ?? path[path.length - 1] : '資料';
  if (issue.code === 'custom') return issue.message;
  if (issue.code === 'invalid_type') {
    return issue.received === 'undefined' || issue.received === 'null' ? `${field}必填` : `${field}格式錯誤`;
  }
  if (issue.code === 'invalid_enum_value') return `${field}必須是 ${issue.options.join('、')} 其中之一`;
  if (issue.code === 'too_small') {
    if (issue.type === 'string') return `${field}必填`;
    if (issue.type === 'array') return `${field}至少要有 ${issue.minimum} 個`;
    return `${field}${issue.inclusive ? '不可小於' : '必須大於'} ${issue.minimum}`;
  }
  if (issue.code === 'too_big') return `${field}不可大於 ${issue.maximum}`;
  if (issue.code === 'invalid_string') return issue.message && issue.message !== 'Invalid' ? issue.message : `${field}格式錯誤`;
  return `${field}格式錯誤`;
}

/** 驗證請求內容；失敗時回傳 400 與中文訊息。 */
export function parseBody<T extends ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const messages = [...new Set(result.error.issues.map(describeIssue))];
    throw new BadRequestException(messages.join('；'));
  }
  return result.data;
}

export const zTime = z.string().refine((v) => isTimeString(v), { message: '時間格式應為 HH:MM' });
export const zDate = z.string().refine((v) => isDateString(v), { message: '日期格式應為 YYYY-MM-DD' });
export const zProduct = z.enum(PRODUCTS as [Product, ...Product[]]);
export const zOptionalText = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((v) => (v ? v : null));
