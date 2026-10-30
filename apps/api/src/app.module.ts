import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuditController } from './audit/audit.controller';
import { AuditService } from './audit/audit.service';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { UsersController } from './auth/users.controller';
import { DutiesController } from './duties/duties.controller';
import { DutiesService } from './duties/duties.service';
import { PlanningService } from './duties/planning.service';
import { MasterController } from './master/master.controller';
import { MasterService } from './master/master.service';
import { OrdersController } from './orders/orders.controller';
import { PrismaService } from './prisma.service';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController, AuthController, UsersController, MasterController, OrdersController, DutiesController, AuditController],
  providers: [
    PrismaService,
    AuditService,
    AuthService,
    { provide: APP_GUARD, useClass: AuthGuard },
    MasterService,
    PlanningService,
    DutiesService,
  ],
})
export class AppModule {}
