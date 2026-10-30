import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { parseBody, zOptionalText } from '../common/validation';
import { PrismaService } from '../prisma.service';
import type { AuthedRequest } from './auth.guard';
import { AuthService } from './auth.service';
import { isValidEmail, normalizeEmail } from './session';

/** 登入名單：所有登入的調度員都可以新增、移除（使用者決定）。 */
@Controller('users')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list() {
    const users = await this.prisma.allowedUser.findMany({ orderBy: { createdAt: 'asc' } });
    return { bootstrap: this.auth.config.bootstrapEmails, users };
  }

  @Post()
  async add(@Req() req: AuthedRequest, @Body() body: unknown) {
    const data = parseBody(z.object({ email: z.string().min(1), note: zOptionalText }), body);
    const email = normalizeEmail(data.email);
    if (!isValidEmail(email)) throw new BadRequestException('email 格式錯誤');
    if (this.auth.config.bootstrapEmails.includes(email)) throw new BadRequestException('這個帳號已在部署設定的名單中，不需要再加入');
    if (await this.prisma.allowedUser.findUnique({ where: { email } })) throw new ConflictException('這個帳號已在登入名單中');
    const created = await this.prisma.allowedUser.create({ data: { email, note: data.note, addedBy: req.user.email } });
    await this.audit.log({ action: 'user.add', entityType: 'user', entityId: email, summary: `加入登入名單：${email}${data.note ? `（${data.note}）` : ''}` });
    return created;
  }

  @Patch(':email')
  async update(@Param('email') raw: string, @Body() body: unknown) {
    const email = normalizeEmail(raw);
    const data = parseBody(z.object({ note: zOptionalText }), body);
    const updated = await this.prisma.allowedUser.update({ where: { email }, data: { note: data.note } });
    await this.audit.log({ action: 'user.update', entityType: 'user', entityId: email, summary: `修改登入名單備註：${email}` });
    return updated;
  }

  @Delete(':email')
  async remove(@Req() req: AuthedRequest, @Param('email') raw: string) {
    const email = normalizeEmail(raw);
    if (email === req.user.email) throw new BadRequestException('不能移除自己');
    if (this.auth.config.bootstrapEmails.includes(email)) throw new BadRequestException('部署設定的帳號不能在這裡移除，請到 Cloud Run 修改 AUTH_BOOTSTRAP_EMAILS');
    await this.prisma.allowedUser.delete({ where: { email } });
    await this.audit.log({ action: 'user.remove', entityType: 'user', entityId: email, summary: `移出登入名單：${email}（立即無法使用系統）` });
    return { ok: true };
  }
}
