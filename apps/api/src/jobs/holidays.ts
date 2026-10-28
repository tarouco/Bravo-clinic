import { utcToLocal, type LocalDate } from '@bravo/core';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { holidays, users } from '../db/schema';
import { importNationalHolidays } from '../modules/calendar/holiday-import';
import { withNotifications } from '../modules/notifications/notifications.service';
import { loadSettings } from '../modules/settings/settings.repo';
import { JOB_CONTEXT, type Job } from './runner';

// Holiday jobs (GES-130..GES-132, design "Privacy (LGPD) and maintenance jobs").

/**
 * Daily (GES-130): on the São Paulo date of `calendar.holiday_review_reminder` queues
 * `staff.holiday_review` to every active admin, listing the holidays from today to the end of next
 * year. The outbox dedupe key (`staff:holiday_review:<year>:<userId>:<email>`) makes it once per
 * admin per year; any other date does nothing.
 */
export const holidayReminder: Job = async (deps, now) => {
  const today = utcToLocal(now).date;
  const [year, month, day] = today.split('-').map(Number) as [number, number, number];
  const reminder = (await loadSettings(deps.db))['calendar.holiday_review_reminder'];
  if (reminder.month !== month || reminder.day !== day) return { due: false, admins: 0 };

  const admins = await deps.db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.status, 'active')));
  const upcoming = await deps.db
    .select({ date: holidays.date, name: holidays.name })
    .from(holidays)
    .where(and(gte(holidays.date, today), lte(holidays.date, `${String(year + 1)}-12-31`)))
    .orderBy(asc(holidays.date), asc(holidays.name));
  await withNotifications(deps, JOB_CONTEXT, async (_tx, notify) => {
    for (const admin of admins) {
      await notify({
        name: 'staff.holiday_review',
        entityId: `${String(year)}:${admin.id}`,
        to: admin.email,
        data: { holidays: upcoming.map((h) => ({ date: h.date as LocalDate, name: h.name })) },
      });
    }
  });
  return { due: true, admins: admins.length };
};

/**
 * Weekly (GES-131, GES-132): imports BrasilAPI's national holidays of the current and next year
 * through nucleo's insert-only import (new dates `source = 'brasilapi'`, `is_closed = false`;
 * existing dates untouched). A failed year changes nothing for that year, the other year still
 * runs, and the run ends in error so `job_runs` records which year failed.
 */
export const importHolidays: Job = async (deps, now) => {
  const currentYear = Number(utcToLocal(now).date.slice(0, 4));
  const stats: Record<string, number> = {};
  const failures: string[] = [];
  for (const year of [currentYear, currentYear + 1]) {
    try {
      const result = await importNationalHolidays(
        deps.db,
        year,
        { fetch: deps.fetch, now: () => now, ctx: JOB_CONTEXT },
        { renameExisting: false },
      );
      stats[`inserted${String(year)}`] = result.inserted;
    } catch (error) {
      failures.push(`${String(year)}: ${(error as Error).message}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`BrasilAPI import failed for ${failures.join('; ')}`);
  }
  return stats;
};
