import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

/** 把錯誤轉成中文訊息：{ statusCode, message, details? }。 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Record<string, unknown> = { message: '伺服器發生錯誤，請稍後再試' };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      body = typeof r === 'string' ? { message: r } : { ...(r as Record<string, unknown>) };
      if (exception instanceof NotFoundException && typeof body.message === 'string' && body.message.startsWith('Cannot ')) {
        body = { message: `找不到這個 API：${body.message.replace('Cannot ', '')}` };
      }
      delete body.error;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        body = { message: '資料重複，代碼或組合已存在' };
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        body = { message: '找不到資料，可能已被刪除' };
      } else if (exception.code === 'P2003') {
        status = HttpStatus.BAD_REQUEST;
        body = { message: '資料仍被其他資料使用，無法刪除或修改' };
      } else {
        this.logger.error(exception);
      }
    } else {
      this.logger.error(exception);
    }
    res.status(status).json({ statusCode: status, ...body });
  }
}
