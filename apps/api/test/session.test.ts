import { describe, expect, it } from 'vitest';
import { normalizeEmail, parseCookies, sanitizeReturnTo, serializeCookie, signToken, verifyToken } from '../src/auth/session';

const SECRET = 'x'.repeat(40);
const now = Date.UTC(2026, 9, 30, 8, 0, 0);
const exp = now / 1000 + 3600;

describe('工作階段簽章', () => {
  it('簽章後可以驗證並取回內容', () => {
    const token = signToken({ email: 'a@gmail.com', exp }, SECRET);
    expect(verifyToken<{ email: string; exp: number }>(token, SECRET, now)).toEqual({ email: 'a@gmail.com', exp });
  });

  it('內容被竄改就無效', () => {
    const token = signToken({ email: 'a@gmail.com', exp }, SECRET);
    const [, sig] = token.split('.');
    const forged = `${Buffer.from(JSON.stringify({ email: 'evil@gmail.com', exp })).toString('base64url')}.${sig}`;
    expect(verifyToken(forged, SECRET, now)).toBeNull();
  });

  it('用不同的密鑰簽章就無效', () => {
    expect(verifyToken(signToken({ email: 'a@gmail.com', exp }, 'y'.repeat(40)), SECRET, now)).toBeNull();
  });

  it('過期就無效', () => {
    const token = signToken({ email: 'a@gmail.com', exp }, SECRET);
    expect(verifyToken(token, SECRET, exp * 1000)).toBeNull();
    expect(verifyToken(token, SECRET, exp * 1000 - 1)).not.toBeNull();
  });

  it('格式錯誤或沒有 cookie 都無效', () => {
    expect(verifyToken(undefined, SECRET, now)).toBeNull();
    expect(verifyToken('abc', SECRET, now)).toBeNull();
    expect(verifyToken('a.b.c', SECRET, now)).toBeNull();
    expect(verifyToken(signToken({ email: 'a@gmail.com' } as never, SECRET), SECRET, now)).toBeNull();
  });
});

describe('登入後回到的頁面', () => {
  it('只接受站內路徑', () => {
    expect(sanitizeReturnTo('/orders?date=2026-11-02')).toBe('/orders?date=2026-11-02');
    expect(sanitizeReturnTo('https://evil.example.com')).toBe('/');
    expect(sanitizeReturnTo('//evil.example.com')).toBe('/');
    expect(sanitizeReturnTo('/\\evil.example.com')).toBe('/');
    expect(sanitizeReturnTo('/api/auth/logout')).toBe('/');
    expect(sanitizeReturnTo('/login?error=x')).toBe('/');
    expect(sanitizeReturnTo(undefined)).toBe('/');
  });
});

describe('cookie 與 email', () => {
  it('解析 Cookie 標頭', () => {
    expect(parseCookies('a=1; tanker_session=abc.def; b=%E4%B8%AD')).toEqual({ a: '1', tanker_session: 'abc.def', b: '中' });
    expect(parseCookies(undefined)).toEqual({});
  });

  it('cookie 一律 HttpOnly、SameSite=Lax，https 時加上 Secure', () => {
    expect(serializeCookie('s', 'v', { maxAgeSeconds: 60, secure: true })).toBe('s=v; Path=/; Max-Age=60; HttpOnly; SameSite=Lax; Secure');
    expect(serializeCookie('s', '', { maxAgeSeconds: 0, path: '/api/auth', secure: false })).toBe('s=; Path=/api/auth; Max-Age=0; HttpOnly; SameSite=Lax');
  });

  it('email 不分大小寫', () => {
    expect(normalizeEmail('  ToastLin@Gmail.com ')).toBe('toastlin@gmail.com');
  });
});
