import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn', 'log'] });
  app.setGlobalPrefix('api');
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
