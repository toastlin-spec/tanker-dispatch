import { BadRequestException } from '@nestjs/common';
import { isDateString, type DateString } from '@tanker/core';

/** 'YYYY-MM-DD' 轉成存進 @db.Date 欄位的 Date（UTC 午夜，避免時區位移）。 */
export function toDbDate(date: DateString): Date {
  if (!isDateString(date)) throw new BadRequestException(`日期格式錯誤：${date}（應為 YYYY-MM-DD）`);
  return new Date(`${date}T00:00:00.000Z`);
}

export function fromDbDate(date: Date): DateString {
  return date.toISOString().slice(0, 10);
}

/** 查詢參數裡的日期。 */
export function requireDateParam(value: unknown, label = '日期'): DateString {
  if (typeof value !== 'string' || !isDateString(value)) {
    throw new BadRequestException(`${label}格式錯誤，應為 YYYY-MM-DD`);
  }
  return value;
}
