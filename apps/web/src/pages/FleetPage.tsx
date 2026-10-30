import { PlusOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { SHIFT_LABELS, type Shift } from '@tanker/core';
import { Alert, App, Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Spin, Switch, Table, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { api, type DriverRow, type Master, type VehicleRow } from '../api';
import { useMaster } from '../queries';

function useAct() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  return async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      message.success(ok);
      await qc.invalidateQueries();
      return true;
    } catch (err) {
      message.error((err as Error).message);
      return false;
    }
  };
}

function DriverModal({ master, driver, onClose }: { master: Master; driver: DriverRow | null | undefined; onClose: () => void }) {
  const [form] = Form.useForm();
  const act = useAct();
  useEffect(() => {
    if (driver === undefined) return;
    form.resetFields();
    form.setFieldsValue(driver ?? { shift: 'day', active: true, homeDepotId: master.locations.find((l) => l.type === 'depot')?.id });
  }, [driver, form, master]);
  const save = async () => {
    const v = await form.validateFields();
    const data = { ...v, vehicleId: v.vehicleId || null };
    if (await act(() => (driver ? api.updateDriver(driver.id, data) : api.createDriver(data)), '司機已儲存')) onClose();
  };
  return (
    <Modal open={driver !== undefined} title={driver ? `修改司機：${driver.name}` : '新增司機'} okText="儲存" cancelText="取消" onOk={save} onCancel={onClose}>
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="姓名" rules={[{ required: true, message: '請輸入姓名' }]}>
          <Input />
        </Form.Item>
        <Form.Item name="homeDepotId" label="所屬廠" rules={[{ required: true, message: '請選擇所屬廠' }]}>
          <Select options={master.locations.filter((l) => l.type === 'depot').map((l) => ({ value: l.id, label: l.name }))} />
        </Form.Item>
        <Form.Item name="shift" label="班別" rules={[{ required: true }]} extra="大夜班固定在設定的時間出車，一律到大夜班灌油點灌油">
          <Select options={(['day', 'night'] as Shift[]).map((s) => ({ value: s, label: SHIFT_LABELS[s] }))} />
        </Form.Item>
        <Form.Item name="vehicleId" label="固定車輛">
          <Select allowClear options={master.vehicles.map((v) => ({ value: v.id, label: `${v.name}${v.tractorPlate ? `（${v.tractorPlate}）` : ''}` }))} />
        </Form.Item>
        <Form.Item name="active" label="在職" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function VehicleModal({ vehicle, onClose }: { vehicle: VehicleRow | null | undefined; onClose: () => void }) {
  const [form] = Form.useForm();
  const act = useAct();
  useEffect(() => {
    if (vehicle === undefined) return;
    form.resetFields();
    form.setFieldsValue(vehicle ? { ...vehicle, compartments: vehicle.compartmentsKL.join(', ') } : { active: true, compartments: '15, 15' });
  }, [vehicle, form]);
  const save = async () => {
    const { compartments, ...v } = await form.validateFields();
    const data = {
      ...v,
      tractorPlate: v.tractorPlate || null,
      trailerPlate: v.trailerPlate || null,
      compartmentsKL: String(compartments)
        .split(/[,，、\s]+/)
        .filter(Boolean)
        .map(Number),
    };
    if (await act(() => (vehicle ? api.updateVehicle(vehicle.id, data) : api.createVehicle(data)), '車輛已儲存')) onClose();
  };
  return (
    <Modal open={vehicle !== undefined} title={vehicle ? `修改車輛：${vehicle.name}` : '新增車輛'} okText="儲存" cancelText="取消" onOk={save} onCancel={onClose}>
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="名稱" rules={[{ required: true, message: '請輸入名稱' }]}>
          <Input />
        </Form.Item>
        <Space>
          <Form.Item name="tractorPlate" label="車頭車牌">
            <Input placeholder="例如 KLA-1234" />
          </Form.Item>
          <Form.Item name="trailerPlate" label="油槽車牌">
            <Input />
          </Form.Item>
        </Space>
        <Form.Item
          name="compartments"
          label="艙位容量（KL）"
          extra="每艙一張單、一種油品；用逗號分隔，例如 15, 15"
          rules={[
            { required: true, message: '請輸入艙位容量' },
            { pattern: /^\s*\d+(\.\d+)?(\s*[,，、\s]\s*\d+(\.\d+)?)*\s*$/, message: '格式例如 15, 15' },
          ]}
        >
          <Input />
        </Form.Item>
        <Form.Item name="active" label="使用中" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export function FleetPage() {
  const master = useMaster();
  const act = useAct();
  const [driver, setDriver] = useState<DriverRow | null | undefined>(undefined);
  const [vehicle, setVehicle] = useState<VehicleRow | null | undefined>(undefined);
  if (master.error) return <Alert type="error" showIcon message="載入失敗" description={(master.error as Error).message} />;
  if (!master.data) return <Spin style={{ margin: 40 }} />;
  const m = master.data;
  const locName = (id: string) => m.locations.find((l) => l.id === id)?.name ?? id;
  const vehicleName = (id: string | null) => m.vehicles.find((v) => v.id === id)?.name ?? '—';
  return (
    <>
      <Typography.Title level={4}>司機與車輛</Typography.Title>
      <Typography.Paragraph type="secondary">目前是佔位資料（司機 A～D、車 1～4），請改成真實姓名與車牌。</Typography.Paragraph>
      <Card size="small" title="司機" extra={<Button icon={<PlusOutlined />} onClick={() => setDriver(null)}>新增司機</Button>} style={{ marginBottom: 16 }}>
        <Table<DriverRow>
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={m.drivers}
          columns={[
            { title: '姓名', dataIndex: 'name' },
            { title: '所屬廠', dataIndex: 'homeDepotId', render: locName },
            { title: '班別', dataIndex: 'shift', render: (s: Shift) => <Tag color={s === 'night' ? 'purple' : 'default'}>{SHIFT_LABELS[s]}</Tag> },
            { title: '固定車輛', dataIndex: 'vehicleId', render: vehicleName },
            { title: '在職', dataIndex: 'active', render: (a: boolean) => (a ? <Tag color="green">在職</Tag> : <Tag>停用</Tag>) },
            {
              title: '操作',
              width: 150,
              render: (_, d) => (
                <Space size={4}>
                  <Button size="small" onClick={() => setDriver(d)}>修改</Button>
                  <Popconfirm title={`刪除「${d.name}」？`} okText="刪除" cancelText="取消" onConfirm={() => act(() => api.deleteDriver(d.id), '已刪除')}>
                    <Button size="small" danger>刪除</Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>
      <Card size="small" title="車輛（車頭＋油槽）" extra={<Button icon={<PlusOutlined />} onClick={() => setVehicle(null)}>新增車輛</Button>}>
        <Table<VehicleRow>
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={m.vehicles}
          columns={[
            { title: '名稱', dataIndex: 'name' },
            { title: '車頭車牌', dataIndex: 'tractorPlate', render: (v: string | null) => v ?? <Typography.Text type="secondary">未填</Typography.Text> },
            { title: '油槽車牌', dataIndex: 'trailerPlate', render: (v: string | null) => v ?? <Typography.Text type="secondary">未填</Typography.Text> },
            { title: '艙位', dataIndex: 'compartmentsKL', render: (c: number[]) => `${c.join(' + ')} KL` },
            { title: '使用中', dataIndex: 'active', render: (a: boolean) => (a ? <Tag color="green">使用中</Tag> : <Tag>停用</Tag>) },
            {
              title: '操作',
              width: 150,
              render: (_, v) => (
                <Space size={4}>
                  <Button size="small" onClick={() => setVehicle(v)}>修改</Button>
                  <Popconfirm title={`刪除「${v.name}」？`} okText="刪除" cancelText="取消" onConfirm={() => act(() => api.deleteVehicle(v.id), '已刪除')}>
                    <Button size="small" danger>刪除</Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>
      <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
        換掛：特殊情況需要換車時，在看板的「車趟」裡為當天班表指定其他車輛即可，不會改動司機的固定車輛。
      </Typography.Paragraph>
      <DriverModal master={m} driver={driver} onClose={() => setDriver(undefined)} />
      <VehicleModal vehicle={vehicle} onClose={() => setVehicle(undefined)} />
    </>
  );
}
