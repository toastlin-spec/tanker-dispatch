import { PRODUCTS, PRODUCT_LABELS, REGION_LABELS, type Product, type Region } from '@tanker/core';
import { App, DatePicker, Form, Input, InputNumber, Modal, Radio, Select, TimePicker, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import { useEffect } from 'react';
import { api, type Master, type OrderInput, type OrderRow } from '../api';
import { fromDayjs, timeToDayjs, toDayjs } from '../dates';

interface FormValues {
  stationId: string;
  date: Dayjs;
  product: Product;
  quantityKL: number;
  window?: [Dayjs | null, Dayjs | null] | null;
  note?: string;
}

export function stationOptions(master: Master | undefined) {
  const stations = (master?.locations ?? []).filter((l) => l.type === 'station');
  return (['central', 'south'] as Region[]).map((region) => ({
    label: REGION_LABELS[region],
    options: stations.filter((s) => s.region === region).map((s) => ({ value: s.id, label: s.name })),
  }));
}

export function OrderFormModal(props: {
  open: boolean;
  master: Master | undefined;
  order?: OrderRow | null;
  defaultDate: string;
  onClose: () => void;
  onSaved: (order: OrderRow) => void;
}) {
  const { open, master, order, defaultDate, onClose, onSaved } = props;
  const [form] = Form.useForm<FormValues>();
  const { message } = App.useApp();
  const locked = !!order && (order.assignments.length > 0 || order.status === 'cancelled' || order.status === 'completed');

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue(
      order
        ? {
            stationId: order.stationId,
            date: toDayjs(order.date),
            product: order.product,
            quantityKL: order.quantityKL,
            window: order.windowStart || order.windowEnd ? ([timeToDayjs(order.windowStart), timeToDayjs(order.windowEnd)] as [Dayjs | null, Dayjs | null]) : undefined,
            note: order.note ?? undefined,
          }
        : { date: toDayjs(defaultDate), product: '92', quantityKL: 15 },
    );
  }, [open, order, defaultDate, form]);

  const submit = async () => {
    const v = await form.validateFields();
    const input: OrderInput = {
      stationId: v.stationId,
      date: fromDayjs(v.date),
      product: v.product,
      quantityKL: v.quantityKL,
      windowStart: v.window?.[0]?.format('HH:mm') ?? null,
      windowEnd: v.window?.[1]?.format('HH:mm') ?? null,
      note: v.note?.trim() || null,
    };
    try {
      const saved = order ? await api.updateOrder(order.id, input) : await api.createOrder(input);
      message.success(order ? '訂單已修改' : '訂單已新增');
      onSaved(saved);
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  return (
    <Modal open={open} title={order ? '修改訂單' : '新增訂單'} okText="儲存" cancelText="取消" onOk={submit} onCancel={onClose} destroyOnHidden>
      {locked && (
        <Typography.Paragraph type="warning">
          {order?.assignments.length ? '這張訂單已排入班表，油站、日期、油品與數量要先從班表移除才能修改。' : '這張訂單已取消或完成，只能修改備註與希望到達時段。'}
        </Typography.Paragraph>
      )}
      <Form form={form} layout="vertical" requiredMark="optional">
        <Form.Item name="stationId" label="油站" rules={[{ required: true, message: '請選擇油站' }]}>
          <Select options={stationOptions(master)} placeholder="選擇油站" disabled={locked} showSearch optionFilterProp="label" />
        </Form.Item>
        <Form.Item name="date" label="日期" rules={[{ required: true, message: '請選擇日期' }]}>
          <DatePicker style={{ width: '100%' }} disabled={locked} allowClear={false} />
        </Form.Item>
        <Form.Item name="product" label="油品" rules={[{ required: true, message: '請選擇油品' }]}>
          <Radio.Group disabled={locked} optionType="button" options={PRODUCTS.map((p) => ({ value: p, label: PRODUCT_LABELS[p] }))} />
        </Form.Item>
        <Form.Item
          name="quantityKL"
          label="數量"
          extra="15KL 以下用一艙，15～30KL 用兩艙，超過 30KL 會自動拆成多趟"
          rules={[
            { required: true, message: '請輸入數量' },
            { type: 'number', min: 0.001, message: '數量必須大於 0' },
          ]}
        >
          <InputNumber style={{ width: '100%' }} min={0} step={1} suffix="KL" disabled={locked} />
        </Form.Item>
        <Form.Item name="window" label="希望到達時段（選填）">
          <TimePicker.RangePicker format="HH:mm" minuteStep={5} style={{ width: '100%' }} allowEmpty={[true, true]} placeholder={['最早', '最晚']} />
        </Form.Item>
        <Form.Item name="note" label="備註">
          <Input.TextArea rows={2} maxLength={500} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
