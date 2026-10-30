import { Controller, Get, Query } from '@nestjs/common';
import { AuditService } from './audit.service';

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query('entityType') entityType?: string, @Query('entityId') entityId?: string, @Query('limit') limit?: string) {
    return this.audit.list({ entityType, entityId, limit: limit ? Number(limit) : undefined });
  }
}
