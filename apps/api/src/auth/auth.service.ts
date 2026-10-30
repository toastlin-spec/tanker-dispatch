import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma.service';
import { loadAuthConfig, type AuthConfig } from './auth-config';
import {
  OAUTH_COOKIE,
  SESSION_COOKIE,
  normalizeEmail,
  parseCookies,
  sanitizeReturnTo,
  serializeCookie,
  signToken,
  verifyToken,
  type SessionUser,
} from './session';

interface SessionPayload extends SessionUser {
  iat: number;
  exp: number;
}

interface OAuthPayload {
  state: string;
  verifier: string;
  returnTo: string;
  exp: number;
}

const OAUTH_TTL_SECONDS = 600;

export type LoginError = 'expired' | 'cancelled' | 'google_failed' | 'unverified_email' | 'not_allowed';

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');
  /** 在建構時讀設定：設定不完整時 API 無法啟動。 */
  readonly config: AuthConfig = loadAuthConfig();
  private readonly google: OAuth2Client | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    this.google = this.config.google ? new OAuth2Client({ clientId: this.config.google.clientId, clientSecret: this.config.google.clientSecret }) : null;
    if (this.config.mode === 'dev') this.logger.warn('開發模式登入：不經過 Google，只能在本機使用');
    if (this.config.bootstrapEmails.length === 0) this.logger.warn('沒有設定 AUTH_BOOTSTRAP_EMAILS；只有登入名單中的帳號能登入');
  }

  /** 使用者看到的網址（OAuth 回呼與檢查請求來源用）。 */
  origin(req: Request): string {
    return this.config.publicUrl ?? `${req.protocol}://${req.get('host')}`;
  }

  private secure(req: Request): boolean {
    return this.origin(req).startsWith('https://');
  }

  async isAllowed(email: string): Promise<boolean> {
    const e = normalizeEmail(email);
    if (this.config.bootstrapEmails.includes(e)) return true;
    return (await this.prisma.allowedUser.count({ where: { email: e } })) > 0;
  }

  /** 從 cookie 取得登入者；每次都重新檢查名單，被移除的帳號立即失效。 */
  async userFromRequest(req: Request): Promise<SessionUser | null> {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const payload = verifyToken<SessionPayload>(token, this.config.sessionSecret);
    if (!payload || !(await this.isAllowed(payload.email))) return null;
    return { email: payload.email, name: payload.name, picture: payload.picture };
  }

  sessionCookie(req: Request, user: SessionUser): string {
    const now = Math.floor(Date.now() / 1000);
    const maxAge = this.config.sessionHours * 3600;
    const token = signToken({ ...user, iat: now, exp: now + maxAge } satisfies SessionPayload, this.config.sessionSecret);
    return serializeCookie(SESSION_COOKIE, token, { maxAgeSeconds: maxAge, secure: this.secure(req) });
  }

  clearCookies(req: Request): string[] {
    return [
      serializeCookie(SESSION_COOKIE, '', { maxAgeSeconds: 0, secure: this.secure(req) }),
      serializeCookie(OAUTH_COOKIE, '', { maxAgeSeconds: 0, path: '/api/auth', secure: this.secure(req) }),
    ];
  }

  private callbackUrl(req: Request): string {
    return `${this.origin(req)}/api/auth/callback`;
  }

  /** 產生 Google 登入網址（含 state 與 PKCE），並把驗證資料放在短效 cookie。 */
  async startGoogleLogin(req: Request, returnTo: unknown): Promise<{ url: string; cookie: string }> {
    if (!this.google) throw new Error('沒有設定 Google 登入');
    const state = randomBytes(16).toString('base64url');
    const { codeVerifier, codeChallenge } = await this.google.generateCodeVerifierAsync();
    const payload: OAuthPayload = {
      state,
      verifier: codeVerifier,
      returnTo: sanitizeReturnTo(returnTo),
      exp: Math.floor(Date.now() / 1000) + OAUTH_TTL_SECONDS,
    };
    const url = this.google.generateAuthUrl({
      scope: ['openid', 'email', 'profile'],
      state,
      redirect_uri: this.callbackUrl(req),
      code_challenge_method: CodeChallengeMethod.S256,
      code_challenge: codeChallenge,
      access_type: 'online',
      prompt: 'select_account',
    });
    const cookie = serializeCookie(OAUTH_COOKIE, signToken(payload, this.config.sessionSecret), {
      maxAgeSeconds: OAUTH_TTL_SECONDS,
      path: '/api/auth',
      secure: this.secure(req),
    });
    return { url, cookie };
  }

  /** Google 導回後：核對 state、用授權碼換 ID token、驗證 email 並檢查名單。 */
  async finishGoogleLogin(
    req: Request,
    query: { code?: string; state?: string; error?: string },
  ): Promise<{ ok: true; user: SessionUser; returnTo: string } | { ok: false; error: LoginError; email?: string }> {
    if (!this.google || !this.config.google) return { ok: false, error: 'google_failed' };
    if (query.error) return { ok: false, error: query.error === 'access_denied' ? 'cancelled' : 'google_failed' };
    const saved = verifyToken<OAuthPayload>(parseCookies(req.headers.cookie)[OAUTH_COOKIE], this.config.sessionSecret);
    if (!saved || !query.state || !query.code) return { ok: false, error: 'expired' };
    const a = Buffer.from(saved.state);
    const b = Buffer.from(query.state);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, error: 'expired' };

    let profile: { email?: string; email_verified?: boolean; name?: string; picture?: string } | undefined;
    try {
      const { tokens } = await this.google.getToken({ code: query.code, codeVerifier: saved.verifier, redirect_uri: this.callbackUrl(req) });
      if (!tokens.id_token) return { ok: false, error: 'google_failed' };
      const ticket = await this.google.verifyIdToken({ idToken: tokens.id_token, audience: this.config.google.clientId });
      profile = ticket.getPayload();
    } catch (err) {
      this.logger.error(`Google 登入失敗：${(err as Error).message}`);
      return { ok: false, error: 'google_failed' };
    }
    if (!profile?.email) return { ok: false, error: 'google_failed' };
    const email = normalizeEmail(profile.email);
    if (!profile.email_verified) return { ok: false, error: 'unverified_email', email };
    if (!(await this.isAllowed(email))) {
      await this.audit.log({ action: 'auth.denied', entityType: 'user', entityId: email, summary: `拒絕登入：${email} 不在登入名單` });
      return { ok: false, error: 'not_allowed', email };
    }
    const user: SessionUser = { email, name: profile.name ?? null, picture: profile.picture ?? null };
    return { ok: true, user, returnTo: saved.returnTo };
  }

  async recordLogin(user: SessionUser) {
    await this.prisma.allowedUser.updateMany({ where: { email: user.email }, data: { lastLoginAt: new Date(), lastName: user.name } });
    await this.audit.log({ action: 'auth.login', entityType: 'user', entityId: user.email, summary: `登入：${user.name ?? user.email}`, actor: user.email });
  }

  /** 開發模式可快速登入的帳號（部署設定 + 登入名單）。 */
  async devEmails(): Promise<string[]> {
    const users = await this.prisma.allowedUser.findMany({ orderBy: { createdAt: 'asc' } });
    return [...new Set([...this.config.bootstrapEmails, ...users.map((u) => u.email)])];
  }
}
