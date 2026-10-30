import { PlusOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import {
  LOCATION_TYPE_LABELS,
  REGION_LABELS,
  RULE_DESCRIPTIONS,
  RULE_LABELS,
  RULE_ORDER,
  type LocationType,
  type OrderCap,
  type Region,
  type RuleKey,
  type Settings,
} from '@tanker/core';
import { Alert, App, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Spin, Switch, Table, Tabs, Tag, TimePicker, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type LocationRow, type Master } from '../api';
import { timeToDayjs } from '../dates';
import { useMaster } from '../queries';
import { LegsMatrix } from '../settings/LegsMatrix';
import { UsersTab } from '../settings/UsersTab';

function useSaveSettings() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  return async (settings: Settings) => {
    try {
      await api.saveSettings(settings);
      message.success('設定已儲存，看板會用新的設定重算');
      await qc.invalidateQueries();
      return true;
    } catch (err) {
      message.error((err as Error).message);
      return false;
    }
  };
}

// ---- 油站與營業時間 ----

function LocationModal({ master, location, onClose }: { master: Master; location: LocationRow | null | undefined; onClose: () => void }) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const hours24 = Form.useWatch('hours24', form);
  useEffect(() => {
    if (location === undefined) return;
    form.resetFields();
    form.setFieldsValue(
      location
        ? { ...location, openTime: timeToDayjs(location.openTime), closeTime: timeToDayjs(location.closeTime) }
        : { type: 'station', region: 'central', hours24: true },
    );
  }, [location, form]);

  const save = async () => {
    const v = await form.validateFields();
    const data = {
      ...v,
      openTime: v.hours24 ? null : v.openTime?.format('HH:mm') ?? null,
      closeTime: v.hours24 ? null : v.closeTime?.format('HH:mm') ?? null,
      defaultLoadingId: v.defaultLoadingId || null,
      address: v.address || null,
    };
    try {
      if (location) await api.updateLocation(location.id, data);
      else await api.createLocation(data);
      message.success('據點已儲存');
      await qc.invalidateQueries();
      onClose();
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  return (
    <Modal open={location !== undefined} title={location ? `修改：${location.name}` : '新增據點'} okText="儲存" cancelText="取消" onOk={save} onCancel={onClose}>
      <Form form={form} layout="vertical">
        {!location && (
          <Form.Item name="id" label="代碼（英文）" rules={[{ required: true, message: '請輸入代碼' }, { pattern: /^[a-z0-9][a-z0-9-]*$/, message: '只能用小寫英文、數字和 -' }]}>
            <Input placeholder="例如 st-new" />
          </Form.Item>
        )}
        <Form.Item name="name" label="名稱" rules={[{ required: true, message: '請輸入名稱' }]}>
          <Input />
        </Form.Item>
        <Space>
          <Form.Item name="type" label="類型">
            <Select style={{ width: 120 }} options={(['depot', 'loading', 'station'] as LocationType[]).map((t) => ({ value: t, label: LOCATION_TYPE_LABELS[t] }))} />
          </Form.Item>
          <Form.Item name="region" label="區域">
            <Select style={{ width: 120 }} options={(['central', 'south'] as Region[]).map((r) => ({ value: r, label: REGION_LABELS[r] }))} />
          </Form.Item>
          <Form.Item name="defaultLoadingId" label="預設灌油點">
            <Select
              allowClear
              style={{ width: 140 }}
              options={master.locations.filter((l) => l.type === 'loading').map((l) => ({ value: l.id, label: l.name }))}
            />
          </Form.Item>
        </Space>
        <Form.Item name="address" label="地址">
          <Input />
        </Form.Item>
        <Space align="start">
          <Form.Item name="hours24" label="24 小時營業" valuePropName="checked">
            <Switch />
          </Form.Item>
          {!hours24 && (
            <>
              <Form.Item name="openTime" label="開門" rules={[{ required: true, message: '請選擇開門時間' }]}>
                <TimePicker format="HH:mm" minuteStep={5} needConfirm={false} />
              </Form.Item>
              <Form.Item name="closeTime" label="關門" rules={[{ required: true, message: '請選擇關門時間' }]}>
                <TimePicker format="HH:mm" minuteStep={5} needConfirm={false} />
              </Form.Item>
            </>
          )}
        </Space>
      </Form>
    </Modal>
  );
}

function LocationsTab({ master }: { master: Master }) {
  const [editing, setEditing] = useState<LocationRow | null | undefined>(undefined);
  const { message } = App.useApp();
  const qc = useQueryClient();
  const name = (id: string | null) => master.locations.find((l) => l.id === id)?.name ?? '';
  return (
    <>
      <Space style={{ marginBottom: 8 }}>
        <Button icon={<PlusOutlined />} onClick={() => setEditing(null)}>
          新增據點
        </Button>
        <Typography.Text type="secondary">開門前抵達會自動等待；卸油結束超過關門時間會標示違規。</Typography.Text>
      </Space>
      <Table<LocationRow>
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={master.locations}
        columns={[
          { title: '名稱', dataIndex: 'name' },
          { title: '類型', dataIndex: 'type', render: (t: LocationType) => LOCATION_TYPE_LABELS[t], width: 80 },
          { title: '區域', dataIndex: 'region', render: (r: Region) => REGION_LABELS[r], width: 70 },
          {
            title: '營業時間',
            render: (_, l) => (l.hours24 ? <Tag color="green">24 小時</Tag> : <Tag color="gold">{`${l.openTime}–${l.closeTime}`}</Tag>),
            width: 130,
          },
          { title: '預設灌油點', dataIndex: 'defaultLoadingId', render: (id: string | null) => name(id), width: 110 },
          { title: '地址', dataIndex: 'address', ellipsis: true },
          {
            title: '操作',
            width: 140,
            render: (_, l) => (
              <Space size={4}>
                <Button size="small" onClick={() => setEditing(l)} data-testid={`edit-location-${l.id}`}>
                  修改
                </Button>
                <Popconfirm
                  title={`刪除「${l.name}」？`}
                  okText="刪除"
                  cancelText="取消"
                  onConfirm={async () => {
                    try {
                      await api.deleteLocation(l.id);
                      message.success('已刪除');
                      await qc.invalidateQueries();
                    } catch (err) {
                      message.error((err as Error).message);
                    }
                  }}
                >
                  <Button size="small" danger>
                    刪除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <LocationModal master={master} location={editing} onClose={() => setEditing(undefined)} />
    </>
  );
}

// ---- 作業時間與倍數 ----

function OperationsTab({ master }: { master: Master }) {
  const [form] = Form.useForm();
  const save = useSaveSettings();
  const s = master.settings;
  useEffect(() => {
    form.setFieldsValue({
      ...s.operations,
      carToTruckFactor: s.carToTruckFactor,
      compartments: s.vehicleDefaults.compartmentsKL.join(', '),
      maxStopsPerTrip: s.trip.maxStopsPerTrip,
      dayStart: timeToDayjs(s.dayShift.defaultStartTime),
      nightStart: timeToDayjs(s.nightShift.startTime),
      nightLoadingId: s.nightShift.loadingId,
    });
  }, [s, form]);

  const submit = async () => {
    const v = await form.validateFields();
    const compartments = String(v.compartments)
      .split(/[,，、\s]+/)
      .filter(Boolean)
      .map(Number);
    await save({
      ...s,
      operations: { loadMinutes: v.loadMinutes, unloadMinutesPerStop: v.unloadMinutesPerStop, preTripMinutes: v.preTripMinutes },
      carToTruckFactor: v.carToTruckFactor,
      vehicleDefaults: { compartmentsKL: compartments },
      trip: { maxStopsPerTrip: v.maxStopsPerTrip },
      dayShift: { defaultStartTime: v.dayStart.format('HH:mm') },
      nightShift: { startTime: v.nightStart.format('HH:mm'), loadingId: v.nightLoadingId },
    });
  };

  const num = (label: string, name: string, unit: string, extra?: string, min = 0, step = 5) => (
    <Form.Item name={name} label={label} extra={extra} rules={[{ required: true, message: `請輸入${label}` }]}>
      <InputNumber min={min} step={step} suffix={unit} style={{ width: 200 }} data-testid={`op-${name}`} />
    </Form.Item>
  );

  return (
    <Form form={form} layout="vertical" style={{ maxWidth: 640 }}>
      <Card size="small" title="作業時間" style={{ marginBottom: 12 }}>
        <Space wrap size={24}>
          {num('灌油', 'loadMinutes', '分')}
          {num('卸油（每站）', 'unloadMinutesPerStop', '分', '同一站兩艙仍算一次卸油')}
          {num('出車前檢查', 'preTripMinutes', '分')}
        </Space>
      </Card>
      <Card size="small" title="路段與車輛" style={{ marginBottom: 12 }}>
        <Space wrap size={24}>
          {num('油罐車倍數', 'carToTruckFactor', '倍', '新增路段建議值 = Google 小客車時間 × 倍數', 0.1, 0.1)}
          <Form.Item
            name="compartments"
            label="預設艙位容量（KL）"
            extra="車輛沒有設定艙位時使用，用逗號分隔"
            rules={[
              { required: true, message: '請輸入艙位容量' },
              { pattern: /^\s*\d+(\.\d+)?(\s*[,，、\s]\s*\d+(\.\d+)?)*\s*$/, message: '格式例如 15, 15' },
            ]}
          >
            <Input style={{ width: 200 }} />
          </Form.Item>
          {num('每趟最多送幾站', 'maxStopsPerTrip', '站', undefined, 1, 1)}
        </Space>
      </Card>
      <Card size="small" title="班別" style={{ marginBottom: 12 }}>
        <Space wrap size={24}>
          <Form.Item name="dayStart" label="日班預設出車時間" extra="新排班表的預設值，可在看板逐一修改" rules={[{ required: true }]}>
            <TimePicker format="HH:mm" minuteStep={5} allowClear={false} needConfirm={false} />
          </Form.Item>
          <Form.Item name="nightStart" label="大夜班出車時間" rules={[{ required: true }]}>
            <TimePicker format="HH:mm" minuteStep={5} allowClear={false} needConfirm={false} />
          </Form.Item>
          <Form.Item name="nightLoadingId" label="大夜班灌油點" rules={[{ required: true }]}>
            <Select style={{ width: 140 }} options={master.locations.filter((l) => l.type === 'loading').map((l) => ({ value: l.id, label: l.name }))} />
          </Form.Item>
        </Space>
      </Card>
      <Button type="primary" onClick={submit} data-testid="save-operations">
        儲存
      </Button>
    </Form>
  );
}

// ---- 單數上限 ----

function CapsTab({ master }: { master: Master }) {
  const save = useSaveSettings();
  const [caps, setCaps] = useState<OrderCap[]>(master.settings.orderCaps);
  useEffect(() => setCaps(master.settings.orderCaps), [master.settings.orderCaps]);
  const depots = master.locations.filter((l) => l.type === 'depot');
  const update = (i: number, patch: Partial<OrderCap>) => setCaps((c) => c.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div style={{ maxWidth: 640 }}>
      <Typography.Paragraph type="secondary">超過上限時依「排班規則」的設定顯示警告或阻擋。拆成多趟的同一張訂單算 1 單。</Typography.Paragraph>
      <Table<OrderCap & { idx: number }>
        rowKey="idx"
        size="small"
        pagination={false}
        dataSource={caps.map((c, idx) => ({ ...c, idx }))}
        columns={[
          {
            title: '出發廠',
            render: (_, c) => (
              <Select style={{ width: 140 }} value={c.depotId} onChange={(v) => update(c.idx, { depotId: v })} options={depots.map((d) => ({ value: d.id, label: d.name }))} />
            ),
          },
          {
            title: '計算方式',
            render: (_, c) => (
              <Select
                style={{ width: 180 }}
                value={c.scope}
                onChange={(v) => update(c.idx, { scope: v })}
                options={[
                  { value: 'perDriver', label: '每位司機每天' },
                  { value: 'depotTotal', label: '全廠司機合計每天' },
                ]}
              />
            ),
          },
          {
            title: '上限',
            render: (_, c) => <InputNumber min={0} value={c.maxOrders} onChange={(v) => update(c.idx, { maxOrders: v ?? 0 })} suffix="單" style={{ width: 120 }} data-testid={`cap-${c.depotId}`} />,
          },
          { title: '', render: (_, c) => <Button size="small" danger onClick={() => setCaps((x) => x.filter((_, j) => j !== c.idx))}>移除</Button>, width: 70 },
        ]}
      />
      <Space style={{ marginTop: 12 }}>
        <Button icon={<PlusOutlined />} onClick={() => setCaps((c) => [...c, { depotId: depots[0]?.id ?? '', scope: 'perDriver', maxOrders: 3 }])}>
          新增上限
        </Button>
        <Button type="primary" onClick={() => save({ ...master.settings, orderCaps: caps })} data-testid="save-caps">
          儲存
        </Button>
      </Space>
    </div>
  );
}

// ---- 排班規則 ----

const RULE_PARAMS: Partial<Record<RuleKey, { field: string; label: string; unit: string; step?: number }[]>> = {
  maxConsecutiveWorkDays: [{ field: 'value', label: '最多連續', unit: '天', step: 1 }],
  minRestBetweenDutiesHours: [{ field: 'value', label: '至少休息', unit: '小時', step: 0.5 }],
  dailyDrivingHours: [{ field: 'value', label: '上限', unit: '小時', step: 0.5 }],
  continuousDriving: [
    { field: 'maxHours', label: '連續', unit: '小時', step: 0.5 },
    { field: 'breakMinutes', label: '休息', unit: '分', step: 5 },
  ],
  dailyWorkHours: [{ field: 'value', label: '上限', unit: '小時', step: 0.5 }],
  monthlyOvertimeHours: [
    { field: 'value', label: '每月上限', unit: '小時', step: 1 },
    { field: 'normalDailyHours', label: '每日正常工時', unit: '小時', step: 0.5 },
  ],
};

function RulesTab({ master }: { master: Master }) {
  const save = useSaveSettings();
  const [rules, setRules] = useState(master.settings.rules);
  useEffect(() => setRules(master.settings.rules), [master.settings.rules]);
  const update = (key: RuleKey, patch: Record<string, unknown>) => setRules((r) => ({ ...r, [key]: { ...r[key], ...patch } }));
  return (
    <div style={{ maxWidth: 1000 }}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="「阻擋」的規則沒通過就不能發布；「警告」的規則沒通過時，調度員要填寫原因才能發布，原因會存入操作紀錄。"
      />
      <Table
        rowKey="key"
        size="small"
        pagination={false}
        dataSource={RULE_ORDER.map((key) => ({ key }))}
        columns={[
          { title: '規則', render: (_, { key }) => <b>{RULE_LABELS[key]}</b>, width: 130 },
          { title: '說明', render: (_, { key }) => <span style={{ fontSize: 12 }}>{RULE_DESCRIPTIONS[key]}</span> },
          {
            title: '啟用',
            width: 70,
            render: (_, { key }) => <Switch checked={rules[key].enabled} onChange={(v) => update(key, { enabled: v })} data-testid={`rule-${key}`} />,
          },
          {
            title: '等級',
            width: 110,
            render: (_, { key }) => (
              <Select
                value={rules[key].level}
                onChange={(v) => update(key, { level: v })}
                style={{ width: 90 }}
                options={[
                  { value: 'block', label: '阻擋' },
                  { value: 'warn', label: '警告' },
                ]}
              />
            ),
          },
          {
            title: '門檻',
            width: 300,
            render: (_, { key }) => (
              <Space direction="vertical" size={4}>
                {(RULE_PARAMS[key] ?? []).map((p) => (
                  <Space key={p.field} size={4}>
                    <span style={{ fontSize: 12, width: 84, display: 'inline-block' }}>{p.label}</span>
                    <InputNumber
                      size="small"
                      min={0}
                      step={p.step}
                      value={(rules[key] as unknown as Record<string, number>)[p.field]}
                      onChange={(v) => update(key, { [p.field]: v ?? 0 })}
                      suffix={p.unit}
                      style={{ width: 140 }}
                    />
                  </Space>
                ))}
              </Space>
            ),
          },
        ]}
      />
      <Button type="primary" style={{ marginTop: 12 }} onClick={() => save({ ...master.settings, rules })} data-testid="save-rules">
        儲存
      </Button>
    </div>
  );
}

export function SettingsPage() {
  const master = useMaster();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'locations';
  const from = params.get('from');
  const to = params.get('to');
  if (master.error) return <Alert type="error" showIcon message="載入失敗" description={(master.error as Error).message} />;
  if (!master.data) return <Spin style={{ margin: 40 }} />;
  return (
    <>
      <Typography.Title level={4}>設定</Typography.Title>
      <Tabs
        activeKey={tab}
        onChange={(key) => setParams({ tab: key })}
        items={[
          { key: 'locations', label: '油站與營業時間', children: <LocationsTab master={master.data} /> },
          { key: 'legs', label: '路段時間', children: <LegsMatrix master={master.data} focus={from && to ? { fromId: from, toId: to } : undefined} /> },
          { key: 'operations', label: '作業時間與倍數', children: <OperationsTab master={master.data} /> },
          { key: 'caps', label: '單數上限', children: <CapsTab master={master.data} /> },
          { key: 'rules', label: '排班規則', children: <RulesTab master={master.data} /> },
          { key: 'users', label: '使用者（登入名單）', children: <UsersTab /> },
        ]}
      />
    </>
  );
}
