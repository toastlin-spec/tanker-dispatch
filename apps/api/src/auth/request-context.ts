import { AsyncLocalStorage } from 'node:async_hooks';
import type { SessionUser } from './session';

/** 每個請求的登入者，讓操作紀錄不用一路傳參數就能記下是誰操作。 */
export const requestContext = new AsyncLocalStorage<{ user?: SessionUser }>();

export function currentUser(): SessionUser | null {
  return requestContext.getStore()?.user ?? null;
}
