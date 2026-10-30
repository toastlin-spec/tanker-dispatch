import { useDroppable } from '@dnd-kit/core';
import {
  PRODUCT_LABELS,
  SEGMENT_LABELS,
  SHIFT_LABELS,
  formatMinutes,
  locationName,
  type BoardRow,
  type DepotOrderTotal,
  type PlanningContext,
  type Segment,
} from '@tanker/core';
import { Badge, Button, Popover, Space, Tag, TimePicker, Tooltip, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { BoardDuty } from '../api';
import { IssueList, legLink } from '../components/IssueList';
import { timeToDayjs } from '../dates';

const STATUS = {
  green: { color: 'success', text: '通過' },
  yellow: { color: 'warning', text: '警告' },
  red: { color: 'error', text: '違規' },
} as const;

export function axisEnd(rows: BoardRow[]) {
  let end = 1440;
  for (const r of rows) {
    const segs = r.evaluation?.timeline.segments ?? [];
    for (const s of segs) end = Math.max(end, s.end);
    if (r.evaluation && !r.evaluation.timeline.complete) {
      const last = segs.length ? segs[segs.length - 1].end : r.evaluation.timeline.start;
      end = Math.max(end, last + 120);
    }
  }
  return Math.ceil(end / 60) * 60;
}

function pct(minutes: number, total: number) {
  return `${(minutes / total) * 100}%`;
}

export function GanttAxis({ total }: { total: number }) {
  const hours = total / 60;
  return (
    <div className="gantt-axis">
      <div style={{ padding: '6px 10px', fontSize: 12, color: '#667085' }}>司機</div>
      <div className="ticks">
        {Array.from({ length: hours }, (_, h) => (
          <div key={h} className={`tick ${h % 6 === 0 ? 'major' : ''}`} style={{ left: pct(h * 60, total) }}>
            {h % 2 === 0 ? `${String(h % 24).padStart(2, '0')}${h >= 24 ? '⁺' : ''}` : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

function segmentText(s: Segment, ctx: PlanningContext) {
  const name = (id?: string) => (id ? locationName(ctx, id) : '');
  switch (s.kind) {
    case 'drive':
      return `→${name(s.toId)}`;
    case 'load':
      return `灌 ${name(s.locationId)}`;
    case 'unload':
      return `卸 ${name(s.locationId)}`;
    case 'wait':
      return '等待';
    default:
      return '檢查';
  }
}

function segmentTooltip(s: Segment, ctx: PlanningContext, duty: BoardDuty) {
  const name = (id?: string) => (id ? locationName(ctx, id) : '');
  const place = s.kind === 'drive' ? `${name(s.fromId)} → ${name(s.toId)}` : name(s.locationId);
  const lines = [`${SEGMENT_LABELS[s.kind]} ${formatMinutes(s.start)}–${formatMinutes(s.end)}（${s.end - s.start} 分）`, place];
  if (s.tripIndex !== null) lines.push(`第 ${s.tripIndex + 1} 趟`);
  if (s.kind === 'unload' && s.orderIds) {
    const trip = duty.trips.filter((t) => t.drops.length > 0)[s.tripIndex ?? 0];
    for (const d of trip?.drops ?? []) {
      if (!s.orderIds.includes(d.orderId) || d.stationId !== s.locationId) continue;
      const order = ctx.orders.get(d.orderId);
      lines.push(`${order ? PRODUCT_LABELS[order.product] : ''} ${d.quantityKL}KL`);
    }
  }
  return lines.map((l, i) => <div key={i}>{l}</div>);
}

export function GanttRow(props: {
  row: BoardRow;
  duty: BoardDuty | null;
  total: number;
  ctx: PlanningContext;
  depotTotal?: DepotOrderTotal;
  defaultStart: string;
  onStartTime: (duty: BoardDuty, time: string) => void;
  onOpen: (duty: BoardDuty) => void;
  onPublish: (duty: BoardDuty) => void;
  onUnpublish: (duty: BoardDuty) => void;
}) {
  const { row, duty, total, ctx, depotTotal } = props;
  const navigate = useNavigate();
  const { isOver, setNodeRef } = useDroppable({ id: `driver:${row.driver.id}`, data: { driverId: row.driver.id } });
  const ev = row.evaluation;
  const timeline = ev?.timeline;
  const hasWork = !!duty && duty.trips.some((t) => t.drops.length > 0);
  const vehicle = ev?.vehicleId ? ctx.vehicles.get(ev.vehicleId) : row.driver.vehicleId ? ctx.vehicles.get(row.driver.vehicleId) : undefined;
  const swapped = !!duty?.vehicleId && duty.vehicleId !== row.driver.vehicleId;
  const cap = ctx.settings.orderCaps.find((c) => c.depotId === row.driver.homeDepotId);
  const night = row.driver.shift === 'night';

  const problems = (ev?.issues ?? []).filter((i) => i.level !== 'info');
  const lastEnd = timeline?.segments.length ? timeline.segments[timeline.segments.length - 1].end : timeline?.start ?? 0;

  return (
    <div ref={setNodeRef} className={`gantt-row ${isOver ? 'drop-over' : ''}`} data-testid={`row-${row.driver.id}`}>
      <div className="head">
        <Space size={6} align="center">
          <span className="name">{row.driver.name}</span>
          <Tag color={night ? 'purple' : 'default'}>{SHIFT_LABELS[row.driver.shift]}</Tag>
          {duty?.status === 'published' && <Tag color="green">已發布</Tag>}
          {duty?.status === 'draft' && hasWork && <Tag>草稿</Tag>}
        </Space>
        <div style={{ color: '#667085', fontSize: 12 }}>
          {locationName(ctx, row.driver.homeDepotId)} · {vehicle?.name ?? '未指定車輛'}
          {swapped && <Tag color="gold" style={{ marginLeft: 4 }}>換掛</Tag>}
        </div>
        <Space size={4} wrap style={{ marginTop: 4 }}>
          <span>出車</span>
          {night ? (
            <Tooltip title="大夜班出車時間固定，可在設定頁修改">
              <span>
                <Tag>{ctx.settings.nightShift.startTime}</Tag>
              </span>
            </Tooltip>
          ) : (
            <TimePicker
              size="small"
              format="HH:mm"
              minuteStep={5}
              allowClear={false}
              needConfirm={false}
              disabled={!duty}
              value={timeToDayjs(duty?.startTime ?? props.defaultStart)}
              onChange={(v) => duty && v && props.onStartTime(duty, v.format('HH:mm'))}
              style={{ width: 78 }}
            />
          )}
          <span>收車</span>
          {hasWork ? (
            timeline?.end != null ? (
              <b data-testid={`end-${row.driver.id}`}>{formatMinutes(timeline.end)}</b>
            ) : (
              <Typography.Text type="danger" strong data-testid={`end-${row.driver.id}`}>
                無法計算
              </Typography.Text>
            )
          ) : (
            <span>—</span>
          )}
        </Space>
        <div style={{ marginTop: 4 }}>
          <Space size={6} wrap>
            <span>
              <Tooltip title="單數以車趟計算：一趟送兩站算 1 單">
                <span>單數</span>
              </Tooltip>{' '}
              <b>{ev?.tripCount ?? 0}</b>
              {cap?.scope === 'perDriver' && ` / ${cap.maxOrders}`}
              {cap?.scope === 'depotTotal' && depotTotal && (
                <span style={{ color: '#667085' }}>
                  （{locationName(ctx, row.driver.homeDepotId).replace('廠', '')}合計 {depotTotal.tripCount}/{cap.maxOrders}）
                </span>
              )}
            </span>
            {hasWork && ev && (
              <Popover title={`${row.driver.name} 規則檢查`} content={<div style={{ width: 360, maxHeight: 400, overflow: 'auto' }}><IssueList issues={ev.issues} /></div>} trigger="click">
                <span>
                  <Badge status={STATUS[ev.status].color} text={<a data-testid={`status-${row.driver.id}`}>{STATUS[ev.status].text}</a>} />
                </span>
              </Popover>
            )}
          </Space>
        </div>
        {duty && hasWork && (
          <Space size={4} style={{ marginTop: 6 }}>
            <Button size="small" onClick={() => props.onOpen(duty)}>
              車趟
            </Button>
            {duty.status === 'published' ? (
              <Button size="small" onClick={() => props.onUnpublish(duty)}>
                取消發布
              </Button>
            ) : (
              <Button size="small" type="primary" onClick={() => props.onPublish(duty)} data-testid={`publish-${row.driver.id}`}>
                發布
              </Button>
            )}
          </Space>
        )}
      </div>
      <div className="track-area">
        <div className="track">
          {Array.from({ length: total / 60 }, (_, h) => (
            <div key={h} className="grid-line" style={{ left: pct(h * 60, total) }} />
          ))}
          {!hasWork && <div className="empty-track">{night ? '大夜班' : '日班'}：把訂單拖到這裡排班</div>}
          {hasWork &&
            timeline?.segments.map((s, i) => (
              <Tooltip key={i} title={segmentTooltip(s, ctx, duty!)}>
                <div
                  className={`seg ${s.kind}`}
                  style={{ left: pct(s.start, total), width: pct(s.end - s.start, total) }}
                  onClick={() => duty && props.onOpen(duty)}
                >
                  {segmentText(s, ctx)}
                </div>
              </Tooltip>
            ))}
          {hasWork && timeline && !timeline.complete && timeline.missingLegs[0] && (
            <Tooltip title="點一下到設定頁補上路段時間">
              <div
                className="seg missing"
                style={{ left: pct(lastEnd, total), width: pct(Math.min(180, total - lastEnd), total) }}
                onClick={() => navigate(legLink(timeline.missingLegs[0]))}
              >
                缺少路段時間：{locationName(ctx, timeline.missingLegs[0].fromId)}→{locationName(ctx, timeline.missingLegs[0].toId)}
              </div>
            </Tooltip>
          )}
        </div>
        {problems.length > 0 && (
          <div className="issue-lines">
            {problems.slice(0, 4).map((p, i) => (
              <div key={i} className={p.level}>
                ● {p.message}
                {p.leg && (
                  <>
                    {' '}
                    <a onClick={() => navigate(legLink(p.leg!))}>補上</a>
                  </>
                )}
              </div>
            ))}
            {problems.length > 4 && <div style={{ color: '#667085' }}>還有 {problems.length - 4} 項，點「{STATUS[ev!.status].text}」查看</div>}
          </div>
        )}
      </div>
    </div>
  );
}

export function Legend() {
  return (
    <span className="legend">
      <span>
        <i style={{ background: 'var(--seg-drive)' }} />
        行駛
      </span>
      <span>
        <i style={{ background: 'var(--seg-load)' }} />
        灌油
      </span>
      <span>
        <i style={{ background: 'var(--seg-unload)' }} />
        卸油
      </span>
      <span>
        <i style={{ background: '#ced4da' }} />
        等待
      </span>
      <span>
        <i style={{ background: '#ffc9c9', border: '1px dashed #e03131' }} />
        缺少路段
      </span>
    </span>
  );
}
