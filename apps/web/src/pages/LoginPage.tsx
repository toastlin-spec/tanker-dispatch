import { GoogleOutlined, LoginOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, AutoComplete, Button, Card, Space, Spin, Typography } from 'antd';
import { useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { keys } from '../queries';

const ERRORS: Record<string, (email: string | null) => string> = {
  not_allowed: (email) => `${email ?? '這個帳號'} 沒有使用權限。請已經能登入的調度員到「設定 → 使用者」把這個 Google 帳號加入名單。`,
  expired: () => '登入逾時或連結已失效，請重新登入。',
  cancelled: () => '已取消登入。',
  google_failed: () => 'Google 登入失敗，請稍後再試。',
  unverified_email: () => '這個 Google 帳號的 email 尚未驗證，無法登入。',
};

export function LoginPage() {
  const [params] = useSearchParams();
  const location = useLocation();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const config = useQuery({ queryKey: ['auth-config'], queryFn: api.authConfig });
  const [devEmail, setDevEmail] = useState('');
  const error = params.get('error');
  const returnTo = location.pathname.startsWith('/login') ? '/' : `${location.pathname}${location.search}`;

  const devLogin = async () => {
    try {
      await api.devLogin(devEmail);
      await qc.resetQueries({ queryKey: keys.me });
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f6f8', padding: 16 }}>
      <Card style={{ width: 420 }}>
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          油罐車派車管理系統
        </Typography.Title>
        <Typography.Paragraph type="secondary">請用已加入名單的 Google 帳號登入。</Typography.Paragraph>
        {error && <Alert type="error" showIcon style={{ marginBottom: 16 }} message={(ERRORS[error] ?? ERRORS.google_failed)(params.get('email'))} />}
        {config.isLoading && <Spin />}
        {config.error && <Alert type="error" showIcon message={(config.error as Error).message} />}
        {config.data?.mode === 'google' && (
          <Button type="primary" size="large" block icon={<GoogleOutlined />} href={`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`} data-testid="google-login">
            使用 Google 帳號登入
          </Button>
        )}
        {config.data?.mode === 'dev' && (
          <>
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="開發模式"
              description="沒有設定 Google 登入，選擇名單中的帳號直接登入。只能在本機開發使用，正式環境不會啟用。"
            />
            <Space.Compact style={{ width: '100%' }}>
              <AutoComplete
                style={{ flex: 1 }}
                value={devEmail}
                onChange={setDevEmail}
                options={(config.data.devEmails ?? []).map((e) => ({ value: e }))}
                placeholder="選擇或輸入 email"
                data-testid="dev-email"
              />
              <Button type="primary" icon={<LoginOutlined />} disabled={!devEmail.trim()} onClick={devLogin} data-testid="dev-login">
                登入
              </Button>
            </Space.Compact>
          </>
        )}
      </Card>
    </div>
  );
}
