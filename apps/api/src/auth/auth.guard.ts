import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { requestContext } from './request-context';
import type { SessionUser } from './session';

const IS_PUBLIC = 'auth:isPublic';

/** 不需要登入的 API（登入流程本身、健康檢查）。 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export type AuthedRequest = Request & { user: SessionUser };

/** 全域登入檢查：除了標成 @Public() 的 API，其他都要登入且在名單內。 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const user = await this.auth.userFromRequest(req);
    if (!user) throw new UnauthorizedException('請先登入');
    req.user = user;
    const store = requestContext.getStore();
    if (store) store.user = user;
    return true;
  }
}
