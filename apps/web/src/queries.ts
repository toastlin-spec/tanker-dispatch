import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext as createPlanningContext, type Leg, type Location, type Order, type PlanningData } from '@tanker/core';
import { useMemo } from 'react';
import { api, type Master } from './api';

export const keys = {
  me: ['me'] as const,
  users: ['users'] as const,
  master: ['master'] as const,
  board: (date: string) => ['board', date] as const,
  orders: (params: object) => ['orders', params] as const,
  sheets: (date: string) => ['sheets', date] as const,
  audit: ['audit'] as const,
};

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: api.me, retry: false, staleTime: 5 * 60_000 });
}

export function useMaster() {
  return useQuery({ queryKey: keys.master, queryFn: api.master, staleTime: 30_000 });
}

export function useBoard(date: string) {
  return useQuery({ queryKey: keys.board(date), queryFn: () => api.board(date) });
}

/** 主檔資料轉成核心模組的格式。 */
export function toPlanningData(master: Master, orders: Order[]): PlanningData {
  return {
    locations: master.locations.map(
      (l): Location => ({
        id: l.id,
        name: l.name,
        type: l.type,
        region: l.region,
        hours24: l.hours24,
        openTime: l.openTime,
        closeTime: l.closeTime,
        defaultLoadingId: l.defaultLoadingId,
      }),
    ),
    legs: master.legs.map((l): Leg => ({ fromId: l.fromId, toId: l.toId, minutes: l.minutes, source: l.source, note: l.note })),
    settings: master.settings,
    drivers: master.drivers,
    vehicles: master.vehicles,
    orders,
  };
}

export function usePlanning(master: Master | undefined, orders: Order[] | undefined) {
  return useMemo(() => {
    if (!master || !orders) return null;
    const data = toPlanningData(master, orders);
    return { data, ctx: createPlanningContext(data) };
  }, [master, orders]);
}

/** 主檔變更後讓看板、訂單等全部重新載入。 */
export function useInvalidateAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

export function locationNameMap(master: Master | undefined) {
  return new Map((master?.locations ?? []).map((l) => [l.id, l.name]));
}
