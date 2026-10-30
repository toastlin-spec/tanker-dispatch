import { Layout, Menu } from 'antd';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuditPage } from './pages/AuditPage';
import { BoardPage } from './pages/BoardPage';
import { FleetPage } from './pages/FleetPage';
import { OrdersPage } from './pages/OrdersPage';
import { PrintPage } from './pages/PrintPage';
import { SettingsPage } from './pages/SettingsPage';

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
