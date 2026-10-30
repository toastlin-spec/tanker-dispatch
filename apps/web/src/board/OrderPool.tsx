import { useDraggable } from '@dnd-kit/core';
import { PRODUCT_LABELS, REGION_LABELS, productFamily, type Order, type Product, type Region } from '@tanker/core';
import { Button, Card, Empty, Segmented, Space, Tag, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { LocationRow } from '../api';

export function OrderCardBody({ order, station }: { order: Order; station?: LocationRow }) {
  const window = order.windowStart || order.windowEnd ? `希望 ${order.windowStart ?? ''}～${order.windowEnd ?? ''}` : null;
  const hours = station && !station.hours24 ? `營業 ${station.openTime}–${station.closeTime}` : '24 小時';
  return (
    <>
      <div className="title">
        <span>{station?.name ?? order.stationId}</span>
        <span>{order.quantityKL}KL</span>
      </div>
      <div className="meta">
        <Tag color={productFamily(order.product) === 'diesel' ? 'volcano' : 'blue'} style={{ marginRight: 4 }}>
          {PRODUCT_LABELS[order.product]}
        </Tag>
        {station ? REGION_LABELS[station.region] : ''} · {hours}
      </div>
      {(window || order.note) && <div className="meta">{[window, order.note].filter(Boolean).join(' · ')}</div>}
    </>
  );
}

function DraggableOrder({ order, station }: { order: Order; station?: LocationRow }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `order:${order.id}`, data: { orderId: order.id } });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`order-card ${productFamily(order.product)} ${isDragging ? 'dragging' : ''}`}
      data-testid={`order-${order.id}`}
    >
      <OrderCardBody order={order} station={station} />
    </div>
  );
}

export type RegionFilter = 'all' | Region;
export type ProductFilter = 'all' | Product;

export function OrderPool(props: {
  orders: Order[];
  stations: Map<string, LocationRow>;
  region: RegionFilter;
  product: ProductFilter;
  onRegion: (r: RegionFilter) => void;
  onProduct: (p: ProductFilter) => void;
  onAdd: () => void;
}) {
  const { orders, stations, region, product } = props;
  const shown = orders.filter((o) => {
    const s = stations.get(o.stationId);
    return (region === 'all' || s?.region === region) && (product === 'all' || o.product === product);
  });
  return (
    <Card
      className="order-pool"
      size="small"
      title={`待派訂單（${shown.length}${shown.length !== orders.length ? ` / ${orders.length}` : ''}）`}
      extra={
        <Button size="small" icon={<PlusOutlined />} onClick={props.onAdd}>
          新增
        </Button>
      }
    >
      <Space direction="vertical" size={6} style={{ width: '100%', marginBottom: 10 }}>
        <Segmented<RegionFilter>
          block
          size="small"
          value={region}
          onChange={props.onRegion}
          options={[
            { value: 'all', label: '全部' },
            { value: 'central', label: '中部' },
            { value: 'south', label: '南部' },
          ]}
        />
        <Segmented<ProductFilter>
          block
          size="small"
          value={product}
          onChange={props.onProduct}
          options={[
            { value: 'all', label: '全部' },
            { value: '92', label: '92' },
            { value: '95', label: '95' },
            { value: '98', label: '98' },
            { value: 'diesel', label: '柴油' },
          ]}
        />
      </Space>
      {shown.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={orders.length ? '沒有符合篩選的訂單' : '這一天沒有待派訂單'} />
      ) : (
        shown.map((o) => <DraggableOrder key={o.id} order={o} station={stations.get(o.stationId)} />)
      )}
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
        把訂單拖到右側司機列，系統會自動組成車趟、選灌油點並分配艙位。
      </Typography.Paragraph>
    </Card>
  );
}
