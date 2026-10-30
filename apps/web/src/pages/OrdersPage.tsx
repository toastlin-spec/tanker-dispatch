import { PlusOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ORDER_STATUS_LABELS, PRODUCT_LABELS, REGION_LABELS, addDays, formatDateShort, type OrderStatus } from '@tanker/core';
import { App, Button, DatePicker, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type OrderRow } from '../api';
import { OrderFormModal } from '../components/OrderFormModal';
import { fromDayjs, toDayjs, todayTaipei } from '../dates';
import { keys, useMaster } from '../queries';

const STATUS_COLORS: Record<OrderStatus, string> = { pending: 'gold', scheduled: 'blue', completed: 'green', cancelled: 'default' };

export function OrdersPage() {
  const today = todayTaipei();
  const [range, setRange] = useState<[string, string]>([today, addDays(today, 6)]);
  const [statuses, setStatuses] = useState<OrderStatus[]>([]);
  const [editing, setEditing] = useState<OrderRow | null | undefined>(undefined);
  const { message } = App.useApp();
  const qc = useQueryClient();
  const master = useMaster();
  const params = { from: range[0], to: range[1], status: statuses.length ? statuses : undefined };
  const orders = useQuery({ queryKey: keys.orders(params), queryFn: () => api.orders(params) });
  const names = new Map((master.data?.locations ?? []).map((l) => [l.id, l]));

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['orders'] });
    void qc.invalidateQueries({ queryKey: ['board'] });
  };
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      message.success(ok);
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      refresh();
    }
  };

  return (
    <>
      <div className="page-toolbar">
        <Typography.Title level={4} style={{ margin: 0 }}>
          訂單管理
        </Typography.Title>
        <DatePicker.RangePicker
          value={[toDayjs(range[0]), toDayjs(range[1])]}
          allowClear={false}
          onChange={(v) => v?.[0] && v[1] && setRange([fromDayjs(v[0]), fromDayjs(v[1])])}
        />
        <Select
          mode="multiple"
          allowClear
          placeholder="全部狀態"
          style={{ minWidth: 200 }}
          value={statuses}
          onChange={setStatuses}
          options={(Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]).map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] }))}
        />
        <span style={{ flex: 1 }} />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing(null)}>
          新增訂單
        </Button>
      </div>
      <Table<OrderRow>
        rowKey="id"
        size="middle"
        loading={orders.isLoading}
        dataSource={orders.data ?? []}
        pagination={{ pageSize: 50, hideOnSinglePage: true }}
        columns={[
          { title: '日期', dataIndex: 'date', render: (d: string) => formatDateShort(d), sorter: (a, b) => a.date.localeCompare(b.date), width: 110 },
          {
            title: '油站',
            dataIndex: 'stationId',
            render: (id: string) => names.get(id)?.name ?? id,
            filters: [...names.values()].filter((l) => l.type === 'station').map((l) => ({ text: l.name, value: l.id })),
            onFilter: (v, r) => r.stationId === v,
          },
          { title: '區域', render: (_, r) => (names.get(r.stationId) ? REGION_LABELS[names.get(r.stationId)!.region] : ''), width: 70 },
          { title: '油品', dataIndex: 'product', render: (p: OrderRow['product']) => PRODUCT_LABELS[p], width: 90 },
          { title: '數量', dataIndex: 'quantityKL', render: (q: number) => `${q} KL`, align: 'right', width: 80 },
          {
            title: '希望到達',
            render: (_, r) => (r.windowStart || r.windowEnd ? `${r.windowStart ?? ''}～${r.windowEnd ?? ''}` : ''),
            width: 110,
          },
          {
            title: '狀態',
            dataIndex: 'status',
            render: (s: OrderStatus) => <Tag color={STATUS_COLORS[s]}>{ORDER_STATUS_LABELS[s]}</Tag>,
            width: 80,
          },
          {
            title: '班表',
            render: (_, r) =>
              r.assignments.map((a) => (
                <Link key={a.dutyId} to={`/?date=${a.date}`}>
                  {a.driverName} {formatDateShort(a.date)}
                  {a.status === 'published' ? '（已發布）' : '（草稿）'}
                </Link>
              )),
          },
          { title: '備註', dataIndex: 'note', ellipsis: true },
          {
            title: '操作',
            width: 220,
            render: (_, r) => (
              <Space size={4} wrap>
                <Button size="small" onClick={() => setEditing(r)}>
                  修改
                </Button>
                {(r.status === 'pending' || r.status === 'scheduled') && (
                  <Popconfirm
                    title="取消這張訂單？"
                    description={r.assignments.length ? '會一併從草稿班表移除' : undefined}
                    okText="取消訂單"
                    cancelText="不要"
                    onConfirm={() => act(() => api.cancelOrder(r.id), '訂單已取消')}
                  >
                    <Button size="small" danger>
                      取消
                    </Button>
                  </Popconfirm>
                )}
                {r.status === 'cancelled' && (
                  <Button size="small" onClick={() => act(() => api.restoreOrder(r.id), '訂單已恢復為待派')}>
                    恢復
                  </Button>
                )}
                {r.status === 'scheduled' && r.assignments.some((a) => a.status === 'published') && (
                  <Button size="small" onClick={() => act(() => api.completeOrder(r.id), '訂單已標記完成')}>
                    完成
                  </Button>
                )}
                {r.status === 'completed' && (
                  <Button size="small" onClick={() => act(() => api.reopenOrder(r.id), '訂單已改回未完成')}>
                    改回
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
      />
      <OrderFormModal
        open={editing !== undefined}
        master={master.data}
        order={editing}
        defaultDate={range[0]}
        onClose={() => setEditing(undefined)}
        onSaved={() => {
          setEditing(undefined);
          refresh();
        }}
      />
    </>
  );
}
