import { createHmac, timingSafeEqual } from 'node:crypto';

/** 登入者資料，存在簽章過的 cookie 裡。 */
export interface SessionUser {
  email: string;
  name: string | null;
  picture: string | null;
}

export const SESSION_COOKIE = 'tanker_session';
export const OAUTH_COOKIE = 'tanker_oauth';

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function hmac(body: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(body).digest();
}

/** 簽章：base64url(JSON).base64url(HMAC-SHA256)。內容沒有加密，不放機密資料。 */
export function signToken(payload: object, secret: string): string {
  const body = base64url(JSON.stringify(payload));
  return `${body}.${base64url(hmac(body, secret))}`;
}

/** 驗證簽章與到期時間（exp 為秒）；不正確或過期回傳 null。 */
export function verifyToken<T extends { exp: number }>(token: string | undefined, secret: string, nowMs = Date.now()): T | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = hmac(body, secret);
  const actual = Buffer.from(sig, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= nowMs) return null;
    return payload;
  } catch {
    return null;
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** 登入後要回到的頁面：只接受站內路徑，避免被導到其他網站。 */
export function sanitizeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  if (value.startsWith('/api/') || value.startsWith('/login')) return '/';
  return value;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (!name || name in cookies) continue;
    try {
      cookies[name] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      cookies[name] = part.slice(i + 1).trim();
    }
  }
  return cookies;
}

export function serializeCookie(
  name: string,
  value: string,
  opts: { maxAgeSeconds: number; path?: string; secure: boolean },
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path ?? '/'}`, `Max-Age=${Math.max(0, Math.floor(opts.maxAgeSeconds))}`, 'HttpOnly', 'SameSite=Lax'];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}
