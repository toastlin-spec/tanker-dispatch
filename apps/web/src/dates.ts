import dayjs from 'dayjs';

/** 台北時間的今天（YYYY-MM-DD），不受瀏覽器時區影響。 */
export function todayTaipei(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function toDayjs(date: string) {
  return dayjs(date, 'YYYY-MM-DD');
}

export function fromDayjs(d: dayjs.Dayjs) {
  return d.format('YYYY-MM-DD');
}

export function timeToDayjs(time: string | null | undefined) {
  return time ? dayjs(time, 'HH:mm') : null;
}

export function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}
