import { Module } from '@nestjs/common';
import { AuditController } from './audit/audit.controller';
import { AuditService } from './audit/audit.service';
import { DutiesController } from './duties/duties.controller';
import { DutiesService } from './duties/duties.service';
import { PlanningService } from './duties/planning.service';
import { MasterController } from './master/master.controller';
import { MasterService } from './master/master.service';
import { OrdersController } from './orders/orders.controller';
import { PrismaService } from './prisma.service';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController, MasterController, OrdersController, DutiesController, AuditController],
  providers: [PrismaService, AuditService, MasterService, PlanningService, DutiesService],
})
export class AppModule {}
