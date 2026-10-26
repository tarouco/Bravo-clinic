import {
  ACTIVE_STATUSES,
  ceilDiv,
  findCleanupConflicts,
  type AffectedBooking,
  type BusinessHoursRow,
  type CalendarConfig,
  type CalendarSettings,
  type SettingsValues,
} from '@bravo/core';
import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client';
import { bookings, businessHours, rooms, users } from '../../db/schema';
import { audit, type RequestContext } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { findAffectedBookings } from '../availability/availability.service';
import { loadSettings, saveSetting } from '../settings/settings.repo';
import { loadBusinessHours } from './calendar.repo';

const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'holiday'] as const;

const sortedHours = (rows: BusinessHoursRow[]): BusinessHoursRow[] =>
  DAY_ORDER.flatMap((dayType) => rows.find((r) => r.dayType === dayType) ?? []);

export function calendarSettingsOf(values: SettingsValues): CalendarSettings {
  return {
    slotMinutes: values['calendar.slot_minutes'],
    defaultBookingMinutes: values['calendar.default_booking_minutes'],
    cleanupMinutes: values['calendar.cleanup_minutes'],
    minAdvanceMinutes: values['calendar.min_advance_minutes'],
    maxAdvanceDays: values['calendar.max_advance_days'],
  };
}

/** NUC-36: minutes of each booking that cannot be sold because the cleanup ends off the slot grid. */
export function calendarWarnings(settings: CalendarSettings): CalendarConfig['warnings'] {
  const { cleanupMinutes, slotMinutes } = settings;
  if (cleanupMinutes % slotMinutes === 0) return [];
  return [
    {
      code: 'cleanup_not_slot_multiple',
      lostMinutesPerBooking: ceilDiv(cleanupMinutes, slotMinutes) * slotMinutes - cleanupMinutes,
    },
  ];
}

export async function getCalendarConfig(db: Db): Promise<CalendarConfig> {
  const [hours, values] = await Promise.all([loadBusinessHours(db), loadSettings(db)]);
  const settings = calendarSettingsOf(values);
  return {
    businessHours: sortedHours(hours),
    settings,
    warnings: calendarWarnings(settings),
    onboarding: { pricesReviewed: values['onboarding.prices_reviewed'] },
  };
}

/**
 * Replaces the 8 weekly rows (NUC-33, NUC-34). Rows must sit on the slot grid, and no future
 * active booking may be left outside its day's window.
 */
export async function updateBusinessHours(
  tx: Tx,
  rows: BusinessHoursRow[],
  ctx: RequestContext,
  now: Date,
): Promise<BusinessHoursRow[]> {
  const values = await loadSettings(tx);
  const slot = values['calendar.slot_minutes'];
  const misaligned = rows.flatMap((row, index) =>
    (['openMinute', 'closeMinute'] as const)
      .filter((field) => row[field] % slot !== 0)
      .map((field) => ({
        path: `rows.${String(index)}.${field}`,
        message: `O horário precisa ser múltiplo de ${String(slot)} minutos`,
      })),
  );
  if (misaligned.length > 0) {
    throw new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', misaligned);
  }

  const affected = await findAffectedBookings(tx, { from: now, proposedHours: rows });
  if (affected.length > 0) throw affectedBookingsError(affected);

  const before = sortedHours(await loadBusinessHours(tx));
  for (const row of rows) {
    await tx
      .insert(businessHours)
      .values({ ...row, updatedBy: ctx.actorUserId })
      .onConflictDoUpdate({
        target: businessHours.dayType,
        set: {
          isClosed: row.isClosed,
          openMinute: row.openMinute,
          closeMinute: row.closeMinute,
          updatedBy: ctx.actorUserId,
          updatedAt: new Date(),
        },
      });
  }
  const after = sortedHours(rows);
  await audit(tx, ctx, {
    action: 'calendar.business_hours_update',
    entityType: 'business_hours',
    before,
    after,
  });
  return after;
}

export function affectedBookingsError(bookings: AffectedBooking[]): AppError {
  return new AppError(
    409,
    'AFFECTED_BOOKINGS',
    'Existem reservas afetadas. Realoque ou cancele antes de continuar.',
    { bookings },
  );
}

/** Future active bookings (start after `now`) whose cleanup may change; manual exceptions keep theirs. */
async function futureBookings(tx: Tx, now: Date) {
  return tx
    .select({
      id: bookings.id,
      code: bookings.code,
      roomId: bookings.roomId,
      status: bookings.status,
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      overridden: bookings.cleanupOverriddenAt,
      customerName: users.name,
      roomName: rooms.name,
    })
    .from(bookings)
    .innerJoin(users, eq(users.id, bookings.userId))
    .innerJoin(rooms, eq(rooms.id, bookings.roomId))
    .where(and(inArray(bookings.status, [...ACTIVE_STATUSES]), gt(bookings.startsAt, now)));
}

/**
 * Saves the five calendar settings (NUC-35..NUC-38). A longer cleanup is rejected while two future
 * bookings of a room would overlap it; otherwise it reaches every future booking without a manual
 * cleanup exception, occupancy included, in the same transaction.
 */
export async function updateCalendarSettings(
  tx: Tx,
  input: CalendarSettings,
  ctx: RequestContext,
  now: Date,
): Promise<{ settings: CalendarSettings; warnings: CalendarConfig['warnings'] }> {
  const before = calendarSettingsOf(await loadSettings(tx));

  if (input.cleanupMinutes > before.cleanupMinutes) {
    const future = await futureBookings(tx, now);
    const byId = new Map(future.map((b) => [b.id, b]));
    const pairs = findCleanupConflicts(
      future.map((b) => ({ id: b.id, roomId: b.roomId, start: b.startsAt, end: b.endsAt })),
      input.cleanupMinutes,
    ).filter((pair) => byId.get(pair.firstId)?.overridden === null);
    if (pairs.length > 0) {
      const describe = (id: string): AffectedBooking => {
        const b = byId.get(id);
        if (b === undefined) throw new Error('cleanup conflict names an unknown booking');
        return {
          id: b.id,
          code: b.code,
          customerName: b.customerName,
          roomName: b.roomName,
          startsAt: b.startsAt.toISOString(),
          endsAt: b.endsAt.toISOString(),
          status: b.status as AffectedBooking['status'],
        };
      };
      throw new AppError(
        409,
        'CLEANUP_CONFLICTS',
        'A nova limpeza conflita com reservas futuras.',
        { pairs: pairs.map((p) => ({ first: describe(p.firstId), second: describe(p.secondId) })) },
      );
    }
  }

  await saveSetting(tx, 'calendar.slot_minutes', input.slotMinutes, ctx.actorUserId);
  await saveSetting(
    tx,
    'calendar.default_booking_minutes',
    input.defaultBookingMinutes,
    ctx.actorUserId,
  );
  await saveSetting(tx, 'calendar.cleanup_minutes', input.cleanupMinutes, ctx.actorUserId);
  await saveSetting(tx, 'calendar.min_advance_minutes', input.minAdvanceMinutes, ctx.actorUserId);
  await saveSetting(tx, 'calendar.max_advance_days', input.maxAdvanceDays, ctx.actorUserId);

  if (input.cleanupMinutes !== before.cleanupMinutes) {
    const target = and(
      inArray(bookings.status, [...ACTIVE_STATUSES]),
      gt(bookings.startsAt, now),
      isNull(bookings.cleanupOverriddenAt),
    );
    await tx.execute(sql`
      update room_occupancy o
      set period = tstzrange(lower(o.period), b.ends_at + ${input.cleanupMinutes} * interval '1 minute', '[)'),
          updated_at = now()
      from bookings b
      where o.kind = 'booking' and o.ref_id = b.id and o.active
        and b.status in (${sql.join(
          ACTIVE_STATUSES.map((s) => sql`${s}`),
          sql`, `,
        )})
        and b.starts_at > ${now.toISOString()}::timestamptz
        and b.cleanup_overridden_at is null
    `);
    await tx
      .update(bookings)
      .set({ cleanupMinutes: input.cleanupMinutes, updatedAt: new Date() })
      .where(target);
  }

  await audit(tx, ctx, {
    action: 'settings.calendar_update',
    entityType: 'settings',
    before,
    after: input,
  });
  return { settings: input, warnings: calendarWarnings(input) };
}
