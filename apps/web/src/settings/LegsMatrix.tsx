import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LEG_SOURCES,
  LEG_SOURCE_LABELS,
  LOCATION_TYPE_LABELS,
  addDays,
  buildTimeline,
  suggestLegMinutes,
  type LegSource,
  type PlanningContext,
} from '@tanker/core';
import { Alert, App, Button, Checkbox, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Tag, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { api, type LegRow, type Master } from '../api';
import { todayTaipei } from '../dates';
import { usePlanning } from '../queries';

const SOURCE_COLORS: Record<LegSource, string> = {
  confirmed: 'green',
  excel: 'blue',
  'google_x1.5': 'gold',
  estimate: 'orange',
  manual: 'purple',
};

interface EditTarget {
  fromId: string;
  toId: string;
}

/** 近期班表（前 7 天到後 30 天）用到但缺少的路段。 */
function useNeededLegs(master: Master) {
  const from = addDays(todayTaipei(), -7);
  const to = addDays(todayTaipei(), 30);
  const duties = useQuery({ queryKey: ['duties', from, to], queryFn: () => api.duties(from, to) });
  const orders = useQuery({ queryKey: ['orders', { from, to }], queryFn: () => api.orders({ from, to }) });
  const planning = usePlanning(master, orders.data);
  return useMemo(() => {
    const needed = new Map<string, { fromId: string; toId: string; count: number }>();
    if (!planning || !duties.data) return needed;
    for (const duty of duties.data) {
      if (!planning.ctx.drivers.has(duty.driverId)) continue;
      for (const leg of buildTimeline(duty, planning.ctx as PlanningContext).missingLegs) {
        const key = `${leg.fromId}>${leg.toId}`;
        const entry = needed.get(key) ?? { fromId: leg.fromId, toId: leg.toId, count: 0 };
        entry.count += 1;
        needed.set(key, entry);
      }
    }
    return needed;
  }, [planning, duties.data]);
}

export function LegsMatrix({ master, focus }: { master: Master; focus?: EditTarget }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [form] = Form.useForm();
  const needed = useNeededLegs(master);
  const factor = master.settings.carToTruckFactor;
  const [google, setGoogle] = useState<number | null>(null);

  const locations = master.locations;
  const byKey = useMemo(() => new Map(master.legs.map((l) => [`${l.fromId}>${l.toId}`, l])), [master.legs]);
  const name = (id: string) => locations.find((l) => l.id === id)?.name ?? id;

  useEffect(() => {
    if (focus && locations.some((l) => l.id === focus.fromId) && locations.some((l) => l.id === focus.toId)) setEditing(focus);
  }, [focus?.fromId, focus?.toId]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = editing ? byKey.get(`${editing.fromId}>${editing.toId}`) : undefined;
  const reverse = editing ? byKey.get(`${editing.toId}>${editing.fromId}`) : undefined;

  useEffect(() => {
    if (!editing) return;
    setGoogle(null);
    form.setFieldsValue({
      minutes: current?.minutes ?? null,
      source: current?.source ?? 'manual',
      note: current?.note ?? '',
      alsoReverse: !current && !reverse,
    });
  }, [editing, current, reverse, form]);

  const save = async () => {
    const v = await form.validateFields();
    try {
      await api.upsertLeg({ fromId: editing!.fromId, toId: editing!.toId, minutes: v.minutes, source: v.source, note: v.note || null, alsoReverse: v.alsoReverse });
      message.success('路段已儲存，看板會用新的時間重算');
      setEditing(null);
      await qc.invalidateQueries();
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  const remove = async (leg: LegRow) => {
    try {
      await api.deleteLeg(leg.id);
      message.success('路段已刪除');
      setEditing(null);
      await qc.invalidateQueries();
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  const neededList = [...needed.values()];

  return (
    <>
      {neededList.length > 0 ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message={`近期班表缺少 ${neededList.length} 個路段時間，這些班表無法計算時間、也不能發布`}
          description={
            <Space wrap>
              {neededList.map((n) => (
                <Button key={`${n.fromId}>${n.toId}`} size="small" danger onClick={() => setEditing(n)}>
                  {name(n.fromId)}→{name(n.toId)}（{n.count} 個班表）
                </Button>
              ))}
            </Space>
          }
        />
      ) : (
        <Alert type="success" showIcon style={{ marginBottom: 12 }} message="近期班表用到的路段時間都已齊全" />
      )}
      <Space wrap style={{ marginBottom: 8 }}>
        <span>來源：</span>
        {LEG_SOURCES.map((s) => (
          <Tag key={s} color={SOURCE_COLORS[s]}>
            {LEG_SOURCE_LABELS[s]}
          </Tag>
        ))}
        <Tag color="red">紅框：班表需要但缺少</Tag>
        <Typography.Text type="secondary">列是起點、欄是終點；點格子可修改。路段有方向性，兩個方向分開存。</Typography.Text>
      </Space>
      <div style={{ overflow: 'auto', maxHeight: '70vh', background: '#fff' }}>
        <table className="leg-matrix">
          <thead>
            <tr>
              <th className="row-head">起點 ＼ 終點</th>
              {locations.map((l) => (
                <th key={l.id} title={LOCATION_TYPE_LABELS[l.type]}>
                  {l.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {locations.map((from) => (
              <tr key={from.id}>
                <th className="row-head">
                  {from.name}
                  <span style={{ color: '#98a2b3', fontWeight: 400, marginLeft: 4 }}>{LOCATION_TYPE_LABELS[from.type]}</span>
                </th>
                {locations.map((to) => {
                  if (from.id === to.id) return <td key={to.id} className="self" />;
                  const key = `${from.id}>${to.id}`;
                  const leg = byKey.get(key);
                  const isNeeded = !leg && needed.has(key);
                  const isFocus = editing?.fromId === from.id && editing?.toId === to.id;
                  const cls = [leg ? `src-${leg.source}` : 'empty', isNeeded ? 'needed' : '', isFocus ? 'focus' : ''].join(' ');
                  return (
                    <td key={to.id} className={cls}>
                      <button
                        type="button"
                        title={`${from.name}→${to.name}${leg ? `：${leg.minutes} 分（${LEG_SOURCE_LABELS[leg.source]}）${leg.note ? `\n${leg.note}` : ''}` : '：未設定'}`}
                        onClick={() => setEditing({ fromId: from.id, toId: to.id })}
                        data-testid={`leg-${key}`}
                      >
                        {leg ? leg.minutes : isNeeded ? '缺' : '—'}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={!!editing}
        title={editing ? `路段時間：${name(editing.fromId)} → ${name(editing.toId)}` : ''}
        okText="儲存"
        cancelText="取消"
        onOk={save}
        onCancel={() => setEditing(null)}
        footer={(_, { OkBtn, CancelBtn }) => (
          <Space>
            {current && (
              <Popconfirm title="刪除這個方向的路段？" okText="刪除" cancelText="取消" onConfirm={() => remove(current)}>
                <Button danger>刪除</Button>
              </Popconfirm>
            )}
            <CancelBtn />
            <OkBtn />
          </Space>
        )}
      >
        {!current && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="這個方向還沒有路段時間。系統不會自行推估，請輸入確認過的時間。" />}
        {reverse && (
          <Typography.Paragraph type="secondary">
            反方向（{name(reverse.fromId)}→{name(reverse.toId)}）目前是 {reverse.minutes} 分（{LEG_SOURCE_LABELS[reverse.source]}）。
          </Typography.Paragraph>
        )}
        <Form form={form} layout="vertical">
          <Form.Item label={`建議值：Google 地圖小客車時間的下限 × ${factor}，進位到 5 分`}>
            <Space.Compact>
              <InputNumber min={1} placeholder="Google 時間" value={google} onChange={(v) => setGoogle(v)} suffix="分" style={{ width: 180 }} />
              <Button
                disabled={!google}
                onClick={() => {
                  form.setFieldsValue({ minutes: suggestLegMinutes(google!, factor), source: 'google_x1.5' });
                }}
              >
                套用 {google ? `${suggestLegMinutes(google, factor)} 分` : ''}
              </Button>
            </Space.Compact>
          </Form.Item>
          <Form.Item name="minutes" label="油罐車行車時間" rules={[{ required: true, message: '請輸入分鐘' }]}>
            <InputNumber min={1} step={5} suffix="分" style={{ width: 180 }} />
          </Form.Item>
          <Form.Item name="source" label="來源" rules={[{ required: true }]}>
            <Select style={{ width: 220 }} options={LEG_SOURCES.map((s) => ({ value: s, label: LEG_SOURCE_LABELS[s] }))} />
          </Form.Item>
          <Form.Item name="note" label="備註">
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item name="alsoReverse" valuePropName="checked">
            <Checkbox>同時寫入反方向（{editing ? `${name(editing.toId)}→${name(editing.fromId)}` : ''}）</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
