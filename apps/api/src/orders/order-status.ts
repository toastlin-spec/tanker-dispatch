import type { Prisma } from '@prisma/client';

/** 依是否排入班表更新訂單狀態：有排入 → 已排；沒有 → 待派。已取消、已完成不變。 */
export async function syncOrderStatuses(tx: Prisma.TransactionClient, orderIds: string[]) {
  const ids = [...new Set(orderIds)];
  if (ids.length === 0) return;
  const orders = await tx.order.findMany({ where: { id: { in: ids } }, include: { _count: { select: { drops: true } } } });
  for (const o of orders) {
    if (o.status !== 'pending' && o.status !== 'scheduled') continue;
    const status = o._count.drops > 0 ? 'scheduled' : 'pending';
    if (status !== o.status) await tx.order.update({ where: { id: o.id }, data: { status } });
  }
}
