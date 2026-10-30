import type {
  DateString,
  DispatchSheet,
  DutyPlan,
  Issue,
  LegSource,
  LocationType,
  Order,
  OrderStatus,
  Product,
  Region,
  Settings,
  Shift,
  TripPlan,
} from '@tanker/core';

export interface LocationRow {
  id: string;
  name: string;
  type: LocationType;
  region: Region;
  address: string | null;
  googleName: string | null;
  lat: number | null;
  lng: number | null;
  hours24: boolean;
  openTime: string | null;
  closeTime: string | null;
  defaultLoadingId: string | null;
  sortOrder: number;
}

export interface LegRow {
  id: number;
  fromId: string;
  toId: string;
  minutes: number;
  source: LegSource;
  note: string | null;
  updatedAt: string;
}

export interface DriverRow {
  id: string;
  name: string;
  homeDepotId: string;
  shift: Shift;
  vehicleId: string | null;
  active: boolean;
}

export interface VehicleRow {
  id: string;
  name: string;
  tractorPlate: string | null;
  trailerPlate: string | null;
  compartmentsKL: number[];
  active: boolean;
}

export interface Master {
  locations: LocationRow[];
  legs: LegRow[];
  settings: Settings;
  drivers: DriverRow[];
  vehicles: VehicleRow[];
}

export type BoardDuty = DutyPlan & { publishedAt: string | null };

export interface BoardResponse {
  date: DateString;
  from: DateString;
  to: DateString;
  duties: BoardDuty[];
  orders: Order[];
}

export interface OrderRow extends Order {
  createdAt: string;
  updatedAt: string;
  assignments: { dutyId: string; driverId: string; driverName: string; date: string; status: string }[];
}

export interface OrderInput {
  stationId: string;
  date: DateString;
  product: Product;
  quantityKL: number;
  windowStart?: string | null;
  windowEnd?: string | null;
  note?: string | null;
}

export interface SessionUser {
  email: string;
  name: string | null;
  picture: string | null;
}

export interface AuthConfigResponse {
  mode: 'google' | 'dev';
  devEmails?: string[];
}

export interface AllowedUserRow {
  email: string;
  note: string | null;
  addedBy: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  lastName: string | null;
}

export interface AuditLogRow {
  id: number;
  at: string;
  actor: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  detail: unknown;
  reason: string | null;
}

export interface PublishedSheet {
  dutyId: string;
  publishedAt: string;
  sheet: DispatchSheet;
  warnings: Issue[];
  reason: string | null;
  publishedBy?: SessionUser | null;
}

export interface DispatchSheetsResponse {
  date: DateString;
  sheets: PublishedSheet[];
  unpublished: { dutyId: string; driverName: string }[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues?: Issue[],
  ) {
    super(message);
  }
}

let unauthorizedHandler: (() => void) | null = null;

/** 任何 API 回 401（沒登入或已被移出名單）時呼叫，讓畫面回到登入頁。 */
export function onUnauthorized(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('無法連線到伺服器，請確認 API 是否已啟動', 0);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (res.status === 401 && path !== '/auth/me') unauthorizedHandler?.();
  if (!res.ok) {
    throw new ApiError(data?.message ?? `伺服器錯誤（${res.status}）`, res.status, data?.issues);
  }
  return data as T;
}

const qs = (params: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  me: () => request<SessionUser>('GET', '/auth/me'),
  authConfig: () => request<AuthConfigResponse>('GET', '/auth/config'),
  devLogin: (email: string) => request<SessionUser>('POST', '/auth/dev-login', { email }),
  logout: () => request('POST', '/auth/logout'),
  users: () => request<{ bootstrap: string[]; users: AllowedUserRow[] }>('GET', '/users'),
  addUser: (data: { email: string; note?: string | null }) => request<AllowedUserRow>('POST', '/users', data),
  updateUser: (email: string, data: { note: string | null }) => request<AllowedUserRow>('PATCH', `/users/${encodeURIComponent(email)}`, data),
  removeUser: (email: string) => request('DELETE', `/users/${encodeURIComponent(email)}`),

  master: () => request<Master>('GET', '/master'),
  saveSettings: (settings: Settings) => request<Settings>('PUT', '/settings', settings),

  createLocation: (data: Partial<LocationRow>) => request<LocationRow>('POST', '/locations', data),
  updateLocation: (id: string, data: Partial<LocationRow>) => request<LocationRow>('PATCH', `/locations/${id}`, data),
  deleteLocation: (id: string) => request('DELETE', `/locations/${id}`),

  upsertLeg: (data: { fromId: string; toId: string; minutes: number; source: LegSource; note?: string | null; alsoReverse?: boolean }) =>
    request<LegRow[]>('PUT', '/legs', data),
  deleteLeg: (id: number) => request('DELETE', `/legs/${id}`),

  createDriver: (data: Partial<DriverRow>) => request<DriverRow>('POST', '/drivers', data),
  updateDriver: (id: string, data: Partial<DriverRow>) => request<DriverRow>('PATCH', `/drivers/${id}`, data),
  deleteDriver: (id: string) => request('DELETE', `/drivers/${id}`),
  createVehicle: (data: Partial<VehicleRow>) => request<VehicleRow>('POST', '/vehicles', data),
  updateVehicle: (id: string, data: Partial<VehicleRow>) => request<VehicleRow>('PATCH', `/vehicles/${id}`, data),
  deleteVehicle: (id: string) => request('DELETE', `/vehicles/${id}`),

  orders: (params: { date?: string; from?: string; to?: string; status?: OrderStatus[] }) =>
    request<OrderRow[]>('GET', `/orders${qs({ date: params.date, from: params.from, to: params.to, status: params.status?.join(',') })}`),
  createOrder: (data: OrderInput) => request<OrderRow>('POST', '/orders', data),
  updateOrder: (id: string, data: Partial<OrderInput>) => request<OrderRow>('PATCH', `/orders/${id}`, data),
  cancelOrder: (id: string) => request<OrderRow>('POST', `/orders/${id}/cancel`),
  restoreOrder: (id: string) => request<OrderRow>('POST', `/orders/${id}/restore`),
  completeOrder: (id: string) => request<OrderRow>('POST', `/orders/${id}/complete`),
  reopenOrder: (id: string) => request<OrderRow>('POST', `/orders/${id}/reopen`),

  board: (date: string) => request<BoardResponse>('GET', `/board?date=${date}`),
  duties: (from: string, to: string) => request<BoardDuty[]>('GET', `/duties?from=${from}&to=${to}`),
  createDuty: (data: { driverId: string; date: string; startTime?: string }) => request<BoardDuty>('POST', '/duties', data),
  updateDuty: (id: string, data: { startTime?: string; vehicleId?: string | null }) => request<BoardDuty>('PATCH', `/duties/${id}`, data),
  replaceTrips: (id: string, trips: TripPlan[]) => request<BoardDuty>('PUT', `/duties/${id}/trips`, { trips }),
  deleteDuty: (id: string) => request('DELETE', `/duties/${id}`),
  publishDuty: (id: string, reason?: string) => request<BoardDuty>('POST', `/duties/${id}/publish`, { reason: reason ?? null }),
  unpublishDuty: (id: string) => request<BoardDuty>('POST', `/duties/${id}/unpublish`),
  dispatchSheets: (date: string) => request<DispatchSheetsResponse>('GET', `/dispatch-sheets?date=${date}`),

  auditLogs: (params: { entityType?: string; entityId?: string; limit?: number } = {}) =>
    request<AuditLogRow[]>('GET', `/audit-logs${qs({ entityType: params.entityType, entityId: params.entityId, limit: params.limit ? String(params.limit) : undefined })}`),
};
