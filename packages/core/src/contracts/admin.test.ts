import { describe, expect, it } from 'vitest';
import {
  adminAvailabilityDaySchema,
  adminBookingDetailSchema,
  adminBookingListSchema,
  adminBookingsQuerySchema,
  adminCancellationPreviewSchema,
  adminCancelSchema,
  adminCategoryListSchema,
  adminCategorySchema,
  adminRescheduleResultSchema,
  adminRescheduleSchema,
  blockCreateResultSchema,
  blockCreateSchema,
  blockListSchema,
  blockRecurrenceCreateResultSchema,
  blockRecurrenceCreateSchema,
  blockRecurrenceListSchema,
  blocksQuerySchema,
  businessHoursResponseSchema,
  businessHoursUpdateSchema,
  calendarConfigSchema,
  calendarEventsQuerySchema,
  calendarEventsSchema,
  calendarSettingsResultSchema,
  calendarSettingsSchema,
  categoryCreateSchema,
  categoryReorderSchema,
  categoryUpdateSchema,
  cleanupExceptionSchema,
  closedDayCreateResultSchema,
  closedDayCreateSchema,
  closedDayListSchema,
  closedDayPreviewQuerySchema,
  closedDayPreviewSchema,
  closedDaysQuerySchema,
  confirmManualSchema,
  customerCreatedSchema,
  customerCreateSchema,
  customerSearchQuerySchema,
  customerSearchResultSchema,
  holidayCreateSchema,
  holidayImportResultSchema,
  holidayImportSchema,
  holidayListSchema,
  holidaysQuerySchema,
  holidayUpdateSchema,
  policySettingsSchema,
  policySettingsUpdateSchema,
  pricesReviewedSchema,
  resendLinkResultSchema,
  staffBookingCreatedSchema,
  staffCreateBookingSchema,
} from './admin';
import {
  adminCategory,
  affectedBooking,
  block,
  blockRecurrence,
  bookingDetail,
  bookingSummary,
  businessHours,
  closedDay,
  compensation,
  describeContracts,
  holiday,
  ID,
  policyValues,
  without,
} from './fixtures.test-support';

const settings = {
  slotMinutes: 30,
  defaultBookingMinutes: 60,
  cleanupMinutes: 45,
  minAdvanceMinutes: 0,
  maxAdvanceDays: 90,
};
const warning = { code: 'cleanup_not_slot_multiple', lostMinutesPerBooking: 15 };
const blockInput = {
  roomIds: [ID.room],
  tag: 'Manutenção do ar',
  date: '2026-10-27',
  startMinute: 900,
  endMinute: 960,
};
const recurrenceInput = {
  roomIds: [ID.room],
  tag: 'Limpeza profunda',
  weekdays: [1],
  startMinute: 420,
  endMinute: 480,
  validFrom: '2026-10-26',
};
const hourlyInput = {
  type: 'hourly',
  name: '1 hora — fim de semana',
  weekdays: [6, 7],
  appliesOnHolidays: true,
  startMinute: 540,
  endMinute: 1440,
  weekdayRateCents: 12000,
  weekendRateCents: 12000,
  minDurationMinutes: 60,
};
const eventBooking = {
  id: ID.booking,
  code: 'BRV-7K2Q9X',
  firstName: 'Camila',
  fullName: 'Camila Souza',
  roomId: ID.room,
  roomName: 'Sala Principal',
  status: 'confirmed',
  statusLabel: 'Confirmada',
  paidCents: 10950,
  totalCents: 21900,
  packageMinutes: 0,
  startsAt: '2026-10-27T20:30:00.000Z',
  endsAt: '2026-10-27T23:00:00.000Z',
  cleanupUntil: '2026-10-27T23:30:00.000Z',
  categoryNames: ['2 horas ou mais', '2 horas ou mais — noite'],
  checkedInAt: null,
  holdExpiresAt: null,
};
const adminDay = {
  date: '2026-10-27',
  roomSlug: 'principal',
  isHoliday: false,
  holidayName: null,
  closed: false,
  outOfRange: false,
  window: { openMinute: 420, closeMinute: 1440 },
  slotMinutes: 30,
  minBookingMinutes: 60,
  cells: [{ startMinute: 660, available: false, maxEndMinute: null, adminState: 'cleanup' }],
  blockOptions: [],
};
const staffBooking = {
  userId: ID.user,
  roomId: ID.room,
  date: '2026-10-27',
  startMinute: 600,
  endMinute: 660,
  kind: 'pre_reservation',
  expiresInHours: 48,
};
const customer = {
  name: 'Juliana Lima',
  email: 'juliana@example.com',
  phone: '47999990000',
  document: '52998224725',
};

describe('admin contracts (NUC-04)', () => {
  describeContracts([
    [
      'businessHoursUpdateSchema',
      businessHoursUpdateSchema,
      { rows: businessHours },
      { rows: [...businessHours.slice(0, 7), { ...businessHours[0] }] },
    ],
    [
      'businessHoursResponseSchema',
      businessHoursResponseSchema,
      { businessHours },
      { businessHours: [] },
    ],
    [
      'calendarSettingsSchema',
      calendarSettingsSchema,
      settings,
      { ...settings, defaultBookingMinutes: 75 },
    ],
    [
      'calendarConfigSchema',
      calendarConfigSchema,
      { businessHours, settings, warnings: [warning], onboarding: { pricesReviewed: false } },
      { businessHours, settings, warnings: [warning] },
    ],
    [
      'calendarSettingsResultSchema',
      calendarSettingsResultSchema,
      { settings, warnings: [warning] },
      { settings, warnings: [{ code: 'other', lostMinutesPerBooking: 15 }] },
    ],
    ['holidaysQuerySchema', holidaysQuerySchema, { year: '2026' }, { year: 'abc' }],
    [
      'holidayListSchema',
      holidayListSchema,
      { items: [holiday] },
      { items: [without(holiday, 'alert')] },
    ],
    [
      'holidayCreateSchema',
      holidayCreateSchema,
      { date: '2027-02-08', name: 'Carnaval', scope: 'optional' },
      { date: '2027-02-08', name: 'Carnaval', scope: 'company' },
    ],
    ['holidayUpdateSchema', holidayUpdateSchema, { isClosed: true }, {}],
    ['holidayImportSchema', holidayImportSchema, { year: 2027 }, { year: '2027' }],
    [
      'holidayImportResultSchema',
      holidayImportResultSchema,
      { inserted: 10, updated: 1 },
      { inserted: 10 },
    ],
    [
      'closedDaysQuerySchema',
      closedDaysQuerySchema,
      { from: '2026-10-01', to: '2026-10-31' },
      { from: '2026-10-01' },
    ],
    [
      'closedDayListSchema',
      closedDayListSchema,
      { items: [closedDay] },
      { items: [without(closedDay, 'date')] },
    ],
    [
      'closedDayPreviewQuerySchema',
      closedDayPreviewQuerySchema,
      { date: '2026-12-24', roomIds: `${ID.room},${ID.other}` },
      { date: '2026-12-24', roomIds: 'principal' },
    ],
    [
      'closedDayPreviewSchema',
      closedDayPreviewSchema,
      { affectedBookings: [affectedBooking], compensation },
      { affectedBookings: [affectedBooking] },
    ],
    [
      'closedDayCreateSchema',
      closedDayCreateSchema,
      { date: '2026-12-24', roomIds: null, reason: 'Recesso' },
      { date: '2026-12-24', roomIds: [] },
    ],
    [
      'closedDayCreateResultSchema',
      closedDayCreateResultSchema,
      { items: [closedDay], compensation },
      { items: [], compensation },
    ],
    [
      'blocksQuerySchema',
      blocksQuerySchema,
      { from: '2026-10-26', to: '2026-11-01' },
      { from: '2026-10-26', to: 'x' },
    ],
    ['blockListSchema', blockListSchema, { items: [block] }, { items: [without(block, 'tag')] }],
    ['blockCreateSchema', blockCreateSchema, blockInput, { ...blockInput, tag: 'x'.repeat(61) }],
    ['blockCreateResultSchema', blockCreateResultSchema, { items: [block] }, { items: [] }],
    [
      'blockRecurrenceListSchema',
      blockRecurrenceListSchema,
      { items: [blockRecurrence] },
      { items: [{ ...blockRecurrence, weekdays: [] }] },
    ],
    [
      'blockRecurrenceCreateSchema',
      blockRecurrenceCreateSchema,
      { ...recurrenceInput, validUntil: '2027-01-31', skipConflicts: true },
      { ...recurrenceInput, validUntil: '2026-10-01' },
    ],
    [
      'blockRecurrenceCreateResultSchema',
      blockRecurrenceCreateResultSchema,
      { items: [blockRecurrence], created: 13, skipped: [{ roomId: ID.room, date: '2026-11-02' }] },
      { items: [blockRecurrence], created: 13 },
    ],
    [
      'adminCategorySchema',
      adminCategorySchema,
      adminCategory,
      { ...adminCategory, type: 'combo' },
    ],
    [
      'adminCategoryListSchema',
      adminCategoryListSchema,
      { items: [adminCategory] },
      { items: [without(adminCategory, 'editable')] },
    ],
    [
      'categoryCreateSchema (hourly)',
      categoryCreateSchema,
      hourlyInput,
      without(hourlyInput, 'weekendRateCents'),
    ],
    [
      'categoryCreateSchema (block)',
      categoryCreateSchema,
      {
        type: 'block',
        name: 'Manhã',
        weekdays: [1, 2, 3, 4, 5],
        appliesOnHolidays: false,
        startMinute: 420,
        endMinute: 720,
        fixedPriceCents: 28000,
      },
      {
        type: 'block',
        name: 'Manhã',
        weekdays: [1, 2, 3, 4, 5],
        appliesOnHolidays: false,
        startMinute: 420,
        endMinute: 720,
        fixedPriceCents: 0,
      },
    ],
    [
      'categoryCreateSchema (package types reach the handler)',
      categoryCreateSchema,
      { type: 'hour_package', name: 'Pacote 20h mensal', fixedPriceCents: 160000 },
      { type: 'gift_card', name: 'Vale' },
    ],
    [
      'categoryUpdateSchema',
      categoryUpdateSchema,
      { weekdayRateCents: 9900 },
      { weekdayRateCents: 9900, isReference: true },
    ],
    [
      'categoryReorderSchema',
      categoryReorderSchema,
      { ids: [ID.category, ID.other] },
      { ids: [ID.category, ID.category] },
    ],
    [
      'pricesReviewedSchema',
      pricesReviewedSchema,
      { pricesReviewed: true },
      { pricesReviewed: false },
    ],
    [
      'policySettingsUpdateSchema',
      policySettingsUpdateSchema,
      policyValues,
      { ...policyValues, 'payment.balance_deadline_hours_before': 48 },
    ],
    [
      'policySettingsSchema',
      policySettingsSchema,
      { version: 2, values: policyValues },
      { version: 2, values: { ...policyValues, 'policy.version': 2 } },
    ],
    [
      'calendarEventsQuerySchema',
      calendarEventsQuerySchema,
      { from: '2026-10-26', to: '2026-12-07', roomId: ID.room, status: 'confirmed' },
      { from: '2026-10-26', to: '2026-12-08' },
    ],
    [
      'calendarEventsSchema',
      calendarEventsSchema,
      { bookings: [eventBooking], blocks: [block], closedDays: [closedDay], holidays: [holiday] },
      {
        bookings: [without(eventBooking, 'cleanupUntil')],
        blocks: [],
        closedDays: [],
        holidays: [],
      },
    ],
    [
      'adminAvailabilityDaySchema',
      adminAvailabilityDaySchema,
      adminDay,
      { ...adminDay, cells: [{ startMinute: 660, available: false, maxEndMinute: null }] },
    ],
    [
      'adminBookingsQuerySchema',
      adminBookingsQuerySchema,
      { q: 'BRV-7K', status: 'paid', from: '2026-10-01', to: '2026-10-31' },
      { status: 'unknown' },
    ],
    [
      'adminBookingListSchema',
      adminBookingListSchema,
      {
        items: [
          {
            ...bookingSummary,
            customerName: 'Camila Souza',
            customerEmail: 'camila@example.com',
            source: 'admin',
          },
        ],
        nextCursor: 'eyJpZCI6MX0=',
      },
      { items: [bookingSummary], nextCursor: null },
    ],
    [
      'adminBookingDetailSchema',
      adminBookingDetailSchema,
      {
        ...bookingDetail,
        customer: { id: ID.user, name: 'Camila Souza', email: 'camila@example.com', phone: null },
      },
      bookingDetail,
    ],
    [
      'staffCreateBookingSchema',
      staffCreateBookingSchema,
      staffBooking,
      { ...staffBooking, kind: 'booking', confirmManually: true },
    ],
    [
      'staffBookingCreatedSchema',
      staffBookingCreatedSchema,
      { ...bookingDetail, paymentLink: 'https://bravoclinic.com.br/pre-reserva/abc123' },
      { ...bookingDetail, paymentLink: 'pre-reserva/abc123' },
    ],
    [
      'confirmManualSchema',
      confirmManualSchema,
      { justification: 'Pagou na recepção' },
      { justification: 'ok' },
    ],
    [
      'resendLinkResultSchema',
      resendLinkResultSchema,
      { paymentLink: 'https://bravoclinic.com.br/pre-reserva/def456' },
      { paymentLink: null },
    ],
    [
      'cleanupExceptionSchema',
      cleanupExceptionSchema,
      { cleanupMinutes: 0, justification: 'Mesmo locatário emendando horários' },
      { cleanupMinutes: 0 },
    ],
    [
      'adminRescheduleSchema',
      adminRescheduleSchema,
      {
        date: '2026-10-28',
        startMinute: 600,
        endMinute: 660,
        exception: true,
        justification: 'Pedido do cliente',
      },
      { date: '2026-10-28', startMinute: 600, endMinute: 660, differenceHandling: 'waive' },
    ],
    [
      'adminRescheduleResultSchema',
      adminRescheduleResultSchema,
      { ...bookingDetail, creditCents: 0 },
      bookingDetail,
    ],
    [
      'adminCancellationPreviewSchema',
      adminCancellationPreviewSchema,
      {
        retainedCents: 0,
        refundCents: 16000,
        minutesReturned: 0,
        creditCents: 0,
        clinicOptions: ['refund', 'minutes', 'credit'],
      },
      {
        retainedCents: 0,
        refundCents: 16000,
        minutesReturned: 0,
        creditCents: 0,
        clinicOptions: ['voucher'],
      },
    ],
    [
      'adminCancelSchema',
      adminCancelSchema,
      { reason: 'Manutenção do ar', resolution: 'refund' },
      { reason: 'Manutenção do ar', resolution: 'voucher' },
    ],
    ['customerSearchQuerySchema', customerSearchQuerySchema, { q: 'Ca' }, { q: 'C' }],
    [
      'customerSearchResultSchema',
      customerSearchResultSchema,
      {
        items: [
          {
            id: ID.user,
            name: 'Camila Souza',
            email: 'camila@example.com',
            docMasked: '***.982.247-**',
            phone: null,
          },
        ],
      },
      { items: [{ id: ID.user, name: 'Camila Souza', email: 'camila@example.com', phone: null }] },
    ],
    [
      'customerCreateSchema',
      customerCreateSchema,
      customer,
      { ...customer, document: '12345678900' },
    ],
    [
      'customerCreatedSchema',
      customerCreatedSchema,
      { id: ID.user, name: 'Juliana Lima', email: 'juliana@example.com' },
      { name: 'Juliana Lima', email: 'juliana@example.com' },
    ],
  ]);

  it('reports the field path of cross-field policy errors (NUC-173)', () => {
    const deadline = policySettingsUpdateSchema.safeParse({
      ...policyValues,
      'payment.balance_deadline_hours_before': 48,
    });
    expect(deadline.error?.issues.map((i) => i.path.join('.'))).toContain(
      'payment.balance_deadline_hours_before',
    );
    const reminders = policySettingsUpdateSchema.safeParse({
      ...policyValues,
      'payment.balance_reminder_hours_before': [50, 36, 26],
    });
    expect(reminders.error?.issues.map((i) => i.path.join('.'))).toEqual([
      'payment.balance_reminder_hours_before',
    ]);
  });

  it('reports the defaultBookingMinutes path when it is not a slot multiple (NUC-35)', () => {
    const result = calendarSettingsSchema.safeParse({ ...settings, defaultBookingMinutes: 75 });
    expect(result.error?.issues.map((i) => i.path.join('.'))).toEqual(['defaultBookingMinutes']);
  });

  it('reports the row path of a business-hours row closing before it opens (NUC-33)', () => {
    const rows = businessHours.map((r) => (r.dayType === 'wed' ? { ...r, closeMinute: 300 } : r));
    const result = businessHoursUpdateSchema.safeParse({ rows });
    expect(result.error?.issues.map((i) => i.path.join('.'))).toEqual(['rows.2.closeMinute']);
  });
});
