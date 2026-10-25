import { describe, expect, it } from 'vitest';
import {
  availabilityDayQuerySchema,
  availabilityDaySchema,
  availabilityMonthQuerySchema,
  availabilityMonthSchema,
  catalogSchema,
  clinicSchema,
  paymentConfigSchema,
  policiesPublicSchema,
  preReservationPublicSchema,
  quoteRequestSchema,
  roomDetailSchema,
  roomListSchema,
  sandboxActionSchema,
  sandboxChargeSchema,
} from './public';
import {
  businessHours,
  describeContracts,
  ID,
  policySections,
  policySnapshot,
  roomSummary,
  without,
} from './fixtures.test-support';

const hourly = {
  id: ID.category,
  name: '1 hora',
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  appliesOnHolidays: true,
  startMinute: 0,
  endMinute: 1140,
  weekdayRateCents: 9700,
  weekendRateCents: 12000,
  minDurationMinutes: 60,
  displayOrder: 1,
  isReference: true,
};
const blockCategory = {
  id: ID.other,
  name: 'Manhã',
  weekdays: [1, 2, 3, 4, 5],
  appliesOnHolidays: false,
  startMinute: 420,
  endMinute: 720,
  fixedPriceCents: 28000,
  averageHourlyCents: 5600,
};
const catalog = { hourly: [hourly], blocks: [blockCategory], pricesReviewed: false };

const availabilityDay = {
  date: '2026-10-27',
  roomSlug: 'principal',
  isHoliday: false,
  holidayName: null,
  closed: false,
  outOfRange: false,
  window: { openMinute: 420, closeMinute: 1440 },
  slotMinutes: 30,
  minBookingMinutes: 60,
  cells: [
    { startMinute: 690, available: true, maxEndMinute: 810 },
    { startMinute: 720, available: true, maxEndMinute: 810, discountPercent: 10 },
  ],
  blockOptions: [
    {
      categoryId: ID.other,
      name: 'Manhã',
      startMinute: 420,
      endMinute: 720,
      priceCents: 28000,
      available: false,
    },
  ],
};

const quoteRequest = {
  roomSlug: 'principal',
  date: '2026-10-27',
  startMinute: 1050,
  endMinute: 1200,
};

const sandboxCharge = {
  id: ID.charge,
  amountCents: 10950,
  method: 'pix',
  status: 'pending',
  purpose: 'booking_deposit',
  bookingCode: 'BRV-7K2Q9X',
  bookingId: ID.booking,
  expiresAt: '2026-10-20T12:15:00.000Z',
  pixCopyPaste: '00020126SANDBOX',
};

describe('public contracts (NUC-04)', () => {
  describeContracts([
    [
      'roomListSchema',
      roomListSchema,
      { items: [roomSummary] },
      { items: [without(roomSummary, 'id')] },
    ],
    [
      'roomDetailSchema',
      roomDetailSchema,
      { ...roomSummary, photos: [{ url: '/media/a.webp', alt: '', width: null, height: null }] },
      roomSummary,
    ],
    ['catalogSchema', catalogSchema, catalog, without(catalog, 'pricesReviewed')],
    [
      'clinicSchema',
      clinicSchema,
      {
        addressLine: 'Praia Brava, Itajaí – SC',
        whatsappE164: '+5547999990000',
        contactEmail: '',
        businessHours,
      },
      {
        addressLine: 'Praia Brava, Itajaí – SC',
        whatsappE164: '',
        contactEmail: '',
        businessHours: businessHours.slice(0, 7),
      },
    ],
    [
      'policiesPublicSchema',
      policiesPublicSchema,
      { version: 1, values: policySnapshot, sections: policySections },
      { version: 0, values: policySnapshot, sections: policySections },
    ],
    [
      'availabilityDayQuerySchema',
      availabilityDayQuerySchema,
      { date: '2026-10-27' },
      { date: '27/10/2026' },
    ],
    [
      'availabilityMonthQuerySchema',
      availabilityMonthQuerySchema,
      { month: '2026-10' },
      { month: '2026-13' },
    ],
    [
      'availabilityDaySchema',
      availabilityDaySchema,
      availabilityDay,
      without(availabilityDay, 'blockOptions'),
    ],
    [
      'availabilityMonthSchema',
      availabilityMonthSchema,
      {
        month: '2026-11',
        days: [
          {
            date: '2026-11-02',
            status: 'available',
            isHoliday: true,
            holidayName: 'Finados',
            hasDiscount: false,
          },
          {
            date: '2026-11-03',
            status: 'full',
            isHoliday: false,
            holidayName: null,
            hasDiscount: false,
          },
        ],
      },
      {
        month: '2026-11',
        days: [
          {
            date: '2026-11-02',
            status: 'busy',
            isHoliday: false,
            holidayName: null,
            hasDiscount: false,
          },
        ],
      },
    ],
    [
      'quoteRequestSchema',
      quoteRequestSchema,
      { ...quoteRequest, couponCode: 'BRAVO10', addons: { extras: [{ id: ID.other, qty: 1 }] } },
      { ...quoteRequest, endMinute: 1050 },
    ],
    [
      'preReservationPublicSchema',
      preReservationPublicSchema,
      {
        bookingId: ID.booking,
        code: 'BRV-7K2Q9X',
        roomName: 'Sala Principal',
        startsAt: '2026-10-27T20:30:00.000Z',
        endsAt: '2026-10-27T23:00:00.000Z',
        totalCents: 21900,
        holdExpiresAt: '2026-10-21T12:00:00.000Z',
        customerFirstName: 'Camila',
      },
      {
        bookingId: ID.booking,
        code: 'BRV-7K2Q9X',
        roomName: 'Sala Principal',
        startsAt: '2026-10-27T20:30:00.000Z',
        endsAt: '2026-10-27T23:00:00.000Z',
        totalCents: 21900,
        customerFirstName: 'Camila',
      },
    ],
    [
      'paymentConfigSchema',
      paymentConfigSchema,
      { provider: 'sandbox', publicKey: null, environment: 'test' },
      { provider: 'stripe', publicKey: null, environment: 'test' },
    ],
    [
      'sandboxChargeSchema',
      sandboxChargeSchema,
      sandboxCharge,
      { ...sandboxCharge, purpose: 'donation' },
    ],
    ['sandboxActionSchema', sandboxActionSchema, { status: 'approved' }, { status: 'ok' }],
  ]);

  it('availabilityDaySchema rejects admin-only fields on public cells (NUC-77)', () => {
    const leaked = {
      ...availabilityDay,
      cells: [{ startMinute: 690, available: false, maxEndMinute: null, adminState: 'cleanup' }],
    };
    expect(availabilityDaySchema.safeParse(leaked).success).toBe(false);
    expect(
      availabilityDaySchema.safeParse({ ...availabilityDay, customerName: 'Camila' }).success,
    ).toBe(false);
  });
});
