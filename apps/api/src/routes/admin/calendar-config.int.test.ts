import {
  affectedBookingsDetailsSchema,
  calendarConfigSchema,
  businessHoursResponseSchema,
  calendarSettingsResultSchema,
  cleanupConflictsDetailsSchema,
  localToUtc,
  policySettingsSchema,
  type LocalDate,
} from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createBooking, createUser, loginAs } from '../../../test/factories';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb } from '../../db/client';
import { auditLog, bookings, businessHours, rooms, settings } from '../../db/schema';
import { runSeed } from '../../db/seed';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-10-20T12:00:00Z');
const TUESDAY = '2026-10-27' as LocalDate;
const WEDNESDAY = '2026-10-28' as LocalDate;
const app = () => createApp({ db, now: () => NOW, fetch: forbiddenFetch, env: testEnv() });

let roomId = '';
let customerId = '';
let adminCookie = '';
let receptionCookie = '';

beforeEach(async () => {
  await runSeed(db);
  const [room] = await db.select().from(rooms).where(eq(rooms.slug, 'principal'));
  roomId = room?.id ?? '';
  customerId = (await createUser(db, { name: 'Cliente Teste' })).id;
  const admin = await createUser(db, { role: 'admin', totp: true });
  const reception = await createUser(db, { role: 'reception', totp: true });
  adminCookie = await loginAs(db, admin, { mfaVerified: true, now: NOW });
  receptionCookie = await loginAs(db, reception, { mfaVerified: true, now: NOW });
});

const call = (method: string, path: string, cookie: string, body?: unknown) =>
  send(app(), method, path, { cookie, ...(body !== undefined && { body }) });

const book = (date: LocalDate, from: number, to: number, extra: Record<string, unknown> = {}) =>
  createBooking(db, {
    userId: customerId,
    roomId,
    startsAt: localToUtc(date, from),
    endsAt: localToUtc(date, to),
    ...extra,
  });

const config = async () =>
  calendarConfigSchema.parse((await call('GET', '/admin/calendar/config', adminCookie)).body);
const auditActions = async () => (await db.select().from(auditLog)).map((row) => row.action);

describe('role checks (NUC-32, NUC-172)', () => {
  it('answers reception with 403 FORBIDDEN on every calendar and policy route', async () => {
    const policies = (await call('GET', '/admin/settings/policies', adminCookie)).body;
    const hours = (await config()).businessHours;
    const settingsBody = (await config()).settings;

    const results = await Promise.all([
      call('GET', '/admin/calendar/config', receptionCookie),
      call('PUT', '/admin/calendar/business-hours', receptionCookie, { rows: hours }),
      call('PUT', '/admin/calendar/settings', receptionCookie, settingsBody),
      call('GET', '/admin/settings/policies', receptionCookie),
      call(
        'PUT',
        '/admin/settings/policies',
        receptionCookie,
        (policies as { values: unknown }).values,
      ),
    ]);

    expect(results.map((r) => [r.status, r.error?.code])).toEqual(
      Array.from({ length: 5 }, () => [403, 'FORBIDDEN']),
    );
  });
});

describe('GET /admin/calendar/config (NUC-32)', () => {
  it('returns the 8 hour rows, the 5 settings, no warnings and pricesReviewed false', async () => {
    const parsed = await config();

    expect(parsed.businessHours.map((h) => h.dayType)).toEqual([
      'mon',
      'tue',
      'wed',
      'thu',
      'fri',
      'sat',
      'sun',
      'holiday',
    ]);
    expect(parsed.settings).toEqual({
      slotMinutes: 30,
      defaultBookingMinutes: 60,
      cleanupMinutes: 30,
      minAdvanceMinutes: 0,
      maxAdvanceDays: 90,
    });
    expect([parsed.warnings, parsed.onboarding]).toEqual([[], { pricesReviewed: false }]);
  });
});

describe('PUT /admin/calendar/business-hours (NUC-33, NUC-34)', () => {
  it('saves the rows, returns them and audits calendar.business_hours_update with before and after', async () => {
    const rows = (await config()).businessHours.map((r) =>
      r.dayType === 'tue' ? { ...r, openMinute: 480 } : r,
    );

    const res = await call('PUT', '/admin/calendar/business-hours', adminCookie, { rows });

    expect(res.status).toBe(200);
    expect(
      businessHoursResponseSchema.parse(res.body).businessHours.find((r) => r.dayType === 'tue')
        ?.openMinute,
    ).toBe(480);
    const [tue] = await db.select().from(businessHours).where(eq(businessHours.dayType, 'tue'));
    expect(tue?.openMinute).toBe(480);
    const [entry] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'calendar.business_hours_update'));
    const pick = (value: unknown) =>
      (value as { dayType: string; openMinute: number }[]).find((r) => r.dayType === 'tue')
        ?.openMinute;
    expect([pick(entry?.before), pick(entry?.after)]).toEqual([420, 480]);
  });

  it('returns 422 with the row path when close is not after open or a minute is off the slot grid', async () => {
    const rows = (await config()).businessHours;
    const closeBeforeOpen = rows.map((r) =>
      r.dayType === 'tue' ? { ...r, openMinute: 600, closeMinute: 600 } : r,
    );
    const offGrid = rows.map((r) => (r.dayType === 'tue' ? { ...r, openMinute: 435 } : r));

    const first = await call('PUT', '/admin/calendar/business-hours', adminCookie, {
      rows: closeBeforeOpen,
    });
    const second = await call('PUT', '/admin/calendar/business-hours', adminCookie, {
      rows: offGrid,
    });

    expect([first.status, first.error?.code]).toEqual([422, 'VALIDATION_FAILED']);
    expect(first.error?.details).toContainEqual(
      expect.objectContaining({ path: 'rows.1.closeMinute' }),
    );
    expect([second.status, second.error?.code]).toEqual([422, 'VALIDATION_FAILED']);
    expect(second.error?.details).toContainEqual(
      expect.objectContaining({ path: 'rows.1.openMinute' }),
    );
  });

  it('returns 409 AFFECTED_BOOKINGS naming a seeded 08:00 booking and saves nothing', async () => {
    const affected = await book(TUESDAY, 480, 540);
    const rows = (await config()).businessHours.map((r) =>
      r.dayType === 'tue' ? { ...r, openMinute: 540 } : r,
    );

    const res = await call('PUT', '/admin/calendar/business-hours', adminCookie, { rows });

    expect([res.status, res.error?.code]).toEqual([409, 'AFFECTED_BOOKINGS']);
    const details = affectedBookingsDetailsSchema.parse(res.error?.details);
    expect(details.bookings).toEqual([
      {
        id: affected.id,
        code: affected.code,
        customerName: 'Cliente Teste',
        roomName: 'Sala Principal',
        startsAt: '2026-10-27T11:00:00.000Z',
        endsAt: '2026-10-27T12:00:00.000Z',
        status: 'confirmed',
      },
    ]);
    const [tue] = await db.select().from(businessHours).where(eq(businessHours.dayType, 'tue'));
    expect(tue?.openMinute).toBe(420);
    expect(await auditActions()).not.toContain('calendar.business_hours_update');
  });
});

describe('PUT /admin/calendar/settings (NUC-35..NUC-38)', () => {
  const put = (body: Record<string, number>) =>
    call('PUT', '/admin/calendar/settings', adminCookie, {
      slotMinutes: 30,
      defaultBookingMinutes: 60,
      cleanupMinutes: 30,
      minAdvanceMinutes: 0,
      maxAdvanceDays: 90,
      ...body,
    });

  it('returns 422 with the field path for a default duration off the slot grid or out of bounds', async () => {
    const offGrid = await put({ defaultBookingMinutes: 45 });
    const outOfBounds = await put({ maxAdvanceDays: 0 });

    expect([offGrid.status, offGrid.error?.code]).toEqual([422, 'VALIDATION_FAILED']);
    expect(offGrid.error?.details).toContainEqual(
      expect.objectContaining({ path: 'defaultBookingMinutes' }),
    );
    expect(outOfBounds.error?.details).toContainEqual(
      expect.objectContaining({ path: 'maxAdvanceDays' }),
    );
  });

  it('saves cleanup 45 with warning lostMinutesPerBooking 15 and audits settings.calendar_update', async () => {
    const res = await put({ cleanupMinutes: 45 });

    expect(res.status).toBe(200);
    expect(calendarSettingsResultSchema.parse(res.body).warnings).toEqual([
      { code: 'cleanup_not_slot_multiple', lostMinutesPerBooking: 15 },
    ]);
    expect((await config()).settings.cleanupMinutes).toBe(45);
    const [entry] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'settings.calendar_update'));
    expect([
      (entry?.before as { cleanupMinutes: number }).cleanupMinutes,
      (entry?.after as { cleanupMinutes: number }).cleanupMinutes,
    ]).toEqual([30, 45]);
  });

  it('returns 409 CLEANUP_CONFLICTS for CC-1 data with cleanup 45 and changes nothing', async () => {
    const first = await book(TUESDAY, 540, 660);
    const second = await book(TUESDAY, 690, 750);

    const res = await put({ cleanupMinutes: 45 });

    expect([res.status, res.error?.code]).toEqual([409, 'CLEANUP_CONFLICTS']);
    const details = cleanupConflictsDetailsSchema.parse(res.error?.details);
    expect(details.pairs.map((p) => [p.first.code, p.second.code])).toEqual([
      [first.code, second.code],
    ]);
    expect((await config()).settings.cleanupMinutes).toBe(30);
  });

  it('applies CC-2 data with cleanup 60 to future bookings only, keeping past and overridden ones at 30', async () => {
    const early = await book(TUESDAY, 540, 660);
    const late = await book(TUESDAY, 720, 780);
    const past = await book('2026-10-19', 540, 600);
    const overridden = await book(WEDNESDAY, 540, 600, { cleanupOverridden: true });

    const res = await put({ cleanupMinutes: 60 });

    expect(res.status).toBe(200);
    const rows = await db.select().from(bookings);
    const cleanupOf = (id: string) => rows.find((b) => b.id === id)?.cleanupMinutes;
    expect([early.id, late.id, past.id, overridden.id].map(cleanupOf)).toEqual([60, 60, 30, 30]);
    const { rows: periods } = await pool.query<{ ref_id: string; until: Date }>(
      `select ref_id, upper(period) as until from room_occupancy where kind = 'booking'`,
    );
    const untilOf = (id: string) => periods.find((p) => p.ref_id === id)?.until.toISOString();
    expect([early.id, late.id, past.id, overridden.id].map(untilOf)).toEqual([
      '2026-10-27T15:00:00.000Z',
      '2026-10-27T17:00:00.000Z',
      '2026-10-19T13:30:00.000Z',
      '2026-10-28T13:30:00.000Z',
    ]);
    expect(await auditActions()).toContain('settings.calendar_update');
  });
});

describe('policy settings (NUC-172..NUC-174)', () => {
  const policies = async () =>
    policySettingsSchema.parse((await call('GET', '/admin/settings/policies', adminCookie)).body);
  const put = async (patch: Record<string, unknown>) =>
    call('PUT', '/admin/settings/policies', adminCookie, {
      ...(await policies()).values,
      ...patch,
    });

  it('returns version 1 and every payment, policy and credits value without policy.version', async () => {
    const current = await policies();

    expect(current.version).toBe(1);
    expect(current.values['payment.deposit_percent']).toBe(50);
    expect(current.values['credits.validity_days']).toBe(90);
    expect(Object.keys(current.values)).not.toContain('policy.version');
  });

  it('returns 422 on both cross-field paths for deadline 48 with charge 48', async () => {
    const res = await put({
      'payment.balance_charge_hours_before': 48,
      'payment.balance_deadline_hours_before': 48,
    });

    expect([res.status, res.error?.code]).toEqual([422, 'VALIDATION_FAILED']);
    const paths = (res.error?.details ?? []).map((d) => d.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'payment.balance_deadline_hours_before',
        'payment.balance_reminder_hours_before',
      ]),
    );
  });

  it('returns 422 for ascending reminder hours [26, 36]', async () => {
    const res = await put({ 'payment.balance_reminder_hours_before': [26, 36] });

    expect(res.status).toBe(422);
    expect((res.error?.details ?? []).map((d) => d.path)).toContain(
      'payment.balance_reminder_hours_before',
    );
  });

  it('increments policy.version to 2 with audit on a change and keeps it on an identical PUT', async () => {
    const changed = await put({ 'payment.deposit_percent': 30 });
    const identical = await put({ 'payment.deposit_percent': 30 });

    expect(policySettingsSchema.parse(changed.body).version).toBe(2);
    expect(policySettingsSchema.parse(identical.body).version).toBe(2);
    const [version] = await db.select().from(settings).where(eq(settings.key, 'policy.version'));
    expect(version?.value).toBe(2);
    const entries = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'settings.policy_update'));
    expect(entries).toHaveLength(1);
    const valueOf = (v: unknown) =>
      (v as { values: Record<string, unknown> }).values['payment.deposit_percent'];
    expect([valueOf(entries[0]?.before), valueOf(entries[0]?.after)]).toEqual([50, 30]);
    expect((await policies()).values['payment.deposit_percent']).toBe(30);
  });
});
