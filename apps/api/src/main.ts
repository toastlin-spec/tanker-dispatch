import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { AuthService } from './auth/auth.service';
import { requestContext } from './auth/request-context';
import { HttpExceptionFilter } from './common/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn', 'log'] });
  app.setGlobalPrefix('api');
  // Cloud Run 前面有 Google 的負載平衡器，要相信 X-Forwarded-Proto 才知道是 https。
  app.set('trust proxy', true);
  app.use((_req: Request, _res: Response, next: NextFunction) => requestContext.run({}, next));

  // 會修改資料的請求必須來自本系統的網頁（搭配 SameSite cookie 防止跨站請求偽造）。
  const auth = app.get(AuthService);
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !req.path.startsWith('/api')) return next();
    const origin = req.get('origin');
    if (origin && origin !== auth.origin(req)) {
      res.status(403).json({ statusCode: 403, message: '請求來源不符，已拒絕' });
      return;
    }
    next();
  });
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();

  // 正式環境（Cloud Run）由 API 一併提供前端的靜態檔。
  const webDist = process.env.WEB_DIST ?? join(__dirname, '../../web/dist');
  if (existsSync(join(webDist, 'index.html'))) {
    app.useStaticAssets(webDist, { index: false });
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.sendFile(join(webDist, 'index.html'));
    });
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`API 已啟動：http://localhost:${port}/api`, 'Bootstrap');
}

void bootstrap();
