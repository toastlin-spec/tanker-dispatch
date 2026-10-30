import { describe, expect, it } from 'vitest';
import { loadAuthConfig } from '../src/auth/auth-config';

const google = {
  GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'secret',
  SESSION_SECRET: 'z'.repeat(64),
};

describe('登入設定：設定不完整時拒絕啟動', () => {
  it('什麼都沒設定就不能啟動', () => {
    expect(() => loadAuthConfig({})).toThrow('尚未設定登入方式');
  });

  it('正式環境不能用開發模式', () => {
    expect(() => loadAuthConfig({ AUTH_MODE: 'dev', NODE_ENV: 'production' })).toThrow('正式環境不能使用開發模式登入');
    expect(() => loadAuthConfig({ AUTH_MODE: 'dev', K_SERVICE: 'tanker' })).toThrow('正式環境不能使用開發模式登入');
  });

  it('Google 登入缺密鑰或密鑰太短', () => {
    expect(() => loadAuthConfig({ GOOGLE_CLIENT_ID: 'id' })).toThrow('GOOGLE_CLIENT_SECRET');
    expect(() => loadAuthConfig({ ...google, SESSION_SECRET: 'short' })).toThrow('SESSION_SECRET 至少要 32 個字元');
  });

  it('正式環境必須設定 https 的 PUBLIC_URL', () => {
    expect(() => loadAuthConfig({ ...google, NODE_ENV: 'production' })).toThrow('必須設定 PUBLIC_URL');
    expect(() => loadAuthConfig({ ...google, NODE_ENV: 'production', PUBLIC_URL: 'http://x.example.com' })).toThrow('必須是 https');
    expect(() => loadAuthConfig({ ...google, PUBLIC_URL: 'https://x.example.com/app' })).toThrow('不含路徑');
  });

  it('不認得的 AUTH_MODE', () => {
    expect(() => loadAuthConfig({ AUTH_MODE: 'none' })).toThrow('AUTH_MODE 只能是 google 或 dev');
  });

  it('部署設定的帳號格式錯誤', () => {
    expect(() => loadAuthConfig({ AUTH_MODE: 'dev', AUTH_BOOTSTRAP_EMAILS: 'a@gmail.com, oops' })).toThrow('oops');
  });
});

describe('登入設定：正確的設定', () => {
  it('正式環境的 Google 登入', () => {
    const c = loadAuthConfig({
      ...google,
      NODE_ENV: 'production',
      PUBLIC_URL: 'https://tanker.example.com/',
      AUTH_BOOTSTRAP_EMAILS: 'ToastLin@gmail.com，b@gmail.com',
    });
    expect(c).toMatchObject({
      mode: 'google',
      publicUrl: 'https://tanker.example.com',
      sessionHours: 12,
      bootstrapEmails: ['toastlin@gmail.com', 'b@gmail.com'],
      google: { clientId: google.GOOGLE_CLIENT_ID, clientSecret: 'secret' },
    });
  });

  it('本機開發模式沒有 SESSION_SECRET 時自動產生', () => {
    const c = loadAuthConfig({ AUTH_MODE: 'dev' });
    expect(c.mode).toBe('dev');
    expect(c.sessionSecret.length).toBeGreaterThanOrEqual(32);
    expect(c.google).toBeNull();
  });
});
