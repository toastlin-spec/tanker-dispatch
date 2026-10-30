import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { currentUser } from '../auth/request-context';
import { PrismaService } from '../prisma.service';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  detail?: unknown;
  reason?: string | null;
  /** 預設為目前登入者。 */
  actor?: string | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  log(entry: AuditEntry, tx: Prisma.TransactionClient = this.prisma) {
    return tx.auditLog.create({
      data: {
        actor: entry.actor !== undefined ? entry.actor : currentUser()?.email ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        summary: entry.summary,
        detail: entry.detail === undefined ? undefined : (entry.detail as Prisma.InputJsonValue),
        reason: entry.reason ?? null,
      },
    });
  }

  list(query: { entityType?: string; entityId?: string; limit?: number }) {
    return this.prisma.auditLog.findMany({
      where: {
        entityType: query.entityType || undefined,
        entityId: query.entityId || undefined,
      },
      orderBy: { at: 'desc' },
      take: Math.min(Math.max(query.limit ?? 200, 1), 1000),
    });
  }
}
