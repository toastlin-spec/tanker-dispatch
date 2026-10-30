import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, HolderOutlined } from '@ant-design/icons';
import {
  DUTY_STATUS_LABELS,
  PRODUCT_LABELS,
  SHIFT_LABELS,
  autoLoadingIdForStation,
  buildDispatchSheet,
  formatMinutes,
  locationName,
  removeOrderFromDuty,
  reorderDrops,
  reorderTrips,
  setTripLoading,
  type DropPlan,
  type DutyPlan,
  type DutyEvaluation,
  type PlanningContext,
  type StopTiming,
} from '@tanker/core';
import { App, Button, Card, Descriptions, Drawer, Popconfirm, Select, Space, Table, Tag, TimePicker, Typography } from 'antd';
import type { BoardDuty, Master } from '../api';
import { IssueList } from '../components/IssueList';
import { timeToDayjs } from '../dates';

function SortableDrop(props: {
  id: string;
  drop: DropPlan;
  ctx: PlanningContext;
  stop?: StopTiming;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.id });
  const order = props.ctx.orders.get(props.drop.orderId);
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px',
        border: '1px solid #e3e6ea',
        borderRadius: 6,
        background: '#fff',
        marginBottom: 6,
      }}
    >
      <HolderOutlined {...attributes} {...listeners} style={{ cursor: 'grab', color: '#98a2b3' }} aria-label="拖曳調整順序" />
      <div style={{ flex: 1 }}>
        <b>{locationName(props.ctx, props.drop.stationId)}</b>{' '}
        <Tag color={order?.product === 'diesel' ? 'volcano' : 'blue'}>{order ? PRODUCT_LABELS[order.product] : '?'}</Tag>
        {props.drop.quantityKL}KL · 第 {props.drop.compartmentIdx.map((i) => i + 1).join('、')} 艙
        {props.stop && (
          <div style={{ fontSize: 12, color: '#667085' }}>
            抵達 {formatMinutes(props.stop.arrival)}
            {props.stop.waitMinutes > 0 && `，等待 ${props.stop.waitMinutes} 分`}，卸油 {formatMinutes(props.stop.unloadStart)}–{formatMinutes(props.stop.unloadEnd)}
          </div>
        )}
      </div>
      <Popconfirm title="把這張訂單移出班表？" okText="移出" cancelText="取消" onConfirm={props.onRemove}>
        <Button size="small" danger icon={<DeleteOutlined />}>
          移出
        </Button>
      </Popconfirm>
    </div>
  );
}

export function DutyDrawer(props: {
  open: boolean;
  duty: BoardDuty | null;
  evaluation: DutyEvaluation | null;
  ctx: PlanningContext;
  master: Master;
  onClose: () => void;
  onSaveTrips: (duty: BoardDuty, trips: BoardDuty['trips']) => void;
  onUpdate: (duty: BoardDuty, patch: { startTime?: string; vehicleId?: string | null }) => void;
  onPublish: (duty: BoardDuty) => void;
  onUnpublish: (duty: BoardDuty) => void;
  onDelete: (duty: BoardDuty) => void;
}) {
  const { duty, evaluation, ctx, master } = props;
  const { message } = App.useApp();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  if (!duty || !evaluation) return <Drawer open={props.open} onClose={props.onClose} />;

  const driver = ctx.drivers.get(duty.driverId)!;
  const timeline = evaluation.timeline;
  const trips = duty.trips.filter((t) => t.drops.length > 0);
  const loadings = master.locations.filter((l) => l.type === 'loading');
  const sheet = buildDispatchSheet(evaluation, ctx);
  const save = (next: DutyPlan) => props.onSaveTrips(duty, next.trips);

  const onDragEnd = (tripIndex: number) => (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const [, from] = String(e.active.id).split(':').map(Number);
    const [overTrip, to] = String(e.over.id).split(':').map(Number);
    if (overTrip !== tripIndex) {
      message.info('跨車趟移動請先移出，再從左側重新拖入');
      return;
    }
    save(reorderDrops({ ...duty, trips }, tripIndex, from, to));
  };

  const fixedVehicle = driver.vehicleId ? ctx.vehicles.get(driver.vehicleId) : undefined;

  return (
    <Drawer
      open={props.open}
      onClose={props.onClose}
      width={760}
      title={`${driver.name} · ${duty.date} · ${DUTY_STATUS_LABELS[duty.status]}`}
      extra={
        <Space>
          {duty.status === 'published' ? (
            <Button onClick={() => props.onUnpublish(duty)}>取消發布</Button>
          ) : (
            <>
              <Popconfirm title="刪除這個班表？訂單會回到待派" okText="刪除" cancelText="取消" onConfirm={() => props.onDelete(duty)}>
                <Button danger>刪除班表</Button>
              </Popconfirm>
              <Button type="primary" onClick={() => props.onPublish(duty)}>
                發布
              </Button>
            </>
          )}
        </Space>
      }
    >
      {duty.status === 'published' && (
        <Typography.Paragraph type="warning">這個班表已發布；修改車趟、出車時間或車輛後會改回草稿，需要重新發布。</Typography.Paragraph>
      )}
      <Descriptions size="small" column={2} bordered style={{ marginBottom: 16 }}>
        <Descriptions.Item label="班別">{SHIFT_LABELS[driver.shift]}</Descriptions.Item>
        <Descriptions.Item label="出發廠">{locationName(ctx, driver.homeDepotId)}</Descriptions.Item>
        <Descriptions.Item label="出車時間">
          {driver.shift === 'night' ? (
            `${ctx.settings.nightShift.startTime}（大夜班固定）`
          ) : (
            <TimePicker
              size="small"
              format="HH:mm"
              minuteStep={5}
              allowClear={false}
              needConfirm={false}
              value={timeToDayjs(duty.startTime)}
              onChange={(v) => v && props.onUpdate(duty, { startTime: v.format('HH:mm') })}
            />
          )}
        </Descriptions.Item>
        <Descriptions.Item label="收車時間">
          {timeline.end != null ? formatMinutes(timeline.end) : <Typography.Text type="danger">無法計算（缺少路段時間）</Typography.Text>}
        </Descriptions.Item>
        <Descriptions.Item label="車輛" span={2}>
          <Select
            size="small"
            style={{ width: 320 }}
            value={duty.vehicleId ?? ''}
            onChange={(v) => props.onUpdate(duty, { vehicleId: v || null })}
            options={[
              { value: '', label: `固定車輛（${fixedVehicle?.name ?? '未指定'}）` },
              ...master.vehicles
                .filter((v) => v.active && v.id !== driver.vehicleId)
                .map((v) => ({ value: v.id, label: `換掛：${v.name}（${v.compartmentsKL.join('+')}KL）` })),
            ]}
          />
          <span style={{ marginLeft: 8, color: '#667085' }}>艙位 {evaluation.compartmentsKL.join(' + ')} KL</span>
        </Descriptions.Item>
      </Descriptions>

      <Typography.Title level={5}>車趟</Typography.Title>
      {trips.map((trip, tripIndex) => {
        const auto = autoLoadingIdForStation(trip.drops[0]?.stationId ?? null, driver.shift, driver.homeDepotId, ctx);
        const ids = trip.drops.map((_, i) => `${tripIndex}:${i}`);
        return (
          <Card
            key={tripIndex}
            size="small"
            style={{ marginBottom: 10 }}
            title={
              <Space>
                <span>第 {tripIndex + 1} 趟</span>
                <span style={{ fontWeight: 400 }}>灌油點</span>
                <Select
                  size="small"
                  style={{ width: 170 }}
                  value={trip.loadingId ?? ''}
                  onChange={(v) => save(setTripLoading({ ...duty, trips }, tripIndex, v || null))}
                  options={[
                    { value: '', label: `自動（${auto ? locationName(ctx, auto) : '無法決定'}）` },
                    ...loadings.map((l) => ({ value: l.id, label: `手動：${l.name}` })),
                  ]}
                />
              </Space>
            }
            extra={
              <Space size={4}>
                <Button size="small" icon={<ArrowUpOutlined />} disabled={tripIndex === 0} onClick={() => save(reorderTrips({ ...duty, trips }, tripIndex, tripIndex - 1))}>
                  上移
                </Button>
                <Button
                  size="small"
                  icon={<ArrowDownOutlined />}
                  disabled={tripIndex === trips.length - 1}
                  onClick={() => save(reorderTrips({ ...duty, trips }, tripIndex, tripIndex + 1))}
                >
                  下移
                </Button>
              </Space>
            }
          >
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd(tripIndex)}>
              <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                {trip.drops.map((d, i) => (
                  <SortableDrop
                    key={ids[i]}
                    id={ids[i]}
                    drop={d}
                    ctx={ctx}
                    stop={timeline.stops.find((s) => s.tripIndex === tripIndex && s.orderIds.includes(d.orderId))}
                    onRemove={() => save(removeOrderFromDuty({ ...duty, trips }, d.orderId))}
                  />
                ))}
              </SortableContext>
            </DndContext>
            {trip.drops.length > 1 && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                拖曳左側把手可調整送油順序
              </Typography.Text>
            )}
          </Card>
        );
      })}

      <Typography.Title level={5} style={{ marginTop: 16 }}>
        時間軸
      </Typography.Title>
      <Table
        size="small"
        pagination={false}
        rowKey="key"
        dataSource={sheet.rows.map((r, key) => ({ ...r, key }))}
        columns={[
          { title: '時間', render: (_, r) => `${r.start}–${r.end}`, width: 150 },
          { title: '動作', dataIndex: 'kindLabel', width: 70 },
          { title: '地點', dataIndex: 'place' },
          { title: '內容', dataIndex: 'detail' },
        ]}
        footer={
          sheet.missingLegs.length
            ? () => <Typography.Text type="danger">缺少路段時間：{sheet.missingLegs.join('、')}，之後的時間無法計算</Typography.Text>
            : undefined
        }
      />

      <Typography.Title level={5} style={{ marginTop: 16 }}>
        規則檢查
      </Typography.Title>
      <IssueList issues={evaluation.issues} />
    </Drawer>
  );
}
