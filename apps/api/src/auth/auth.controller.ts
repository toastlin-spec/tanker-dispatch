import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { parseBody } from '../common/validation';
import { Public, type AuthedRequest } from './auth.guard';
import { AuthService } from './auth.service';
import { isValidEmail, normalizeEmail } from './session';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** 登入頁需要知道是 Google 登入還是開發模式。 */
  @Public()
  @Get('config')
  async config() {
    if (this.auth.config.mode === 'dev') return { mode: 'dev', devEmails: await this.auth.devEmails() };
    return { mode: 'google' };
  }

  @Get('me')
  me(@Req() req: AuthedRequest) {
    return req.user;
  }

  @Public()
  @Get('login')
  async login(@Req() req: Request, @Res() res: Response, @Query('returnTo') returnTo?: string) {
    if (this.auth.config.mode !== 'google') {
      return res.redirect(302, `${this.auth.origin(req)}/login`);
    }
    const { url, cookie } = await this.auth.startGoogleLogin(req, returnTo);
    res.setHeader('Set-Cookie', cookie);
    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(302, url);
  }

  @Public()
  @Get('callback')
  async callback(@Req() req: Request, @Res() res: Response, @Query() query: { code?: string; state?: string; error?: string }) {
    const origin = this.auth.origin(req);
    const result = await this.auth.finishGoogleLogin(req, query);
    res.setHeader('Cache-Control', 'no-store');
    if (!result.ok) {
      res.setHeader('Set-Cookie', this.auth.clearCookies(req));
      const params = new URLSearchParams({ error: result.error });
      if (result.email) params.set('email', result.email);
      return res.redirect(302, `${origin}/login?${params}`);
    }
    await this.auth.recordLogin(result.user);
    res.setHeader('Set-Cookie', [this.auth.clearCookies(req)[1], this.auth.sessionCookie(req, result.user)]);
    return res.redirect(302, `${origin}${result.returnTo}`);
  }

  /** 開發模式：不經過 Google，直接以名單中的帳號登入。正式環境不會啟用。 */
  @Public()
  @Post('dev-login')
  async devLogin(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) {
    if (this.auth.config.mode !== 'dev') throw new NotFoundException('找不到這個 API');
    const { email } = parseBody(z.object({ email: z.string().min(1) }), body);
    const e = normalizeEmail(email);
    if (!isValidEmail(e)) throw new BadRequestException('email 格式錯誤');
    if (!(await this.auth.isAllowed(e))) throw new ForbiddenException(`${e} 不在登入名單，請先請已登入的人把你加入`);
    const user = { email: e, name: null, picture: null };
    await this.auth.recordLogin(user);
    res.setHeader('Set-Cookie', this.auth.sessionCookie(req, user));
    return user;
  }

  @Public()
  @Post('logout')
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Set-Cookie', this.auth.clearCookies(req));
    return { ok: true };
  }
}
