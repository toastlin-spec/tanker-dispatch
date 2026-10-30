import type { Leg, LegInput } from './types';

/** 新增路段建議值的進位單位（規格書 6.1：進位到 5 分）。 */
export const LEG_ROUNDING_MINUTES = 5;

export type LegIndex = Map<string, Leg>;

function legKey(fromId: string, toId: string): string {
  return `${fromId}\u0000${toId}`;
}

/**
 * 把 `data/legs.json` 的格式展開成有方向性的路段。
 * bidirectional 的路段展開成兩筆；若同一方向重複出現，以明確寫出的單向資料為準，
 * 再來才是較早出現的資料。
 */
export function expandLegs(inputs: LegInput[]): Leg[] {
  const explicit = new Map<string, Leg>();
  const mirrored = new Map<string, Leg>();
  for (const input of inputs) {
    const forward: Leg = {
      fromId: input.from,
      toId: input.to,
      minutes: input.minutes,
      source: input.source,
      note: input.note ?? null,
    };
    const k = legKey(input.from, input.to);
    if (!explicit.has(k)) explicit.set(k, forward);
    if (input.bidirectional) {
      const rk = legKey(input.to, input.from);
      if (!mirrored.has(rk)) {
        mirrored.set(rk, { ...forward, fromId: input.to, toId: input.from });
      }
    }
  }
  const result = new Map(explicit);
  for (const [k, leg] of mirrored) {
    if (!result.has(k)) result.set(k, leg);
  }
  return [...result.values()];
}

export function buildLegIndex(legs: Leg[]): LegIndex {
  const index: LegIndex = new Map();
  for (const leg of legs) index.set(legKey(leg.fromId, leg.toId), leg);
  return index;
}

export type LegLookup =
  | { ok: true; leg: Leg; minutes: number }
  | { ok: false; fromId: string; toId: string };

/** 查詢路段時間。缺少時回傳 ok=false，不做任何推估。 */
export function lookupLeg(index: LegIndex, fromId: string, toId: string): LegLookup {
  if (fromId === toId) {
    return { ok: true, minutes: 0, leg: { fromId, toId, minutes: 0, source: 'confirmed', note: null } };
  }
  const leg = index.get(legKey(fromId, toId));
  if (!leg) return { ok: false, fromId, toId };
  return { ok: true, leg, minutes: leg.minutes };
}

/** 「缺少路段時間：A→B」。 */
export function missingLegMessage(fromName: string, toName: string): string {
  return `缺少路段時間：${fromName}→${toName}`;
}

/**
 * 新增路段的建議值：Google 小客車時間的下限 × 油罐車倍數，再進位到 5 分。
 */
export function suggestLegMinutes(googleCarMinutes: number, factor: number): number {
  if (!(googleCarMinutes > 0) || !(factor > 0)) {
    throw new Error('Google 時間與倍數都必須大於 0');
  }
  const raw = googleCarMinutes * factor;
  // 先處理浮點誤差，例如 30 × 1.5 = 45.00000000001 不應進位成 50。
  const cleaned = Math.round(raw * 1e6) / 1e6;
  return Math.ceil(cleaned / LEG_ROUNDING_MINUTES) * LEG_ROUNDING_MINUTES;
}
