import type { Db } from './core';
import { HttpError } from './perm';

/**
 * Day close lock: once a day is closed for a business, money records dated on or before it
 * cannot be added, changed or deleted until the owner reopens the day.
 */
export function lastClosed(db: Db, tenantId: string, businessId: string): string | null {
  return db.get('select max(date) as d from day_close where tenant_id = ? and business_id = ?', tenantId, businessId)?.d ?? null;
}

export function assertDayOpen(db: Db, tenantId: string, businessId: string, ...dates: (string | null | undefined)[]) {
  const closed = lastClosed(db, tenantId, businessId);
  if (!closed) return;
  const hit = dates.filter((d): d is string => !!d).find((d) => d <= closed);
  if (hit) throw new HttpError(409, `The books are closed up to ${closed}. Reopen that day to change records dated ${hit}.`);
}
