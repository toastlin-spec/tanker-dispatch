import type { DateString, TimeString } from './types';

export const MINUTES_PER_DAY = 1440;

const TIME_RE = /^([01]\d|2[0-4]):([0-5]\d)$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isTimeString(value: unknown): value is TimeString {
  if (typeof value !== 'string') return false;
  const m = TIME_RE.exec(value);
  if (!m) return false;
  return !(m[1] === '24' && m[2] !== '00');
}

/** "HH:MM" 轉成當天 00:00 起算的分鐘數。 */
export function parseTime(value: TimeString): number {
  if (!isTimeString(value)) {
    throw new Error(`時間格式錯誤：${value}（應為 HH:MM）`);
  }
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

/** 分鐘數轉成 "HH:MM"；超過一天時加上「+1」之類的跨日標記。 */
export function formatMinutes(minutes: number, opts: { dayMarker?: boolean } = {}): string {
  const dayMarker = opts.dayMarker ?? true;
  const rounded = Math.round(minutes);
  const day = Math.floor(rounded / MINUTES_PER_DAY);
  const inDay = rounded - day * MINUTES_PER_DAY;
  const hh = String(Math.floor(inDay / 60)).padStart(2, '0');
  const mm = String(inDay % 60).padStart(2, '0');
  const base = `${hh}:${mm}`;
  if (!dayMarker || day === 0) return base;
  return day > 0 ? `${base}（+${day}天）` : `${base}（${day}天）`;
}

/** 分鐘長度轉成「X 小時 Y 分」。 */
export function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? '-' : '';
  const abs = Math.abs(Math.round(minutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${sign}${m} 分`;
  if (m === 0) return `${sign}${h} 小時`;
  return `${sign}${h} 小時 ${m} 分`;
}

export function isDateString(value: unknown): value is DateString {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** 日期轉成連續的日序號，方便跨日計算（台灣沒有日光節約時間）。 */
export function dayNumber(date: DateString): number {
  if (!isDateString(date)) {
    throw new Error(`日期格式錯誤：${date}（應為 YYYY-MM-DD）`);
  }
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function dateFromDayNumber(n: number): DateString {
  return new Date(n * 86_400_000).toISOString().slice(0, 10);
}

export function addDays(date: DateString, days: number): DateString {
  return dateFromDayNumber(dayNumber(date) + days);
}

/** 班表日期加上分鐘數，換算成跨日可比較的絕對分鐘數。 */
export function absoluteMinutes(date: DateString, minutes: number): number {
  return dayNumber(date) * MINUTES_PER_DAY + minutes;
}

export function monthOf(date: DateString): string {
  return date.slice(0, 7);
}

/** 顯示用：10/30（四）。 */
export function formatDateShort(date: DateString): string {
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const [, m, d] = date.split('-').map(Number);
  const w = new Date(dayNumber(date) * 86_400_000).getUTCDay();
  return `${m}/${d}（${weekdays[w]}）`;
}
