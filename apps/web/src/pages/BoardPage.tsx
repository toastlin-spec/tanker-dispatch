import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { LeftOutlined, PrinterOutlined, RightOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { addDays, assignOrderToDuty, evaluateBoard, formatDateShort, type Issue } from '@tanker/core';
import { Alert, App, Button, DatePicker, Space, Spin, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, api, type BoardDuty, type BoardResponse, type LocationRow } from '../api';
import { DutyDrawer } from '../board/DutyDrawer';
import { GanttAxis, GanttRow, Legend, axisEnd } from '../board/Gantt';
import { OrderCardBody, OrderPool, type ProductFilter, type RegionFilter } from '../board/OrderPool';
import { PublishModal } from '../board/PublishModal';
import { OrderFormModal } from '../components/OrderFormModal';
import { fromDayjs, toDayjs, todayTaipei } from '../dates';
import { keys, useBoard, useMaster, usePlanning } from '../queries';

const DATE_KEY = 'board.date';

/** 記住看板上次選的日期（只在這個分頁），從其他頁回來時不會跳回今天。 */
function rememberedDate(): string | null {
  try {
    return sessionStorage.getItem(DATE_KEY);
  } catch {
    return null;
  }
}

function rememberDate(date: string) {
  try {
    sessionStorage.setItem(DATE_KEY, date);
  } catch {
    // 瀏覽器不允許儲存時就不記。
  }
}

export function BoardPage() {
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? rememberedDate() ?? todayTaipei();
  const setDate = (d: string) => {
    rememberDate(d);
    setParams((p) => {
      p.set('date', d);
      return p;
    });
  };
  const { message } = App.useApp();
  const qc = useQueryClient();
  const master = useMaster();
  const board = useBoard(date);
  const planning = usePlanning(master.data, board.data?.orders);

  const [region, setRegion] = useState<RegionFilter>('all');
  const [product, setProduct] = useState<ProductFilter>('all');
  const [dragging, setDragging] = useState<string | null>(null);
  const [drawerDutyId, setDrawerDutyId] = useState<string | null>(null);
  const [publishDutyId, setPublishDutyId] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<{ message: string; issues?: Issue[] } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [orderModal, setOrderModal] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const evaluation = useMemo(() => {
    if (!planning || !board.data) return null;
    return evaluateBoard(date, planning.data, board.data.duties, planning.ctx);
  }, [planning, board.data, date]);

  const stations = useMemo(() => new Map<string, LocationRow>((master.data?.locations ?? []).map((l) => [l.id, l])), [master.data]);

  useEffect(() => {
    if (params.get('date')) rememberDate(date);
  }, [params, date]);

  const pending = useMemo(() => {
    if (!board.data || !evaluation) return [];
    return board.data.orders.filter((o) => o.date === date && o.status === 'pending' && !evaluation.assignedOrderIds.has(o.id));
  }, [board.data, evaluation, date]);

  if (master.error || board.error) {
    return <Alert type="error" showIcon message="載入失敗" description={((master.error ?? board.error) as Error).message} />;
  }
  if (!master.data || !board.data || !planning || !evaluation) return <Spin style={{ margin: 40 }} />;

  const ctx = planning.ctx;
  const duties = board.data.duties.filter((d) => d.date === date);
  const dutyOf = (driverId: string) => duties.find((d) => d.driverId === driverId) ?? null;
  const evaluationOf = (dutyId: string | null) => evaluation.rows.find((r) => r.evaluation?.duty.id === dutyId)?.evaluation ?? null;
  const total = axisEnd(evaluation.rows);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['board'] });
    void qc.invalidateQueries({ queryKey: ['orders'] });
    void qc.invalidateQueries({ queryKey: ['sheets'] });
  };

  /** 先更新畫面再送出；失敗時重新載入。 */
  const saveTrips = async (duty: BoardDuty, trips: BoardDuty['trips']) => {
    qc.setQueryData<BoardResponse>(keys.board(date), (old) =>
      old ? { ...old, duties: old.duties.map((d) => (d.id === duty.id ? { ...d, trips, status: 'draft' } : d)) } : old,
    );
    try {
      await api.replaceTrips(duty.id, trips);
      if (duty.status === 'published') message.warning('已發布的班表改回草稿，請重新發布');
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      refresh();
    }
  };

  const updateDuty = async (duty: BoardDuty, patch: { startTime?: string; vehicleId?: string | null }) => {
    qc.setQueryData<BoardResponse>(keys.board(date), (old) =>
      old ? { ...old, duties: old.duties.map((d) => (d.id === duty.id ? { ...d, ...patch } : d)) } : old,
    );
    try {
      await api.updateDuty(duty.id, patch);
      if (duty.status === 'published') message.warning('已發布的班表改回草稿，請重新發布');
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      refresh();
    }
  };

  const onDragStart = (e: DragStartEvent) => setDragging(String(e.active.data.current?.orderId ?? ''));

  const onDragEnd = async (e: DragEndEvent) => {
    setDragging(null);
    const orderId = e.active.data.current?.orderId as string | undefined;
    const driverId = e.over?.data.current?.driverId as string | undefined;
    if (!orderId || !driverId) return;
    const order = board.data!.orders.find((o) => o.id === orderId);
    if (!order) return;
    try {
      let duty = dutyOf(driverId);
      if (!duty) {
        duty = await api.createDuty({ driverId, date });
      }
      const result = assignOrderToDuty(duty, order, ctx);
      if (!result.ok) {
        message.error(result.error);
        refresh();
        return;
      }
      const driver = ctx.drivers.get(driverId);
      if (!dutyOf(driverId)) {
        qc.setQueryData<BoardResponse>(keys.board(date), (old) => (old ? { ...old, duties: [...old.duties, { ...duty!, trips: result.plan.trips }] } : old));
      }
      await saveTrips(duty, result.plan.trips);
      message.success(`已排入${driver?.name ?? ''}的第 ${result.tripIndexes.map((i) => i + 1).join('、')} 趟`);
    } catch (err) {
      message.error((err as Error).message);
      refresh();
    }
  };

  const publish = async (reason: string) => {
    if (!publishDutyId) return;
    setPublishing(true);
    setPublishError(null);
    try {
      await api.publishDuty(publishDutyId, reason || undefined);
      message.success('班表已發布，可以列印派車單');
      setPublishDutyId(null);
      refresh();
    } catch (err) {
      const e = err as ApiError;
      setPublishError({ message: e.message, issues: e.issues });
    } finally {
      setPublishing(false);
    }
  };

  const unpublish = async (duty: BoardDuty) => {
    try {
      await api.unpublishDuty(duty.id);
      message.success('已取消發布，班表改回草稿');
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      refresh();
    }
  };

  const deleteDuty = async (duty: BoardDuty) => {
    try {
      await api.deleteDuty(duty.id);
      setDrawerDutyId(null);
      message.success('班表已刪除，訂單回到待派');
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      refresh();
    }
  };

  const drawerDuty = duties.find((d) => d.id === drawerDutyId) ?? null;
  const publishDuty = duties.find((d) => d.id === publishDutyId) ?? null;
  const draggingOrder = dragging ? board.data.orders.find((o) => o.id === dragging) : undefined;
  const publishedCount = duties.filter((d) => d.status === 'published').length;

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <div className="page-toolbar">
        <Space.Compact>
          <Button icon={<LeftOutlined />} onClick={() => setDate(addDays(date, -1))} aria-label="前一天" />
          <DatePicker value={toDayjs(date)} onChange={(d) => d && setDate(fromDayjs(d))} allowClear={false} format="YYYY-MM-DD（dd）" />
          <Button icon={<RightOutlined />} onClick={() => setDate(addDays(date, 1))} aria-label="後一天" />
        </Space.Compact>
        <Button onClick={() => setDate(todayTaipei())}>今天</Button>
        <Typography.Text strong>{formatDateShort(date)}</Typography.Text>
        <Legend />
        <span style={{ flex: 1 }} />
        <Link to={`/print?date=${date}`}>
          <Button icon={<PrinterOutlined />}>派車單（已發布 {publishedCount}）</Button>
        </Link>
      </div>
      <div className="board">
        <OrderPool
          orders={pending}
          stations={stations}
          region={region}
          product={product}
          onRegion={setRegion}
          onProduct={setProduct}
          onAdd={() => setOrderModal(true)}
        />
        <div className="gantt">
          <div className="gantt-inner">
            <GanttAxis total={total} />
            {evaluation.rows.map((row) => (
              <GanttRow
                key={row.driver.id}
                row={row}
                duty={dutyOf(row.driver.id)}
                total={total}
                ctx={ctx}
                depotTotal={evaluation.depotTotals.find((t) => t.depotId === row.driver.homeDepotId)}
                defaultStart={master.data!.settings.dayShift.defaultStartTime}
                onStartTime={(duty, time) => updateDuty(duty, { startTime: time })}
                onOpen={(duty) => setDrawerDutyId(duty.id)}
                onPublish={(duty) => {
                  setPublishError(null);
                  setPublishDutyId(duty.id);
                }}
                onUnpublish={unpublish}
              />
            ))}
          </div>
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {draggingOrder ? (
          <div className="order-card" style={{ width: 260, cursor: 'grabbing' }}>
            <OrderCardBody order={draggingOrder} station={stations.get(draggingOrder.stationId)} />
          </div>
        ) : null}
      </DragOverlay>
      <DutyDrawer
        open={!!drawerDuty}
        duty={drawerDuty}
        evaluation={evaluationOf(drawerDuty?.id ?? null)}
        ctx={ctx}
        master={master.data}
        onClose={() => setDrawerDutyId(null)}
        onSaveTrips={saveTrips}
        onUpdate={updateDuty}
        onPublish={(duty) => {
          setPublishError(null);
          setPublishDutyId(duty.id);
        }}
        onUnpublish={unpublish}
        onDelete={deleteDuty}
      />
      <PublishModal
        open={!!publishDuty}
        title={`發布班表：${publishDuty ? ctx.drivers.get(publishDuty.driverId)?.name : ''} ${formatDateShort(date)}`}
        evaluation={evaluationOf(publishDuty?.id ?? null)}
        serverError={publishError?.message}
        serverIssues={publishError?.issues}
        loading={publishing}
        onCancel={() => setPublishDutyId(null)}
        onConfirm={publish}
      />
      <OrderFormModal
        open={orderModal}
        master={master.data}
        defaultDate={date}
        onClose={() => setOrderModal(false)}
        onSaved={() => {
          setOrderModal(false);
          refresh();
        }}
      />
    </DndContext>
  );
}
