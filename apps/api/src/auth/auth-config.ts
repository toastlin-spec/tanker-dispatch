import { randomBytes } from 'node:crypto';
import { isValidEmail, normalizeEmail } from './session';

export type AuthMode = 'google' | 'dev';

export interface AuthConfig {
  mode: AuthMode;
  /** 使用者看到的網址，例如 https://tanker-xxxx.a.run.app；未設定時由請求推得（只限本機開發）。 */
  publicUrl: string | null;
  sessionSecret: string;
  sessionHours: number;
  /** 部署設定裡一律允許登入的帳號（不能在系統內移除，避免所有人都被鎖在外面）。 */
  bootstrapEmails: string[];
  google: { clientId: string; clientSecret: string } | null;
}

/**
 * 讀取登入設定。設定不完整時直接丟出錯誤讓 API 無法啟動，不會在沒有登入保護的情況下運作。
 * - 正式環境（NODE_ENV=production 或在 Cloud Run 上）一律要用 Google 登入，且必須設定 PUBLIC_URL。
 * - 開發模式（AUTH_MODE=dev）只能在本機使用。
 */
export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const production = env.NODE_ENV === 'production' || !!env.K_SERVICE;
  const rawMode = env.AUTH_MODE?.trim() || (env.GOOGLE_CLIENT_ID ? 'google' : '');
  if (!rawMode) {
    throw new Error('尚未設定登入方式：請設定 GOOGLE_CLIENT_ID 與 GOOGLE_CLIENT_SECRET；只在本機開發時可設定 AUTH_MODE=dev');
  }
  if (rawMode !== 'google' && rawMode !== 'dev') throw new Error(`AUTH_MODE 只能是 google 或 dev（目前是 ${rawMode}）`);
  const mode = rawMode as AuthMode;
  if (mode === 'dev' && production) throw new Error('正式環境不能使用開發模式登入（AUTH_MODE=dev）');

  const bootstrapEmails = (env.AUTH_BOOTSTRAP_EMAILS ?? '')
    .split(/[\s,;，、]+/)
    .map(normalizeEmail)
    .filter(Boolean);
  const invalid = bootstrapEmails.filter((e) => !isValidEmail(e));
  if (invalid.length) throw new Error(`AUTH_BOOTSTRAP_EMAILS 有格式錯誤的 email：${invalid.join(', ')}`);

  const sessionHours = env.AUTH_SESSION_HOURS ? Number(env.AUTH_SESSION_HOURS) : 12;
  if (!(sessionHours > 0)) throw new Error('AUTH_SESSION_HOURS 必須大於 0');

  let publicUrl = env.PUBLIC_URL?.trim().replace(/\/+$/, '') || null;
  if (publicUrl && !/^https?:\/\/[^/]+$/.test(publicUrl)) throw new Error('PUBLIC_URL 格式應為 https://網域（不含路徑）');
  if (production && !publicUrl) throw new Error('正式環境必須設定 PUBLIC_URL，例如 https://tanker-xxxx.a.run.app');
  if (production && publicUrl && !publicUrl.startsWith('https://')) throw new Error('正式環境的 PUBLIC_URL 必須是 https');

  if (mode === 'dev') {
    return {
      mode,
      publicUrl,
      sessionSecret: env.SESSION_SECRET || randomBytes(32).toString('hex'),
      sessionHours,
      bootstrapEmails,
      google: null,
    };
  }

  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error('Google 登入需要 GOOGLE_CLIENT_ID 與 GOOGLE_CLIENT_SECRET');
  const sessionSecret = env.SESSION_SECRET ?? '';
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET 至少要 32 個字元（可用 openssl rand -hex 32 產生）');
  return { mode, publicUrl, sessionSecret, sessionHours, bootstrapEmails, google: { clientId, clientSecret } };
}
