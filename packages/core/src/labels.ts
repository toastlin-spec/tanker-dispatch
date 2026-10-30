import type { DutyStatus, LegSource, LocationType, OrderStatus, Region, SegmentKind, Shift } from './types';

export const LOCATION_TYPE_LABELS: Record<LocationType, string> = { depot: '出發廠', loading: '灌油點', station: '油站' };
export const REGION_LABELS: Record<Region, string> = { central: '中部', south: '南部' };
export const SHIFT_LABELS: Record<Shift, string> = { day: '日班', night: '大夜班' };
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: '待派',
  scheduled: '已排',
  completed: '已完成',
  cancelled: '已取消',
};
export const DUTY_STATUS_LABELS: Record<DutyStatus, string> = { draft: '草稿', published: '已發布' };
export const SEGMENT_LABELS: Record<SegmentKind, string> = {
  pretrip: '出車前檢查',
  drive: '行駛',
  load: '灌油',
  unload: '卸油',
  wait: '等待',
};
export const LEG_SOURCE_LABELS: Record<LegSource, string> = {
  excel: '原始 Excel',
  confirmed: '使用者確認',
  'google_x1.5': 'Google×倍數',
  estimate: '推估（待確認）',
  manual: '手動輸入',
};
export const LEG_SOURCES: LegSource[] = ['confirmed', 'excel', 'google_x1.5', 'estimate', 'manual'];
