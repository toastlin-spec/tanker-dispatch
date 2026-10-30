import { LogoutOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Avatar, Button, Layout, Menu, Space, Spin, Tooltip } from 'antd';
import { useEffect } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ApiError, api, onUnauthorized } from './api';
import { AuditPage } from './pages/AuditPage';
import { BoardPage } from './pages/BoardPage';
import { FleetPage } from './pages/FleetPage';
import { LoginPage } from './pages/LoginPage';
import { OrdersPage } from './pages/OrdersPage';
import { PrintPage } from './pages/PrintPage';
import { SettingsPage } from './pages/SettingsPage';
import { keys, useMe } from './queries';

const MENU = [
  { key: '/', label: '調度看板' },
  { key: '/orders', label: '訂單管理' },
  { key: '/settings', label: '設定' },
  { key: '/fleet', label: '司機與車輛' },
  { key: '/print', label: '派車單' },
  { key: '/audit', label: '操作紀錄' },
];

export function App() {
  const location = useLocation();
  const qc = useQueryClient();
  const me = useMe();

  // 工作階段過期或被移出名單時，任何 API 回 401 就回到登入頁。
  useEffect(() => {
    onUnauthorized(() => void qc.resetQueries({ queryKey: keys.me }));
    return () => onUnauthorized(null);
  }, [qc]);

  if (me.isLoading) return <Spin fullscreen />;
  if (me.error) {
    if ((me.error as ApiError).status === 401) return <LoginPage />;
    return <Alert type="error" showIcon style={{ margin: 24 }} message="無法連線到伺服器" description={(me.error as Error).message} />;
  }

  const logout = async () => {
    await api.logout().catch(() => undefined);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    await qc.resetQueries({ queryKey: keys.me });
  };

  const user = me.data!;
  const selected = MENU.filter((m) => (m.key === '/' ? location.pathname === '/' : location.pathname.startsWith(m.key))).map((m) => m.key);
  return (
    <Layout className="app-layout">
      <Layout.Header className="app-header no-print">
        <div className="app-title">油罐車派車管理系統</div>
        <Menu
          theme="dark"
          mode="horizontal"
          selectedKeys={selected}
          items={MENU.map((m) => ({ key: m.key, label: <Link to={m.key}>{m.label}</Link> }))}
          style={{ flex: 1, minWidth: 0 }}
        />
        <Space size={8} className="app-user">
          <Avatar size="small" src={user.picture ?? undefined}>
            {(user.name ?? user.email).slice(0, 1).toUpperCase()}
          </Avatar>
          <Tooltip title={user.email}>
            <span data-testid="current-user">{user.name ?? user.email}</span>
          </Tooltip>
          <Button size="small" icon={<LogoutOutlined />} onClick={logout} data-testid="logout">
            登出
          </Button>
        </Space>
      </Layout.Header>
      <Layout.Content className="app-content">
        <Routes>
          <Route path="/" element={<BoardPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/fleet" element={<FleetPage />} />
          <Route path="/print" element={<PrintPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout.Content>
    </Layout>
  );
}
