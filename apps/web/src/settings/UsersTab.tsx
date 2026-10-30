import { PlusOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Form, Input, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import { api, type AllowedUserRow } from '../api';
import { formatDateTime } from '../dates';
import { keys, useMe } from '../queries';

interface Row extends Partial<AllowedUserRow> {
  email: string;
  bootstrap: boolean;
}

/** 登入名單：名單上的 Google 帳號都能登入，也都能管理這份名單。 */
export function UsersTab() {
  const me = useMe();
  const users = useQuery({ queryKey: keys.users, queryFn: api.users });
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<{ email: string; note?: string }>();

  const refresh = () => qc.invalidateQueries({ queryKey: keys.users });
  const add = async () => {
    const v = await form.validateFields();
    try {
      await api.addUser({ email: v.email, note: v.note?.trim() || null });
      message.success(`已加入 ${v.email.trim().toLowerCase()}，對方現在可以用這個 Google 帳號登入`);
      form.resetFields();
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      void refresh();
    }
  };
  const remove = async (email: string) => {
    try {
      await api.removeUser(email);
      message.success(`已移除 ${email}`);
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      void refresh();
    }
  };

  const rows: Row[] = [
    ...(users.data?.bootstrap ?? []).map((email) => ({ email, bootstrap: true })),
    ...(users.data?.users ?? []).map((u) => ({ ...u, bootstrap: false })),
  ];

  return (
    <div style={{ maxWidth: 1000 }}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="名單上的 Google 帳號都可以登入並使用全部功能，也都能管理這份名單。移除後對方立即無法使用系統。"
      />
      <Form form={form} layout="inline" style={{ marginBottom: 12, rowGap: 8 }} onFinish={add}>
        <Form.Item
          name="email"
          rules={[
            { required: true, message: '請輸入 Google 帳號' },
            { type: 'email', message: 'email 格式錯誤' },
          ]}
        >
          <Input placeholder="Google 帳號，例如 name@gmail.com" style={{ width: 280 }} data-testid="user-email" />
        </Form.Item>
        <Form.Item name="note">
          <Input placeholder="備註（例如姓名）" style={{ width: 200 }} maxLength={100} />
        </Form.Item>
        <Button type="primary" htmlType="submit" icon={<PlusOutlined />} data-testid="user-add">
          加入名單
        </Button>
      </Form>
      <Table<Row>
        rowKey="email"
        size="small"
        loading={users.isLoading}
        pagination={false}
        dataSource={rows}
        columns={[
          {
            title: 'Google 帳號',
            dataIndex: 'email',
            render: (email: string, r) => (
              <Space size={4}>
                {email}
                {email === me.data?.email && <Tag color="blue">你</Tag>}
                {r.bootstrap && <Tag color="purple">部署設定</Tag>}
              </Space>
            ),
          },
          { title: '名稱', dataIndex: 'lastName', render: (v: string | null) => v ?? '' },
          { title: '備註', dataIndex: 'note', render: (v: string | null) => v ?? '' },
          { title: '加入者', dataIndex: 'addedBy', render: (v: string | null) => v ?? '' },
          { title: '加入時間', dataIndex: 'createdAt', render: (v?: string) => (v ? formatDateTime(v) : '') },
          { title: '最後登入', dataIndex: 'lastLoginAt', render: (v?: string | null) => (v ? formatDateTime(v) : '') },
          {
            title: '操作',
            width: 90,
            render: (_, r) =>
              r.bootstrap ? (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  不能在這裡移除
                </Typography.Text>
              ) : (
                <Popconfirm title={`移除 ${r.email}？`} description="對方會立即無法使用系統" okText="移除" cancelText="取消" onConfirm={() => remove(r.email)}>
                  <Button size="small" danger disabled={r.email === me.data?.email} data-testid={`remove-${r.email}`}>
                    移除
                  </Button>
                </Popconfirm>
              ),
          },
        ]}
      />
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
        「部署設定」的帳號寫在伺服器的 AUTH_BOOTSTRAP_EMAILS，一律可以登入，避免名單被誤刪時所有人都進不來。
      </Typography.Paragraph>
    </div>
  );
}
