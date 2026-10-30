/** 日期字串，格式 YYYY-MM-DD（Asia/Taipei 的日曆日）。 */
export type DateString = string;
/** 時間字串，格式 HH:MM。 */
export type TimeString = string;

export type LocationType = 'depot' | 'loading' | 'station';
export type Region = 'central' | 'south';

export interface Location {
  id: string;
  name: string;
  type: LocationType;
  region: Region;
  hours24: boolean;
  openTime: TimeString | null;
  closeTime: TimeString | null;
  /** 出發廠與油站的預設灌油點。 */
  defaultLoadingId: string | null;
}

export type LegSource = 'excel' | 'confirmed' | 'google_x1.5' | 'estimate' | 'manual';

/** 有方向性的路段。 */
export interface Leg {
  fromId: string;
  toId: string;
  minutes: number;
  source: LegSource;
  note?: string | null;
}

/** `data/legs.json` 的原始格式。 */
export interface LegInput {
  from: string;
  to: string;
  minutes: number;
  bidirectional: boolean;
  source: LegSource;
  note?: string | null;
}

export type Shift = 'day' | 'night';

export interface Driver {
  id: string;
  name: string;
  homeDepotId: string;
  shift: Shift;
  vehicleId: string | null;
  active: boolean;
}

export interface Vehicle {
  id: string;
  name: string;
  tractorPlate: string | null;
  trailerPlate: string | null;
  compartmentsKL: number[];
}

export type Product = '92' | '95' | '98' | 'diesel';
export type ProductFamily = 'gasoline' | 'diesel';
export type OrderStatus = 'pending' | 'scheduled' | 'completed' | 'cancelled';

export interface Order {
  id: string;
  stationId: string;
  date: DateString;
  product: Product;
  quantityKL: number;
  windowStart?: TimeString | null;
  windowEnd?: TimeString | null;
  status: OrderStatus;
  note?: string | null;
}

export type RuleLevel = 'block' | 'warn';

export interface RuleToggle {
  enabled: boolean;
  level: RuleLevel;
}

export interface RulesSettings {
  maxConsecutiveWorkDays: RuleToggle & { value: number };
  minRestBetweenDutiesHours: RuleToggle & { value: number };
  stationOpeningHours: RuleToggle;
  missingLeg: RuleToggle;
  orderCaps: RuleToggle;
  dailyDrivingHours: RuleToggle & { value: number };
  continuousDriving: RuleToggle & { maxHours: number; breakMinutes: number };
  dailyWorkHours: RuleToggle & { value: number };
  /** normalDailyHours：計算加班時的每日正常工時。 */
  monthlyOvertimeHours: RuleToggle & { value: number; normalDailyHours: number };
}

export type RuleKey = keyof RulesSettings;

export interface OrderCap {
  depotId: string;
  scope: 'perDriver' | 'depotTotal';
  maxOrders: number;
}

export interface Settings {
  operations: {
    loadMinutes: number;
    unloadMinutesPerStop: number;
    preTripMinutes: number;
  };
  carToTruckFactor: number;
  vehicleDefaults: { compartmentsKL: number[] };
  nightShift: { startTime: TimeString; loadingId: string };
  dayShift: { defaultStartTime: TimeString };
  trip: { maxStopsPerTrip: number };
  orderCaps: OrderCap[];
  rules: RulesSettings;
}

/** 一個 drop：一張訂單（或拆趟後的一部分）卸到一個油站。 */
export interface DropPlan {
  orderId: string;
  stationId: string;
  /** 這次送的量；訂單超過一趟容量時會拆成多個 drop。 */
  quantityKL: number;
  /** 使用的艙位索引（從 0 開始）。 */
  compartmentIdx: number[];
}

export interface TripPlan {
  id?: string;
  /** 手動指定的灌油點；null 表示依規則自動選擇。 */
  loadingId: string | null;
  drops: DropPlan[];
}

export type DutyStatus = 'draft' | 'published';

export interface DutyPlan {
  id: string;
  driverId: string;
  date: DateString;
  /** 日班出車時間；大夜班一律使用設定的大夜班出車時間。 */
  startTime: TimeString;
  /** 手動換掛時指定的車輛；null 表示用司機的固定車輛。 */
  vehicleId?: string | null;
  status: DutyStatus;
  trips: TripPlan[];
}

/** 核心模組需要的全部參考資料。 */
export interface PlanningData {
  locations: Location[];
  legs: Leg[];
  settings: Settings;
  drivers: Driver[];
  vehicles: Vehicle[];
  orders: Order[];
}

export type SegmentKind = 'pretrip' | 'drive' | 'load' | 'unload' | 'wait';

export interface Segment {
  kind: SegmentKind;
  /** 從班表日期 00:00 起算的分鐘數，可超過 1440（跨日）。 */
  start: number;
  end: number;
  /** 第幾趟（從 0 開始）；出車前檢查與回廠行駛也會標上相關車趟。 */
  tripIndex: number | null;
  /** 行駛的起點與終點。 */
  fromId?: string;
  toId?: string;
  /** 灌油、卸油、等待的地點。 */
  locationId?: string;
  /** 卸油時送達的訂單。 */
  orderIds?: string[];
  legSource?: LegSource;
}

export interface MissingLeg {
  fromId: string;
  toId: string;
  tripIndex: number | null;
}

/** 一個卸油點（同一站連續的 drop 合併成一次卸油）。 */
export interface StopTiming {
  tripIndex: number;
  stationId: string;
  orderIds: string[];
  arrival: number;
  waitMinutes: number;
  unloadStart: number;
  unloadEnd: number;
  /** 當天的開門與關門時間（分鐘，與 arrival 同一基準）；24 小時站為 null。 */
  openAt: number | null;
  closeAt: number | null;
}

export interface DutyTimeline {
  dutyId: string;
  driverId: string;
  date: DateString;
  depotId: string;
  shift: Shift;
  start: number;
  /** 收車時間；缺少路段時無法計算，為 null。 */
  end: number | null;
  complete: boolean;
  segments: Segment[];
  stops: StopTiming[];
  missingLegs: MissingLeg[];
  /** 每趟實際使用的灌油點。 */
  tripLoadingIds: string[];
  /** 行駛分鐘合計（只計算到能計算的部分）。 */
  drivingMinutes: number;
}

export type IssueLevel = 'block' | 'warn' | 'info';
export type IssueRule = RuleKey | 'loading' | 'orderWindow' | 'data';

export interface Issue {
  rule: IssueRule;
  level: IssueLevel;
  message: string;
  suggestion?: string;
  tripIndex?: number;
  /** 缺少路段時附上，前端可連到設定頁。 */
  leg?: { fromId: string; toId: string };
}

export type DutyStatusColor = 'green' | 'yellow' | 'red';

export interface DutyEvaluation {
  duty: DutyPlan;
  timeline: DutyTimeline;
  issues: Issue[];
  status: DutyStatusColor;
  /** 單數：以車趟計算（一趟送兩站算 1 單，拆成兩趟算 2 單）。 */
  tripCount: number;
  compartmentsKL: number[];
  vehicleId: string | null;
}
